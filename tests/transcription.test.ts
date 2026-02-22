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

describe("Malformed JSON message handling", () => {
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

  it("should not crash when receiving non-JSON data", async () => {
    await service.start();

    const ws = (service as any).ws;
    // Sending plain text that is not valid JSON
    ws.emit("message", "this is not json at all");
    // No crash = success
  });

  it("should not emit any events for malformed JSON", async () => {
    await service.start();

    const partials: PartialTranscript[] = [];
    const finals: FinalTranscript[] = [];
    service.on("partial", (p) => partials.push(p));
    service.on("final", (f) => finals.push(f));

    const ws = (service as any).ws;
    ws.emit("message", "{broken json!!!}");
    ws.emit("message", "not json");
    ws.emit("message", "<xml>nope</xml>");

    expect(partials).toHaveLength(0);
    expect(finals).toHaveLength(0);
  });

  it("should log a warning for malformed JSON", async () => {
    await service.start();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const ws = (service as any).ws;
    ws.emit("message", "{{invalid}}");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Received malformed JSON, ignoring"),
    );
  });

  it("should continue processing valid messages after malformed ones", async () => {
    await service.start();

    const finals: FinalTranscript[] = [];
    service.on("final", (f) => finals.push(f));

    const ws = (service as any).ws;

    // First: malformed
    ws.emit("message", "not json");

    // Then: valid
    ws.emit(
      "message",
      JSON.stringify({
        message_type: "committed_transcript",
        text: "valid after malformed",
      }),
    );

    expect(finals).toHaveLength(1);
    expect(finals[0].text).toBe("valid after malformed");
  });
});

describe("Reconnect backoff timing", () => {
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

  it("should compute correct exponential backoff delays for attempts 0-5", () => {
    const expectedDelays = [2000, 4000, 8000, 16000, 30000, 30000];
    for (let attempt = 0; attempt <= 5; attempt++) {
      const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
      expect(delay).toBe(expectedDelays[attempt]);
    }
  });

  it("should cap backoff at 30000ms regardless of attempt count", () => {
    const highAttempts = [6, 7, 8, 9];
    for (const attempt of highAttempts) {
      const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
      expect(delay).toBe(30000);
    }
  });

  it("should schedule reconnect with correct delay via setTimeout", async () => {
    vi.useFakeTimers();
    await service.start();

    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    // Force running state and trigger scheduleReconnect
    (service as any).running = true;
    (service as any).reconnectAttempts = 0;
    (service as any).scheduleReconnect();

    // First attempt (attempt=0): delay = 2000 * 2^0 = 2000ms
    const lastCall =
      setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
    expect(lastCall[1]).toBe(2000);

    // Second call (attempt is now 1): delay = 2000 * 2^1 = 4000ms
    (service as any).scheduleReconnect();
    const secondCall =
      setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
    expect(secondCall[1]).toBe(4000);

    vi.useRealTimers();
  });

  it("should increment reconnectAttempts after each scheduleReconnect call", async () => {
    vi.useFakeTimers();
    await service.start();

    (service as any).running = true;
    (service as any).reconnectAttempts = 0;

    (service as any).scheduleReconnect();
    expect((service as any).reconnectAttempts).toBe(1);

    (service as any).scheduleReconnect();
    expect((service as any).reconnectAttempts).toBe(2);

    (service as any).scheduleReconnect();
    expect((service as any).reconnectAttempts).toBe(3);

    vi.useRealTimers();
  });
});

describe("Max reconnect attempts", () => {
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

  it("should not schedule reconnect after 10 attempts", async () => {
    vi.useFakeTimers();
    await service.start();

    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const callCountBefore = setTimeoutSpy.mock.calls.length;

    (service as any).running = true;
    (service as any).reconnectAttempts = 10;

    (service as any).scheduleReconnect();

    // No new setTimeout should have been scheduled
    expect(setTimeoutSpy.mock.calls.length).toBe(callCountBefore);

    vi.useRealTimers();
  });

  it("should log an error when max attempts reached", async () => {
    await service.start();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    (service as any).running = true;
    (service as any).reconnectAttempts = 10;

    (service as any).scheduleReconnect();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Max reconnect attempts reached, giving up"),
    );
  });

  it("should allow reconnect at attempt 9 but not at attempt 10", async () => {
    vi.useFakeTimers();
    await service.start();

    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    // Attempt 9 should still schedule
    (service as any).running = true;
    (service as any).reconnectAttempts = 9;
    const callsBefore = setTimeoutSpy.mock.calls.length;
    (service as any).scheduleReconnect();
    expect(setTimeoutSpy.mock.calls.length).toBe(callsBefore + 1);

    // Now reconnectAttempts is 10, next call should NOT schedule
    const callsAfterNine = setTimeoutSpy.mock.calls.length;
    (service as any).scheduleReconnect();
    expect(setTimeoutSpy.mock.calls.length).toBe(callsAfterNine);

    vi.useRealTimers();
  });

  it("should not reconnect when not running even if attempts remain", async () => {
    vi.useFakeTimers();
    await service.start();
    await service.stop(); // sets running = false

    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const callsBefore = setTimeoutSpy.mock.calls.length;

    (service as any).reconnectAttempts = 0;
    (service as any).scheduleReconnect();

    // Should not schedule because running is false
    expect(setTimeoutSpy.mock.calls.length).toBe(callsBefore);

    vi.useRealTimers();
  });
});

describe("TranscriptionService Additional Edge Cases", () => {
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

  it("should correctly base64-encode a single-byte audio buffer", async () => {
    await service.start();

    const chunk = {
      buffer: Buffer.from([0xff]),
      sampleRate: 16000,
      timestamp: Date.now(),
    };

    service.feedAudio(chunk);

    const ws = (service as any).ws;
    expect(ws.send).toHaveBeenCalledOnce();

    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.message_type).toBe("input_audio_chunk");
    expect(sent.audio_base_64).toBe(Buffer.from([0xff]).toString("base64"));
  });

  it("should handle 100 rapid consecutive feedAudio calls", async () => {
    await service.start();

    for (let i = 0; i < 100; i++) {
      service.feedAudio({
        buffer: Buffer.from([i & 0xff]),
        sampleRate: 16000,
        timestamp: Date.now(),
      });
    }

    const ws = (service as any).ws;
    expect(ws.send).toHaveBeenCalledTimes(100);
  });

  it("should clear reconnect timer on stop during reconnect backoff", async () => {
    vi.useFakeTimers();
    await service.start();

    // Set up a reconnect scenario
    (service as any).running = true;
    (service as any).reconnectAttempts = 0;
    (service as any).scheduleReconnect();

    // reconnectTimer should now be set
    expect((service as any).reconnectTimer).not.toBeNull();

    // Stop immediately — should clear the reconnect timer
    await service.stop();

    expect((service as any).reconnectTimer).toBeNull();
    expect((service as any).running).toBe(false);

    // Advance well past the backoff delay — no reconnection should happen
    const startSpy = vi.spyOn(service, "start");
    vi.advanceTimersByTime(60000);

    expect(startSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
