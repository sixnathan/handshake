# Prompt 03 — Audio and Transcription Services

**Phase:** 2 (services — parallelizable)
**Depends on:** 01-types-and-interfaces
**Blocks:** Phase 3 (agent/tools), Phase 4 (orchestrators)

## Task

Create AudioService and TranscriptionService. These handle mic input buffering and real-time speech-to-text via ElevenLabs.

---

## File 1: src/services/audio.ts

AudioService buffers raw PCM audio and emits fixed-size chunks at regular intervals.

### Class: AudioService extends EventEmitter

**Constructor:** No arguments needed.

**Private state:**
- `buffer: Buffer` — accumulated raw PCM (starts as `Buffer.alloc(0)`)
- `chunkInterval: ReturnType<typeof setInterval> | null`
- `sampleRate: number`
- `capturing: boolean`

**`startCapture(sampleRate: number): Promise<void>`**
- Store sampleRate
- Set capturing = true
- Calculate chunk size: `Math.floor(sampleRate * 0.25) * 2` (250ms of 16-bit samples = sampleRate * 0.25 samples * 2 bytes/sample)
- Start setInterval at 250ms:
  - While buffer.length >= chunkSize:
    - Slice chunkSize bytes from front of buffer
    - Update buffer to remainder
    - Emit `"audio:chunk"` with `AudioChunk { buffer: slice, sampleRate, timestamp: Date.now() }`

**`stopCapture(): void`**
- Clear the interval
- Set capturing = false
- Reset buffer to empty

**`feedRawAudio(raw: Buffer): void`**
- If not capturing, return
- Concatenate: `buffer = Buffer.concat([buffer, raw])`

---

## File 2: src/services/transcription.ts

TranscriptionService connects to ElevenLabs Scribe v2 Realtime WebSocket for speech-to-text.

### Class: TranscriptionService extends EventEmitter

**Constructor args:**
```ts
{ apiKey: string; region?: string; language?: string }
```

**Private state:**
- `ws: WebSocket | null`
- `apiKey: string`
- `region: string` (default "us")
- `language: string` (default "en")
- `running: boolean`

**`start(): Promise<void>`**
- Build URL with query params:
  ```
  wss://api.elevenlabs.io/v1/speech-to-text/realtime
    ?model_id=scribe_v2_realtime
    &language_code=${language}
    &commit_strategy=vad
  ```
- Create WebSocket with headers: `{ "xi-api-key": apiKey }`
- Set up message handler (see below)
- Return promise that resolves on WebSocket "open" event, rejects on "error"
- Set running = true

**`stop(): Promise<void>`**
- Set running = false
- Close WebSocket if open

**`feedAudio(chunk: AudioChunk): void`**
- If ws not open or not running, return
- Convert chunk.buffer to base64
- Send JSON: `{ type: "input_audio_chunk", data: base64String }`

**WebSocket message handler:**
Parse each incoming JSON message. Switch on `message_type`:

- `"session_started"`: log it, no action
- `"partial_transcript"`: emit `"transcript:partial"` with `{ text: msg.text }`
- `"committed_transcript"`: if msg.text is non-empty, emit `"transcript:final"` with `{ text: msg.text, startTime: undefined, endTime: undefined }`
- `"committed_transcript_with_timestamps"`: if msg.text is non-empty:
  - Extract `words` array: each has `{ word, start, end, confidence }`
  - Map to `WordTimestamp[]`
  - Calculate startTime = first word's start, endTime = last word's end
  - Emit `"transcript:final"` with `{ text: msg.text, startTime, endTime, words }`

**WebSocket error/close handling:**
- On error: log and attempt reconnect after 2s if running
- On close: attempt reconnect after 2s if running
- Reconnect: call `start()` again, catch and ignore errors

### Import notes
- Use the `ws` package (`import WebSocket from "ws"`) for server-side WebSocket
- Import `AudioChunk` from `../types.js`
- Import `FinalTranscript, PartialTranscript` from `../interfaces.js`

---

## Verification

- AudioService emits audio:chunk events at ~250ms intervals
- TranscriptionService constructs correct ElevenLabs WebSocket URL
- feedAudio sends base64-encoded audio
- Handles all 4 ElevenLabs message types
- Auto-reconnect on disconnect
- Both classes extend EventEmitter from eventemitter3
