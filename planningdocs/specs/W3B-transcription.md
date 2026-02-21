# W3B — TranscriptionService

**File to create:** `src/services/transcription.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts` (both already exist)
**Depended on by:** RoomManager (wires audio → transcription → panels)

---

## Purpose

Connects to the ElevenLabs Scribe v2 Realtime WebSocket API for speech-to-text. Receives `AudioChunk`s, sends base64-encoded audio, and emits partial/final transcript events.

---

## Imports

```ts
import WebSocket from "ws";
import { EventEmitter } from "eventemitter3";
import type { AudioChunk } from "../types.js";
import type { ITranscriptionService, FinalTranscript, PartialTranscript } from "../interfaces.js";
```

---

## Class: TranscriptionService

```ts
export class TranscriptionService extends EventEmitter implements ITranscriptionService
```

### Constructor

```ts
constructor(private readonly config: {
  apiKey: string;
  region: string;
  language: string;
})
```

### Private State

```ts
private ws: WebSocket | null = null;
private running = false;
private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
```

### Methods

**`start(): Promise<void>`**
1. If already running, return
2. Set `this.running = true`
3. Build URL:
   ```
   wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&language_code=${this.config.language}&commit_strategy=vad
   ```
4. Create WebSocket:
   ```ts
   this.ws = new WebSocket(url, { headers: { "xi-api-key": this.config.apiKey } });
   ```
5. Return a Promise:
   - Resolve on `"open"` event
   - Reject on `"error"` event (only for the initial connection)
6. Wire up persistent handlers (see below)

**`stop(): Promise<void>`**
1. `this.running = false`
2. Clear reconnect timer if any
3. If ws exists and open: `this.ws.close()`
4. `this.ws = null`

**`feedAudio(chunk: AudioChunk): void`**
1. If `!this.ws` or `this.ws.readyState !== WebSocket.OPEN` or `!this.running`, return
2. Convert: `const base64 = chunk.buffer.toString("base64")`
3. Send: `this.ws.send(JSON.stringify({ type: "input_audio_chunk", data: base64 }))`

### Private: WebSocket Event Handlers

Wire these after creating the WebSocket in `start()`:

**`this.ws.on("message", (data) => { ... })`**
1. Parse: `const msg = JSON.parse(data.toString())`
2. Switch on `msg.message_type`:
   - `"session_started"`: no action (optional: log)
   - `"partial_transcript"`:
     - If `msg.text` is non-empty:
       - Emit `"partial"` with `{ text: msg.text } satisfies PartialTranscript`
   - `"committed_transcript"`:
     - If `msg.text` is non-empty:
       - Emit `"final"` with `{ text: msg.text } satisfies FinalTranscript`
   - `"committed_transcript_with_timestamps"`:
     - If `msg.text` is non-empty:
       - Map `msg.words` to `WordTimestamp[]`: `{ word: w.word, start: w.start, end: w.end, confidence: w.confidence }`
       - Compute `startTime` = first word's `start`, `endTime` = last word's `end`
       - Emit `"final"` with `{ text: msg.text, startTime, endTime, words } satisfies FinalTranscript`

**`this.ws.on("error", (err) => { ... })`**
- Log: `console.error("[transcription] WebSocket error:", err.message)`
- Call `this.scheduleReconnect()`

**`this.ws.on("close", () => { ... })`**
- Call `this.scheduleReconnect()`

### Private: Reconnection

**`private scheduleReconnect(): void`**
1. If `!this.running`, return (intentional shutdown)
2. Clear existing reconnect timer
3. `this.reconnectTimer = setTimeout(() => { this.reconnect() }, 2000)`

**`private async reconnect(): Promise<void>`**
1. `this.ws = null`
2. Try `await this.start()`
3. Catch and log errors (don't re-throw — will retry on next close/error)

---

## Events Emitted

| Event | Payload | When |
|-------|---------|------|
| `"partial"` | `PartialTranscript` | ElevenLabs sends partial transcript |
| `"final"` | `FinalTranscript` | ElevenLabs commits a transcript segment |

---

## Edge Cases

- WebSocket disconnects mid-stream: auto-reconnect after 2s
- `feedAudio` called while reconnecting: silently dropped (ws not open)
- `stop()` during reconnect: clears timer, prevents reconnect
- Empty text in committed transcript: not emitted

---

## ElevenLabs Scribe v2 Message Types Reference

```ts
// Incoming messages
type ElevenLabsMessage =
  | { message_type: "session_started" }
  | { message_type: "partial_transcript"; text: string }
  | { message_type: "committed_transcript"; text: string }
  | { message_type: "committed_transcript_with_timestamps"; text: string; words: Array<{ word: string; start: number; end: number; confidence: number }> };
```

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `ITranscriptionService` interface
- Connects to correct ElevenLabs WebSocket URL with API key header
- Sends base64-encoded audio chunks
- Emits `"partial"` and `"final"` events with correct shapes
- Auto-reconnects on error/close
- Clean shutdown via `stop()`
