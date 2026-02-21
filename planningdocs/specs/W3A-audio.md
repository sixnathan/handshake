# W3A — AudioService

**File to create:** `src/services/audio.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts` (both already exist)
**Depended on by:** TranscriptionService (feeds chunks), RoomManager (wires pipeline)

---

## Purpose

Buffers raw PCM audio bytes and emits fixed-size 250ms chunks at regular intervals. Sits between the WebSocket binary input and the TranscriptionService.

---

## Imports

```ts
import { EventEmitter } from "eventemitter3";
import type { AudioChunk } from "../types.js";
import type { IAudioService } from "../interfaces.js";
```

---

## Class: AudioService

```ts
export class AudioService extends EventEmitter implements IAudioService
```

### Private State

```ts
private buffer: Buffer = Buffer.alloc(0);
private chunkInterval: ReturnType<typeof setInterval> | null = null;
private sampleRate = 16000;
private chunkSizeBytes = 0; // computed from sampleRate
```

### Constructor

No arguments. Compute nothing yet — wait for `setSampleRate`.

### Methods

**`setSampleRate(rate: number): void`**
- Store `this.sampleRate = rate`
- Compute `this.chunkSizeBytes = Math.floor(rate * 0.25) * 2`
  - 250ms of 16-bit mono samples = sampleRate × 0.25 samples × 2 bytes/sample
  - At 16kHz: 4000 samples × 2 = 8000 bytes per chunk
- If interval already running, restart it (call `stopInterval()` then `startInterval()`)

**`feedRawAudio(raw: Buffer): void`**
- `this.buffer = Buffer.concat([this.buffer, raw])`
- If interval not running and chunkSizeBytes > 0, call `startInterval()`

**`destroy(): void`**
- Call `stopInterval()`
- `this.buffer = Buffer.alloc(0)`
- `this.removeAllListeners()`

### Private Methods

**`private startInterval(): void`**
- If already running, return
- `this.chunkInterval = setInterval(() => this.flush(), 250)`

**`private stopInterval(): void`**
- If `this.chunkInterval` is not null:
  - `clearInterval(this.chunkInterval)`
  - `this.chunkInterval = null`

**`private flush(): void`**
- While `this.buffer.length >= this.chunkSizeBytes`:
  - `const slice = this.buffer.subarray(0, this.chunkSizeBytes)`
  - `this.buffer = this.buffer.subarray(this.chunkSizeBytes)`
  - Emit `"chunk"` with:
    ```ts
    { buffer: Buffer.from(slice), sampleRate: this.sampleRate, timestamp: Date.now() } satisfies AudioChunk
    ```
  - Note: `Buffer.from(slice)` creates a copy so the original buffer can be GC'd

---

## Events Emitted

| Event | Payload | When |
|-------|---------|------|
| `"chunk"` | `AudioChunk` | Every 250ms when buffer has enough data |

---

## Edge Cases

- `feedRawAudio` called before `setSampleRate`: buffer accumulates, no chunks emitted (interval not started because chunkSizeBytes is 0)
- Empty buffer at interval tick: `flush()` loop body doesn't execute (while condition false)
- `destroy()` while interval running: interval cleared, buffer reset

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `IAudioService` interface
- Emits `"chunk"` events with correct `AudioChunk` shape
- 250ms interval, 8000 bytes per chunk at 16kHz
- No mutation of input buffers
