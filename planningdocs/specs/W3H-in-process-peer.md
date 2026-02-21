# W3H — InProcessPeer

**File to create:** `src/services/in-process-peer.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts` (both already exist)
**Depended on by:** NegotiationService (sends/receives agent messages), RoomManager (creates pairs)

---

## Purpose

In-memory bidirectional message bus between two agents in the same room. When Agent A sends a message, Agent B receives it instantly (same process, no network). Used for agent-to-agent negotiation protocol.

---

## Imports

```ts
import { EventEmitter } from "eventemitter3";
import type { AgentMessage, UserId } from "../types.js";
import type { IInProcessPeer } from "../interfaces.js";
```

---

## Class: InProcessPeer

```ts
export class InProcessPeer extends EventEmitter implements IInProcessPeer
```

### Private State

```ts
private partner: InProcessPeer | null = null;
private otherUserId: UserId;
```

### Constructor

```ts
constructor(private readonly myUserId: UserId, otherUserId: UserId)
```

- `this.otherUserId = otherUserId`

### Methods

**`send(message: AgentMessage): void`**
1. If `!this.partner`, throw `Error("No partner connected")`
2. `this.partner.emit("message", message)` — deliver to the other side

**`getOtherUserId(): UserId`**
- Return `this.otherUserId`

### Static Factory

**`static createPair(userIdA: UserId, userIdB: UserId): [InProcessPeer, InProcessPeer]`**
1. Create two instances:
   ```ts
   const peerA = new InProcessPeer(userIdA, userIdB);
   const peerB = new InProcessPeer(userIdB, userIdA);
   ```
2. Wire them:
   ```ts
   peerA.partner = peerB;
   peerB.partner = peerA;
   ```
3. Return `[peerA, peerB]`

This factory is the primary way to create peers. Direct construction is used by the factory only.

---

## Events Emitted

| Event | Payload | When |
|-------|---------|------|
| `"message"` | `AgentMessage` | Partner calls `send()` |

---

## Usage Pattern (by RoomManager)

```ts
const [peerA, peerB] = InProcessPeer.createPair(userIdA, userIdB);

// Wire to negotiation services
peerA.on("message", (msg) => negotiationA.handleAgentMessage(msg));
peerB.on("message", (msg) => negotiationB.handleAgentMessage(msg));

// Agents send proposals through their peer
negotiationA.on("send", (msg) => peerA.send(msg));
negotiationB.on("send", (msg) => peerB.send(msg));
```

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `IInProcessPeer` interface
- `createPair` returns two wired peers
- `send` on A emits `"message"` on B and vice versa
- Throws if no partner (defensive, shouldn't happen with factory)
- Zero network overhead — same-process event emission
