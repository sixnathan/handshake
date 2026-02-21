# W4B — NegotiationService

**File to create:** `src/services/negotiation.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts` (both already exist)
**Depended on by:** RoomManager (creates per-room), AgentService tools (call methods)

---

## Purpose

Manages the agent-to-agent negotiation protocol. Tracks negotiation state, enforces round limits and timeouts, and emits lifecycle events. This is a complete rewrite — the old version was human-driven; the new version coordinates autonomous agent proposals.

---

## Imports

```ts
import { EventEmitter } from "eventemitter3";
import type {
  AgentMessage,
  AgentProposal,
  Negotiation,
  NegotiationId,
  NegotiationRound,
  NegotiationStatus,
  UserId,
} from "../types.js";
import type { INegotiationService } from "../interfaces.js";
```

---

## Class: NegotiationService

```ts
export class NegotiationService extends EventEmitter implements INegotiationService
```

### Constructor

```ts
constructor(private readonly roomId: string)
```

### Private State

```ts
private negotiations = new Map<NegotiationId, Negotiation>();
private activeNegotiationId: NegotiationId | null = null;
private roundTimer: ReturnType<typeof setTimeout> | null = null;
private totalTimer: ReturnType<typeof setTimeout> | null = null;
private readonly MAX_ROUNDS = 5;
private readonly ROUND_TIMEOUT_MS = 30_000;
private readonly TOTAL_TIMEOUT_MS = 120_000;
```

### Methods

**`createNegotiation(initiator: UserId, responder: UserId, proposal: AgentProposal): Negotiation`**
1. If there's already an active negotiation, throw `Error("Negotiation already in progress")`
2. Generate ID: `const id = "neg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6)`
3. Build initial round:
   ```ts
   const round: NegotiationRound = {
     round: 1,
     fromAgent: initiator,
     proposal,
     action: "propose",
     timestamp: Date.now(),
   };
   ```
4. Build negotiation:
   ```ts
   const negotiation: Negotiation = {
     id,
     roomId: this.roomId,
     status: "proposed",
     initiator,
     responder,
     currentProposal: proposal,
     rounds: [round],
     maxRounds: this.MAX_ROUNDS,
     roundTimeoutMs: this.ROUND_TIMEOUT_MS,
     totalTimeoutMs: this.TOTAL_TIMEOUT_MS,
     createdAt: Date.now(),
     updatedAt: Date.now(),
   };
   ```
5. Store: `this.negotiations.set(id, negotiation)`
6. `this.activeNegotiationId = id`
7. Start timeouts: `this.startTimers(id)`
8. Emit `"negotiation:started"` with negotiation
9. Return negotiation

**`handleAgentMessage(message: AgentMessage): void`**
1. `const negotiation = this.negotiations.get(message.negotiationId)`
2. If `!negotiation`, log warning and return
3. If `negotiation.status !== "proposed" && negotiation.status !== "countering"`:
   - Log warning: "Received message for non-active negotiation"
   - Return
4. Switch on `message.type`:
   - `"agent_proposal"`: handle same as counter (shouldn't happen mid-negotiation, but defensive)
   - `"agent_counter"`:
     1. Check round limit: if `negotiation.rounds.length >= this.MAX_ROUNDS`:
        - Expire the negotiation (see `expireNegotiation`)
        - Return
     2. Build new round:
        ```ts
        const round: NegotiationRound = {
          round: negotiation.rounds.length + 1,
          fromAgent: message.fromAgent,
          proposal: message.proposal,
          action: "counter",
          reason: message.reason,
          timestamp: Date.now(),
        };
        ```
     3. Update negotiation (immutable):
        ```ts
        const updated: Negotiation = {
          ...negotiation,
          status: "countering",
          currentProposal: message.proposal,
          rounds: [...negotiation.rounds, round],
          updatedAt: Date.now(),
        };
        ```
     4. Store and emit: `this.negotiations.set(updated.id, updated); this.emit("negotiation:updated", updated)`
     5. Reset round timer
   - `"agent_accept"`:
     1. Build round:
        ```ts
        const round: NegotiationRound = {
          round: negotiation.rounds.length + 1,
          fromAgent: message.fromAgent,
          proposal: negotiation.currentProposal,
          action: "accept",
          timestamp: Date.now(),
        };
        ```
     2. Update: `{ ...negotiation, status: "accepted", rounds: [...negotiation.rounds, round], updatedAt: Date.now() }`
     3. Clear timers
     4. Store and emit `"negotiation:agreed"` with updated
     5. `this.activeNegotiationId = null`
   - `"agent_reject"`:
     1. Build round with reason
     2. Update status to `"rejected"`
     3. Clear timers
     4. Store and emit `"negotiation:rejected"` with updated
     5. `this.activeNegotiationId = null`

**`getNegotiation(id: NegotiationId): Negotiation | undefined`**
- Return `this.negotiations.get(id)`

**`getActiveNegotiation(): Negotiation | undefined`**
- If `!this.activeNegotiationId`, return `undefined`
- Return `this.negotiations.get(this.activeNegotiationId)`

**`destroy(): void`**
- Clear all timers
- `this.removeAllListeners()`

### Private Methods

**`private startTimers(negotiationId: NegotiationId): void`**
1. Clear existing timers
2. Round timer: `this.roundTimer = setTimeout(() => this.handleRoundTimeout(negotiationId), this.ROUND_TIMEOUT_MS)`
3. Total timer: `this.totalTimer = setTimeout(() => this.handleTotalTimeout(negotiationId), this.TOTAL_TIMEOUT_MS)`

**`private resetRoundTimer(negotiationId: NegotiationId): void`**
1. If `this.roundTimer`: `clearTimeout(this.roundTimer)`
2. `this.roundTimer = setTimeout(() => this.handleRoundTimeout(negotiationId), this.ROUND_TIMEOUT_MS)`

**`private clearTimers(): void`**
1. If `this.roundTimer`: `clearTimeout(this.roundTimer)`
2. If `this.totalTimer`: `clearTimeout(this.totalTimer)`
3. `this.roundTimer = null; this.totalTimer = null`

**`private handleRoundTimeout(negotiationId: NegotiationId): void`**
- Log: "[negotiation] Round timeout for ${negotiationId}"
- Call `this.expireNegotiation(negotiationId, "Round timeout — no response within 30 seconds")`

**`private handleTotalTimeout(negotiationId: NegotiationId): void`**
- Log: "[negotiation] Total timeout for ${negotiationId}"
- Call `this.expireNegotiation(negotiationId, "Total timeout — negotiation exceeded 2 minutes")`

**`private expireNegotiation(negotiationId: NegotiationId, reason: string): void`**
1. `const negotiation = this.negotiations.get(negotiationId)`
2. If `!negotiation` or terminal status, return
3. Update: `{ ...negotiation, status: "expired", updatedAt: Date.now() }`
4. Clear timers
5. Store and emit `"negotiation:expired"` with updated
6. `this.activeNegotiationId = null`

---

## Events Emitted

| Event | Payload | When |
|-------|---------|------|
| `"negotiation:started"` | `Negotiation` | New negotiation created |
| `"negotiation:updated"` | `Negotiation` | Counter-proposal received |
| `"negotiation:agreed"` | `Negotiation` | Both agents agree |
| `"negotiation:rejected"` | `Negotiation` | Agent explicitly rejects |
| `"negotiation:expired"` | `Negotiation` | Round or total timeout |

---

## Protocol Flow

```
Agent A (initiator)                  NegotiationService                Agent B (responder)
─────────────────                    ──────────────────                ─────────────────
                                     createNegotiation(A, B, proposal)
                                     → "negotiation:started"
                                     → AgentMessage{agent_proposal} to B
                                                                       receiveAgentMessage
                                                                       → LLM evaluates
                                                                       → accept/counter/reject
                                     handleAgentMessage({agent_counter})
                                     → "negotiation:updated"
                                     → AgentMessage{agent_counter} to A
receiveAgentMessage
→ LLM evaluates
→ accept/counter/reject
                                     handleAgentMessage({agent_accept})
                                     → "negotiation:agreed"
```

---

## Edge Cases

- Double negotiation: throws if active negotiation exists
- Message for unknown negotiation: logs warning, drops message
- Message for terminal negotiation: logs warning, drops message
- Round limit exceeded: auto-expires
- 30s round timeout: auto-expires
- 2min total timeout: auto-expires
- destroy() clears all timers

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `INegotiationService` interface
- Max 5 rounds enforced
- 30s round timeout, 2min total timeout
- Immutable negotiation updates (spread + set)
- All lifecycle events emitted
- Clean destruction
