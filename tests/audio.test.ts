import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AudioService } from "../src/services/audio.js";
import type { AudioChunk } from "../src/types.js";

describe("AudioService Module", () => {
  let audio: AudioService;

  beforeEach(() => {
    vi.useFakeTimers();
    audio = new AudioService();
  });

  afterEach(() => {
    audio.destroy();
    vi.useRealTimers();
  });

  it("should start with default 16kHz sample rate", () => {
    // The default sample rate is 16000 but chunkSizeBytes won't be set
    // until setSampleRate is called. feedRawAudio won't start interval
    // without chunkSizeBytes > 0
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    // Feed data without setting sample rate — no interval starts
    audio.feedRawAudio(Buffer.alloc(100));
    vi.advanceTimersByTime(500);
    expect(chunks.length).toBe(0);
  });

  it("should emit chunks after setSampleRate and feedRawAudio", () => {
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    audio.setSampleRate(16000);
    // 16000 * 0.25 * 2 = 8000 bytes per chunk
    const data = Buffer.alloc(8000);
    audio.feedRawAudio(data);

    vi.advanceTimersByTime(250);
    expect(chunks.length).toBe(1);
    expect(chunks[0].buffer.length).toBe(8000);
    expect(chunks[0].sampleRate).toBe(16000);
  });

  it("should emit multiple chunks when buffer exceeds chunk size", () => {
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    audio.setSampleRate(16000);
    // Feed 3 chunks worth of data
    audio.feedRawAudio(Buffer.alloc(24000));

    vi.advanceTimersByTime(250);
    expect(chunks.length).toBe(3);
  });

  it("should not emit chunk when buffer is less than chunk size", () => {
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    audio.setSampleRate(16000);
    audio.feedRawAudio(Buffer.alloc(4000)); // less than 8000

    vi.advanceTimersByTime(250);
    expect(chunks.length).toBe(0);
  });

  it("should accumulate data across multiple feedRawAudio calls", () => {
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    audio.setSampleRate(16000);
    audio.feedRawAudio(Buffer.alloc(4000));
    audio.feedRawAudio(Buffer.alloc(4000));

    vi.advanceTimersByTime(250);
    expect(chunks.length).toBe(1);
  });

  it("should create new buffer copies (immutability)", () => {
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    audio.setSampleRate(16000);
    const original = Buffer.alloc(8000, 0x42);
    audio.feedRawAudio(original);

    vi.advanceTimersByTime(250);
    expect(chunks[0].buffer).not.toBe(original);
    expect(chunks[0].buffer[0]).toBe(0x42);
  });

  it("should stop interval on destroy", () => {
    audio.setSampleRate(16000);
    audio.feedRawAudio(Buffer.alloc(8000));
    audio.destroy();

    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));
    vi.advanceTimersByTime(500);
    expect(chunks.length).toBe(0);
  });

  it("should restart interval when sample rate changes", () => {
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    audio.setSampleRate(16000);
    audio.feedRawAudio(Buffer.alloc(16000)); // 2 chunks at 16kHz

    // Change to 8000Hz: 8000 * 0.25 * 2 = 4000 bytes per chunk
    audio.setSampleRate(8000);

    vi.advanceTimersByTime(250);
    // Should flush remaining buffer with new chunk size
    expect(chunks.length).toBe(4); // 16000 / 4000 = 4 chunks
  });

  it("should include timestamp in emitted chunks", () => {
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    audio.setSampleRate(16000);
    audio.feedRawAudio(Buffer.alloc(8000));

    vi.advanceTimersByTime(250);
    expect(chunks[0].timestamp).toBeTypeOf("number");
  });
});

describe("AudioService Edge Cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should discard oldest bytes when buffer exceeds MAX_BUFFER_BYTES (960000)", () => {
    const audio = new AudioService();
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    audio.setSampleRate(16000);
    // Feed 960001 bytes — 1 byte over the 30s cap
    audio.feedRawAudio(Buffer.alloc(960001));

    // Buffer should have been capped to 960000 bytes
    // chunkSizeBytes at 16kHz = 16000 * 0.25 * 2 = 8000
    // 960000 / 8000 = 120 chunks
    vi.advanceTimersByTime(250);
    expect(chunks.length).toBe(120);

    audio.destroy();
  });

  it("should resume emitting chunks after destroy and re-creation", () => {
    // First cycle
    const audio1 = new AudioService();
    const chunks1: AudioChunk[] = [];
    audio1.on("chunk", (c) => chunks1.push(c));

    audio1.setSampleRate(16000);
    audio1.feedRawAudio(Buffer.alloc(8000));
    vi.advanceTimersByTime(250);
    expect(chunks1.length).toBe(1);

    audio1.destroy();

    // Second cycle — new instance
    const audio2 = new AudioService();
    const chunks2: AudioChunk[] = [];
    audio2.on("chunk", (c) => chunks2.push(c));

    audio2.setSampleRate(16000);
    audio2.feedRawAudio(Buffer.alloc(8000));
    vi.advanceTimersByTime(250);
    expect(chunks2.length).toBe(1);

    audio2.destroy();
  });

  it("should not crash on zero-length feedRawAudio", () => {
    const audio = new AudioService();
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    audio.setSampleRate(16000);
    audio.feedRawAudio(Buffer.alloc(0));

    vi.advanceTimersByTime(250);
    expect(chunks.length).toBe(0);

    audio.destroy();
  });

  it("should emit 0 chunks after destroy even with data in buffer", () => {
    const audio = new AudioService();
    const chunks: AudioChunk[] = [];
    audio.on("chunk", (c) => chunks.push(c));

    audio.setSampleRate(16000);
    // Feed 10 chunks worth of data
    audio.feedRawAudio(Buffer.alloc(8000 * 10));

    // Destroy immediately before timer fires
    audio.destroy();

    vi.advanceTimersByTime(500);
    expect(chunks.length).toBe(0);
  });
});
