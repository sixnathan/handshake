import { describe, it, expect, beforeAll } from "vitest";
import { loadConfig } from "../../src/config.js";
import type { AppConfig } from "../../src/types.js";
import WebSocket from "ws";

describe("ElevenLabs Integration (real API)", () => {
  let config: AppConfig;

  beforeAll(() => {
    config = loadConfig();
  });

  it("should connect to ElevenLabs Scribe v2 WebSocket", async () => {
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&language_code=${config.elevenlabs.language}&commit_strategy=vad`;

    const ws = new WebSocket(url, {
      headers: { "xi-api-key": config.elevenlabs.apiKey },
    });

    const result = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Connection timeout"));
      }, 10000);

      ws.on("open", () => {
        clearTimeout(timeout);
        resolve("connected");
      });

      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.message_type === "session_started") {
          clearTimeout(timeout);
          resolve("session_started");
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect(["connected", "session_started"]).toContain(result);
    ws.close();
  }, 15000);

  it("should accept audio data without errors", async () => {
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&language_code=${config.elevenlabs.language}&commit_strategy=vad`;

    const ws = new WebSocket(url, {
      headers: { "xi-api-key": config.elevenlabs.apiKey },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });

    // Send a chunk of silence (16kHz, 16-bit, 250ms = 8000 bytes of zeros)
    const silenceBuffer = Buffer.alloc(8000, 0);
    const base64 = silenceBuffer.toString("base64");

    // Should not throw or error
    ws.send(JSON.stringify({ type: "input_audio_chunk", data: base64 }));

    // Wait briefly for any error response
    const noError = await new Promise<boolean>((resolve) => {
      let gotError = false;
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.message_type === "error") {
          gotError = true;
        }
      });
      setTimeout(() => {
        resolve(!gotError);
      }, 2000);
    });

    expect(noError).toBe(true);
    ws.close();
  }, 15000);
});
