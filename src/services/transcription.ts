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
            this.emit("partial", {
              text: partialText,
            } satisfies PartialTranscript);
          }
          break;

        case "committed_transcript":
          if (msg.text) {
            const finalText = msg.text as string;
            console.log(
              `[transcription:${this.label}] Final: ${finalText.slice(0, 50)}`,
            );
            this.emit("final", { text: finalText } satisfies FinalTranscript);
          }
          break;

        case "committed_transcript_with_timestamps":
          if (msg.text) {
            const tsText = msg.text as string;
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
      }
    });

    this.ws.on("error", (err: Error) => {
      console.error(
        `[transcription:${this.label}] WebSocket error:`,
        err.message,
      );
      this.scheduleReconnect();
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      console.log(
        `[transcription:${this.label}] WebSocket closed (code=${code}, reason=${reason.toString()}, sent=${this.chunksSent}, dropped=${this.chunksDropped})`,
      );
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
