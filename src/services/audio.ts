import { EventEmitter } from "eventemitter3";
import type { AudioChunk } from "../types.js";
import type { IAudioService } from "../interfaces.js";

const MAX_BUFFER_BYTES = 16000 * 2 * 30; // 30 seconds of 16kHz 16-bit PCM

export class AudioService extends EventEmitter implements IAudioService {
  private buffer: Buffer = Buffer.alloc(0);
  private chunkInterval: ReturnType<typeof setInterval> | null = null;
  private sampleRate = 16000;
  private chunkSizeBytes = 0;

  setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.chunkSizeBytes = Math.floor(rate * 0.25) * 2;

    if (this.chunkInterval !== null) {
      this.stopInterval();
      this.startInterval();
    }
  }

  feedRawAudio(raw: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, raw]);

    // Prevent unbounded memory growth if transcription is down
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.buffer = this.buffer.subarray(this.buffer.length - MAX_BUFFER_BYTES);
    }

    if (this.chunkInterval === null && this.chunkSizeBytes > 0) {
      this.startInterval();
    }
  }

  destroy(): void {
    this.stopInterval();
    this.buffer = Buffer.alloc(0);
    this.removeAllListeners();
  }

  private startInterval(): void {
    if (this.chunkInterval !== null) {
      return;
    }
    this.chunkInterval = setInterval(() => this.flush(), 250);
  }

  private stopInterval(): void {
    if (this.chunkInterval !== null) {
      clearInterval(this.chunkInterval);
      this.chunkInterval = null;
    }
  }

  private flush(): void {
    while (this.buffer.length >= this.chunkSizeBytes) {
      const slice = this.buffer.subarray(0, this.chunkSizeBytes);
      this.buffer = this.buffer.subarray(this.chunkSizeBytes);

      const chunk: AudioChunk = {
        buffer: Buffer.from(slice),
        sampleRate: this.sampleRate,
        timestamp: Date.now(),
      };

      this.emit("chunk", chunk);
    }
  }
}
