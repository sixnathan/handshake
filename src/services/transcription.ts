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

  constructor(
    private readonly config: {
      apiKey: string;
      region: string;
      language: string;
    },
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log("[transcription] Connecting to ElevenLabs...");
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
      throw err;
    }

    console.log("[transcription] Connected to ElevenLabs");
    this.wireHandlers();
    this.reconnectAttempts = 0;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }

  feedAudio(chunk: AudioChunk): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.running)
      return;
    const base64 = chunk.buffer.toString("base64");
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: base64,
      }),
    );
  }

  private wireHandlers(): void {
    if (!this.ws) return;

    this.ws.on("message", (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());

      switch (msg.message_type as string) {
        case "session_started":
          console.log("[transcription] Session started");
          break;

        case "partial_transcript":
          if (msg.text) {
            console.log(
              `[transcription] Partial: ${(msg.text as string).slice(0, 50)}`,
            );
            this.emit("partial", {
              text: msg.text,
            } satisfies PartialTranscript);
          }
          break;

        case "committed_transcript":
          if (msg.text) {
            console.log(
              `[transcription] Final: ${(msg.text as string).slice(0, 50)}`,
            );
            this.emit("final", { text: msg.text } satisfies FinalTranscript);
          }
          break;

        case "committed_transcript_with_timestamps":
          if (msg.text) {
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
              text: msg.text,
              startTime,
              endTime,
              words,
            } satisfies FinalTranscript);
          }
          break;
      }
    });

    this.ws.on("error", (err: Error) => {
      console.error("[transcription] WebSocket error:", err.message);
      this.scheduleReconnect();
    });

    this.ws.on("close", () => {
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        "[transcription] Max reconnect attempts reached, giving up",
      );
      return;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    this.ws = null;
    this.running = false;
    try {
      await this.start();
    } catch (err) {
      console.error(
        "[transcription] Reconnect failed:",
        (err as Error).message,
      );
      this.scheduleReconnect();
    }
  }
}
