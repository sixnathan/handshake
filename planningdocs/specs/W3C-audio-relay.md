# W3C — AudioRelayService

**File to create:** `src/services/audio-relay.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts` (both already exist)
**Depended on by:** RoomManager (registers sockets, calls relayAudio)

---

## Purpose

Server-side audio relay between two users in a room. When user A sends PCM audio, it gets forwarded to user B's playback WebSocket and vice versa. This replaces WebRTC — audio goes through the server.

---

## Imports

```ts
import type WebSocket from "ws";
import type { UserId } from "../types.js";
import type { IAudioRelayService } from "../interfaces.js";
```

---

## Class: AudioRelayService

```ts
export class AudioRelayService implements IAudioRelayService
```

### Private State

```ts
private sockets = new Map<UserId, WebSocket>();
```

### Methods

**`registerUser(userId: UserId, ws: WebSocket): void`**
1. If a socket already exists for this userId, close the old one with code 4002 ("replaced")
2. Store: `this.sockets.set(userId, ws)`
3. On ws `"close"`: `this.sockets.delete(userId)`

**`unregisterUser(userId: UserId): void`**
1. `this.sockets.delete(userId)`

**`relayAudio(fromUserId: UserId, buffer: Buffer): void`**
1. Iterate `this.sockets` entries
2. For each `[userId, ws]` where `userId !== fromUserId`:
   - If `ws.readyState === ws.OPEN`:
     - `ws.send(buffer)` — send raw binary PCM
3. This means in a 2-person room, audio from A goes to B only

**`destroy(): void`**
1. `this.sockets.clear()`
   - Note: don't close the sockets here — they're managed by the caller (RoomManager)

---

## Design Notes

- The audio WebSocket is **bidirectional**: browser sends mic PCM → server, server sends other user's PCM → browser
- The same WebSocket that receives audio from user A is also used to send user B's audio to user A
- Binary data only — no JSON framing on the audio channel
- At 16kHz 16-bit mono, audio is ~32KB/s per direction. Server bandwidth: ~64KB/s per room

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `IAudioRelayService` interface
- `relayAudio` sends to all users except sender
- Handles socket replacement gracefully
- Cleans up on socket close
- No JSON overhead — raw binary relay
