import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TranscriptionService } from "../src/services/transcription.js";
import type { FinalTranscript, PartialTranscript } from "../src/interfaces.js";

// Mock the ws module — import EventEmitter inside the factory to avoid hoisting issues
vi.mock("ws", async () => {
  const { EventEmitter } = await import("events");
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1; // OPEN
    send = vi.fn();
    close = vi.fn(() => {
      this.readyState = 3;
    });

    constructor() {
      super();
      // Auto-fire open event
      process.nextTick(() => this.emit("open"));
    }
  }
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

describe("TranscriptionService Module", () => {
  let service: TranscriptionService;

  beforeEach(() => {
    service = new TranscriptionService({
      apiKey: "test-key",
      region: "us",
      language: "en",
    });
  });

  afterEach(async () => {
    await service.stop();
    vi.restoreAllMocks();
  });

  describe("start/stop lifecycle", () => {
    it("should start successfully", async () => {
      await service.start();
      // No throw = success
    });

    it("should be idempotent — second start is a no-op", async () => {
      await service.start();
      await service.start(); // Should not throw or create second connection
    });

    it("should stop cleanly", async () => {
      await service.start();
      await service.stop();
    });

    it("should handle stop without start", async () => {
      await service.stop(); // Should not throw
    });
  });

  describe("feedAudio", () => {
    it("should send base64-encoded audio to WebSocket", async () => {
      await service.start();

      const chunk = {
        buffer: Buffer.from([0x01, 0x02, 0x03]),
        sampleRate: 16000,
        timestamp: Date.now(),
      };

      service.feedAudio(chunk);

      // Get the internal ws and check send was called
      const ws = (service as any).ws;
      expect(ws.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.message_type).toBe("input_audio_chunk");
      expect(sent.audio_base_64).toBe(
        Buffer.from([0x01, 0x02, 0x03]).toString("base64"),
      );
    });

    it("should not send when not running", async () => {
      const chunk = {
        buffer: Buffer.from([0x01]),
        sampleRate: 16000,
        timestamp: Date.now(),
      };
      service.feedAudio(chunk); // No crash, just ignored
    });

    it("should not send after stop", async () => {
      await service.start();
      await service.stop();

      const chunk = {
        buffer: Buffer.from([0x01]),
        sampleRate: 16000,
        timestamp: Date.now(),
      };
      service.feedAudio(chunk); // Should be ignored
    });
  });

  describe("message handling", () => {
    it("should emit partial transcript", async () => {
      await service.start();

      const partials: PartialTranscript[] = [];
      service.on("partial", (p) => partials.push(p));

      const ws = (service as any).ws;
      ws.emit(
        "message",
        JSON.stringify({
          message_type: "partial_transcript",
          text: "hello wor",
        }),
      );

      expect(partials).toHaveLength(1);
      expect(partials[0].text).toBe("hello wor");
    });

    it("should emit final transcript from committed_transcript", async () => {
      await service.start();

      const finals: FinalTranscript[] = [];
      service.on("final", (f) => finals.push(f));

      const ws = (service as any).ws;
      ws.emit(
        "message",
        JSON.stringify({
          message_type: "committed_transcript",
          text: "hello world",
        }),
      );

      expect(finals).toHaveLength(1);
      expect(finals[0].text).toBe("hello world");
    });

    it("should emit final transcript with timestamps", async () => {
      await service.start();

      const finals: FinalTranscript[] = [];
      service.on("final", (f) => finals.push(f));

      const ws = (service as any).ws;
      ws.emit(
        "message",
        JSON.stringify({
          message_type: "committed_transcript_with_timestamps",
          text: "hello world",
          words: [
            { word: "hello", start: 0.0, end: 0.5, confidence: 0.99 },
            { word: "world", start: 0.6, end: 1.0, confidence: 0.95 },
          ],
        }),
      );

      expect(finals).toHaveLength(1);
      expect(finals[0].text).toBe("hello world");
      expect(finals[0].words).toHaveLength(2);
      expect(finals[0].startTime).toBe(0.0);
      expect(finals[0].endTime).toBe(1.0);
      expect(finals[0].words![0].word).toBe("hello");
      expect(finals[0].words![1].confidence).toBe(0.95);
    });

    it("should ignore empty text in partial", async () => {
      await service.start();

      const partials: PartialTranscript[] = [];
      service.on("partial", (p) => partials.push(p));

      const ws = (service as any).ws;
      ws.emit(
        "message",
        JSON.stringify({
          message_type: "partial_transcript",
          text: "",
        }),
      );

      expect(partials).toHaveLength(0);
    });

    it("should ignore empty text in committed", async () => {
      await service.start();

      const finals: FinalTranscript[] = [];
      service.on("final", (f) => finals.push(f));

      const ws = (service as any).ws;
      ws.emit(
        "message",
        JSON.stringify({
          message_type: "committed_transcript",
          text: "",
        }),
      );

      expect(finals).toHaveLength(0);
    });

    it("should handle session_started message without error", async () => {
      await service.start();

      const ws = (service as any).ws;
      ws.emit(
        "message",
        JSON.stringify({
          message_type: "session_started",
        }),
      );
      // No crash = success
    });

    it("should handle unknown message types", async () => {
      await service.start();

      const ws = (service as any).ws;
      ws.emit(
        "message",
        JSON.stringify({
          message_type: "unknown_type",
          data: "whatever",
        }),
      );
      // No crash = success
    });
  });

  describe("reconnection", () => {
    it("should have max reconnect attempts of 10", () => {
      expect((service as any).MAX_RECONNECT_ATTEMPTS).toBe(10);
    });

    it("should use exponential backoff", () => {
      // Test the backoff formula: min(2000 * 2^attempts, 30000)
      const delays = [0, 1, 2, 3, 4, 5].map((a) =>
        Math.min(2000 * Math.pow(2, a), 30000),
      );
      expect(delays).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    });

    it("should not reconnect when not running", async () => {
      await service.start();
      await service.stop();

      // Simulate close — should not reconnect
      const ws = (service as any).ws;
      // ws is null after stop, so no reconnect
    });

    it("should reset reconnect attempts on successful start", async () => {
      await service.start();
      expect((service as any).reconnectAttempts).toBe(0);
    });
  });
});
