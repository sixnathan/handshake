import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/session-store";

export function useAudioWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const userId = useSessionStore((s) => s.userId);
  const roomId = useSessionStore((s) => s.roomId);
  const audioRelay = useSessionStore((s) => s.audioRelay);
  const micMuted = useSessionStore((s) => s.micMuted);
  const audioRelayRef = useRef(audioRelay);
  const micMutedRef = useRef(micMuted);

  // Keep refs in sync
  useEffect(() => {
    audioRelayRef.current = audioRelay;
  }, [audioRelay]);

  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);

  useEffect(() => {
    if (!userId || !roomId) return;

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws/audio?room=${encodeURIComponent(roomId)}&user=${encodeURIComponent(userId)}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      startMicrophone(ws, micMutedRef);
    });

    // Playback
    let playbackContext: AudioContext | null = null;
    let nextPlayTime = 0;

    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") return;
      if (!audioRelayRef.current) return;

      if (!playbackContext) {
        playbackContext = new AudioContext({ sampleRate: 16000 });
        nextPlayTime = playbackContext.currentTime;
      }

      const int16 = new Int16Array(event.data as ArrayBuffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i]! / (int16[i]! < 0 ? 0x8000 : 0x7fff);
      }

      const buffer = playbackContext.createBuffer(1, float32.length, 16000);
      buffer.getChannelData(0).set(float32);

      const source = playbackContext.createBufferSource();
      source.buffer = buffer;
      source.connect(playbackContext.destination);

      const now = playbackContext.currentTime;
      if (nextPlayTime < now) nextPlayTime = now;
      source.start(nextPlayTime);
      nextPlayTime += buffer.duration;
    });

    return () => {
      ws.close();
      wsRef.current = null;
      if (playbackContext) {
        playbackContext.close().catch(() => {});
      }
    };
  }, [userId, roomId]);

  return wsRef;
}

function resampleTo16k(float32: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000) return float32;
  const ratio = fromRate / 16000;
  const outLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, float32.length - 1);
    const frac = srcIdx - lo;
    out[i] = float32[lo]! * (1 - frac) + float32[hi]! * frac;
  }
  return out;
}

async function startMicrophone(
  ws: WebSocket,
  micMutedRef: React.RefObject<boolean>,
): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Don't force 16kHz — mobile browsers ignore it and silently use 48kHz.
    // Instead, let the browser pick its native rate and resample ourselves.
    const audioContext = new AudioContext();
    const actualRate = audioContext.sampleRate;
    console.log(`[audio] AudioContext sample rate: ${actualRate}`);

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (micMutedRef.current) return;
      const raw = event.inputBuffer.getChannelData(0);
      const resampled = resampleTo16k(raw, actualRate);
      const int16 = new Int16Array(resampled.length);
      for (let i = 0; i < resampled.length; i++) {
        const s = Math.max(-1, Math.min(1, resampled[i]!));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      ws.send(int16.buffer);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  } catch (err) {
    console.error("Microphone error:", err);
    useSessionStore.getState().setSessionStatus("Microphone access denied");
  }
}
