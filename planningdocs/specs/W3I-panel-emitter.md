# W3I — PanelEmitter

**File to create:** `src/services/panel-emitter.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts` (both already exist)
**Depended on by:** RoomManager (sends panel updates to browsers)

---

## Purpose

Manages WebSocket connections for the `/ws/panels` channel and provides methods to send JSON messages to specific users or broadcast to all users in a room.

---

## Imports

```ts
import type WebSocket from "ws";
import type { UserId, RoomId, PanelMessage } from "../types.js";
import type { IPanelEmitter } from "../interfaces.js";
```

---

## Class: PanelEmitter

```ts
export class PanelEmitter implements IPanelEmitter
```

### Private State

```ts
private sockets = new Map<UserId, WebSocket>();
private roomMembership = new Map<UserId, RoomId>();
```

### Methods

**`registerSocket(userId: UserId, ws: WebSocket): void`**
1. If a socket already exists for this userId, close the old one with code 4002 ("replaced")
2. `this.sockets.set(userId, ws)`
3. On ws `"close"`: `this.sockets.delete(userId); this.roomMembership.delete(userId)`

**`unregisterSocket(userId: UserId): void`**
1. `this.sockets.delete(userId)`
2. `this.roomMembership.delete(userId)`

**`setRoom(userId: UserId, roomId: RoomId): void`**
- `this.roomMembership.set(userId, roomId)`

**`sendToUser(userId: UserId, message: PanelMessage): void`**
1. `const ws = this.sockets.get(userId)`
2. If `!ws` or `ws.readyState !== ws.OPEN`, return silently
3. `ws.send(JSON.stringify(message))`

**`broadcast(roomId: RoomId, message: PanelMessage): void`**
1. `const payload = JSON.stringify(message)` — serialize once
2. Iterate `this.roomMembership` entries
3. For each `[userId, memberRoomId]` where `memberRoomId === roomId`:
   - `const ws = this.sockets.get(userId)`
   - If `ws && ws.readyState === ws.OPEN`:
     - `ws.send(payload)`

---

## Design Notes

- `broadcast` serializes JSON once, sends the same string to all sockets in the room
- Socket replacement handles browser tab refresh (new connection replaces stale one)
- Cleanup on socket close prevents memory leaks
- No buffering — if socket is not open, message is dropped silently (acceptable for real-time UI updates)

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `IPanelEmitter` interface
- `sendToUser` delivers JSON to specific user's WebSocket
- `broadcast` delivers to all users in a room
- Handles socket replacement gracefully
- Cleans up on socket close
- JSON serialized once per broadcast (efficient)
