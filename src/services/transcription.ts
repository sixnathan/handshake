import WebSocket from "ws";
import { EventEmitter } from "eventemitter3";
import type { AudioChunk } from "../types.js";
import type {
  ITranscriptionService,
  FinalTranscript,
  PartialTranscript,
} from "../interfaces.js";

export class TranscriptionService
  extends EventEmitter
  implements ITranscriptionService
{
  private ws: WebSocket | null = null;
  private running = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private chunksReceived = 0;
  private chunksSent = 0;
  private chunksDropped = 0;
  private label: string;
  private lastPartialText: string | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly KEEPALIVE_INTERVAL_MS = 5000;

  /**
   * Noise artifact pattern — ElevenLabs Scribe sometimes transcribes background
   * noise as bracketed/asterisked labels like *static*, [noise], *silence*, etc.
   * We filter these out to keep transcripts clean.
   */
  private static readonly NOISE_PATTERN =
    /^[\s*[\]()]*(?:static|noise|silence|background noise|inaudible|unintelligible|music|applause|laughter|cough|coughing|breathing|sigh|sighing|clicks?)[\s*[\]()]*$/i;

  private static isNoise(text: string): boolean {
    return TranscriptionService.NOISE_PATTERN.test(text.trim());
  }

  constructor(
    private readonly config: {
      apiKey: string;
      region: string;
      language: string;
    },
    label?: string,
  ) {
    super();
    this.label = label ?? `ts-${Math.random().toString(36).slice(2, 6)}`;
  }

  async start(): Promise<void> {
    if (this.running) {
      console.log(
        `[transcription:${this.label}] Already running, skipping start`,
      );
      return;
    }
    this.running = true;
    this.chunksSent = 0;
    this.chunksDropped = 0;
    this.chunksReceived = 0;

    console.log(`[transcription:${this.label}] Connecting to ElevenLabs...`);
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&language_code=${this.config.language}&commit_strategy=vad&audio_format=pcm_16000`;

    this.ws = new WebSocket(url, {
      headers: { "xi-api-key": this.config.apiKey },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onOpen = (): void => {
          this.ws?.removeListener("error", onError);
          resolve();
        };
        const onError = (err: Error): void => {
          this.ws?.removeListener("open", onOpen);
          reject(err);
        };
        this.ws!.once("open", onOpen);
        this.ws!.once("error", onError);
      });
    } catch (err) {
      this.running = false;
      this.ws = null;
      console.error(
        `[transcription:${this.label}] Connection failed:`,
        (err as Error).message,
      );
      throw err;
    }

    console.log(`[transcription:${this.label}] Connected to ElevenLabs`);
    this.wireHandlers();
    this.reconnectAttempts = 0;
    this.startKeepalive();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopKeepalive();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.emitOrphanedPartial();
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }

  flush(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.running) {
      console.log(
        `[transcription:${this.label}] flush() skipped (ws=${this.ws ? this.ws.readyState : "null"}, running=${this.running})`,
      );
      // Even if WS is down, emit the last partial as a synthetic final
      this.emitOrphanedPartial();
      return;
    }
    console.log(`[transcription:${this.label}] Sending commit to ElevenLabs`);
    // ElevenLabs Scribe v2: send a zero-length audio chunk with commit=true
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: "",
        commit: true,
      }),
    );
  }

  /**
   * Called when user unmutes. Stops the silence keepalive and commits any
   * buffered silence so ElevenLabs VAD gets a clean transition to real speech.
   */
  resumeFromMute(): void {
    console.log(
      `[transcription:${this.label}] Resuming from mute — flushing silence`,
    );
    // Stop keepalive so silence frames don't interleave with real audio
    this.stopKeepalive();

    // Commit any buffered silence so VAD resets for fresh voice detection
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.running) {
      this.ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: "",
          commit: true,
        }),
      );
    }

    // Restart keepalive as a safety net (will be preempted by real audio chunks)
    this.startKeepalive();
  }

  feedAudio(chunk: AudioChunk): void {
    this.chunksReceived++;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.running) {
      this.chunksDropped++;
      if (this.chunksDropped === 1 || this.chunksDropped % 100 === 0) {
        console.log(
          `[transcription:${this.label}] Dropping chunks (total=${this.chunksDropped}, ws=${this.ws ? this.ws.readyState : "null"}, running=${this.running})`,
        );
      }
      return;
    }
    this.chunksSent++;
    if (this.chunksSent === 1) {
      console.log(
        `[transcription:${this.label}] First chunk sent to ElevenLabs (${chunk.buffer.length} bytes)`,
      );
    }
    const base64 = chunk.buffer.toString("base64");
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: base64,
      }),
    );
  }

  /**
   * Sends a tiny silent audio frame every 5s to prevent ElevenLabs from
   * closing the WebSocket during mute periods (their session times out
   * after ~15-30s of no audio).
   */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      // 160 bytes = 10ms of silent 16kHz 16-bit PCM
      const silence = Buffer.alloc(320);
      this.ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: silence.toString("base64"),
        }),
      );
    }, TranscriptionService.KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private emitOrphanedPartial(): void {
    if (
      this.lastPartialText &&
      this.lastPartialText.trim() &&
      !TranscriptionService.isNoise(this.lastPartialText)
    ) {
      console.log(
        `[transcription:${this.label}] Promoting orphaned partial as final: ${this.lastPartialText.slice(0, 50)}`,
      );
      this.emit("final", {
        text: this.lastPartialText,
      } satisfies FinalTranscript);
    }
    this.lastPartialText = null;
  }

  private wireHandlers(): void {
    if (!this.ws) return;

    this.ws.on("message", (data: WebSocket.Data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        console.warn(
          `[transcription:${this.label}] Received malformed JSON, ignoring`,
        );
        return;
      }

      switch (msg.message_type as string) {
        case "session_started":
          console.log(`[transcription:${this.label}] Session started`);
          break;

        case "partial_transcript":
          if (msg.text) {
            const partialText = msg.text as string;
            if (TranscriptionService.isNoise(partialText)) break;
            this.lastPartialText = partialText;
            this.emit("partial", {
              text: partialText,
            } satisfies PartialTranscript);
          }
          break;

        case "committed_transcript":
          if (msg.text) {
            const finalText = msg.text as string;
            this.lastPartialText = null;
            if (TranscriptionService.isNoise(finalText)) break;
            console.log(
              `[transcription:${this.label}] Final: ${finalText.slice(0, 50)}`,
            );
            this.emit("final", { text: finalText } satisfies FinalTranscript);
          }
          break;

        case "committed_transcript_with_timestamps":
          if (msg.text) {
            const tsText = msg.text as string;
            this.lastPartialText = null;
            if (TranscriptionService.isNoise(tsText)) break;
            console.log(
              `[transcription:${this.label}] Final+ts: ${tsText.slice(0, 50)}`,
            );
            const words = (
              msg.words as Array<{
                word: string;
                start: number;
                end: number;
                confidence: number;
              }>
            ).map((w) => ({
              word: w.word,
              start: w.start,
              end: w.end,
              confidence: w.confidence,
            }));
            const startTime = words[0]?.start;
            const endTime = words[words.length - 1]?.end;
            this.emit("final", {
              text: tsText,
              startTime,
              endTime,
              words,
            } satisfies FinalTranscript);
          }
          break;

        case "error":
          console.error(
            `[transcription:${this.label}] ElevenLabs error:`,
            JSON.stringify(msg),
          );
          break;
      }
    });

    this.ws.on("error", (err: Error) => {
      console.error(
        `[transcription:${this.label}] WebSocket error:`,
        err.message,
      );
      this.emitOrphanedPartial();
      this.scheduleReconnect();
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      console.log(
        `[transcription:${this.label}] WebSocket closed (code=${code}, reason=${reason.toString()}, sent=${this.chunksSent}, dropped=${this.chunksDropped})`,
      );
      this.emitOrphanedPartial();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[transcription:${this.label}] Max reconnect attempts reached, giving up`,
      );
      return;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    console.log(
      `[transcription:${this.label}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );
    this.reconnectTimer = setTimeout(() => {
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    this.stopKeepalive();
    this.ws = null;
    // Set running=false so start() doesn't bail with "Already running"
    // but preserve intent to reconnect via a separate flag
    const wasRunning = this.running;
    this.running = false;
    try {
      await this.start();
    } catch (err) {
      console.error(
        `[transcription:${this.label}] Reconnect failed:`,
        (err as Error).message,
      );
      // Restore running so scheduleReconnect doesn't bail on !this.running
      if (wasRunning) this.running = true;
      this.scheduleReconnect();
    }
  }
}
