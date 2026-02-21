# W6B — RoomManager

**File to create:** `src/services/room-manager.ts`
**Depends on:** ALL services, `src/tools.ts`, `src/providers/`, `src/types.ts`, `src/interfaces.ts`
**Depended on by:** `src/server.ts` (passes WS connections to room manager)

---

## Purpose

The core orchestrator. Manages rooms, user slots, and wires the full audio → transcription → trigger → agent → negotiation → document → payment pipeline for each room.

---

## Imports

```ts
import type WebSocket from "ws";
import type { AppConfig, UserId, RoomId, AgentProfile, AgentMessage, ClientMessage, PanelMessage } from "../types.js";
import type { FinalTranscript, PartialTranscript, IRoomManager } from "../interfaces.js";
import { AudioService } from "./audio.js";
import { AudioRelayService } from "./audio-relay.js";
import { TranscriptionService } from "./transcription.js";
import { TriggerDetector } from "./trigger-detector.js";
import { SessionService } from "./session.js";
import { AgentService } from "./agent.js";
import { NegotiationService } from "./negotiation.js";
import { DocumentService } from "./document.js";
import { PaymentService } from "./payment.js";
import { MonzoService } from "./monzo.js";
import { ProfileManager } from "./profile-manager.js";
import { InProcessPeer } from "./in-process-peer.js";
import { PanelEmitter } from "./panel-emitter.js";
import { createLLMProvider } from "../providers/index.js";
import { buildTools } from "../tools.js";
import type { ToolDependencies } from "../tools.js";
```

---

## Internal Types

```ts
interface UserSlot {
  userId: UserId;
  audio: AudioService;
  transcription: TranscriptionService;
  session: SessionService;
  agent: AgentService;
  peer: InProcessPeer | null;
  monzo: MonzoService | null;
}

interface Room {
  id: RoomId;
  slots: Map<UserId, UserSlot>;
  audioRelay: AudioRelayService;
  triggerDetector: TriggerDetector;
  negotiation: NegotiationService | null;
  document: DocumentService | null;
  payment: PaymentService;
  paired: boolean;
}

const MAX_USERS_PER_ROOM = 2;
const MAX_ROOMS = 50;
```

---

## Class: RoomManager

```ts
export class RoomManager implements IRoomManager
```

### Constructor

```ts
constructor(
  private readonly config: AppConfig,
  private readonly panelEmitter: PanelEmitter,
  private readonly profileManager: ProfileManager,
)
```

### Private State

```ts
private rooms = new Map<RoomId, Room>();
```

### Public Methods

**`joinRoom(roomId: RoomId, userId: UserId, profile: AgentProfile): void`**
1. `this.profileManager.setProfile(userId, profile)`
2. Get or create room: `const room = this.getOrCreateRoom(roomId)`
3. If `!room`: throw `Error("Maximum rooms reached")`
4. If `room.slots.size >= MAX_USERS_PER_ROOM`: throw `Error("Room is full")`
5. If `room.slots.has(userId)`: return (already joined)
6. Create user slot (see `createUserSlot` below)
7. `room.slots.set(userId, slot)`
8. Broadcast room status
9. If `room.slots.size === 2 && !room.paired`: call `pairUsers(room)`

**`leaveRoom(roomId: RoomId, userId: UserId): void`**
1. `const room = this.rooms.get(roomId)`; if `!room`, return
2. Call `cleanupSlot(room, userId)`
3. If `room.slots.size === 0`:
   - `room.audioRelay.destroy()`
   - `room.triggerDetector.destroy()`
   - `room.negotiation?.destroy()`
   - `this.rooms.delete(roomId)`

**`registerAudioSocket(roomId: RoomId, userId: UserId, ws: WebSocket): void`**
1. `const room = this.rooms.get(roomId)`; if `!room`, close ws with 4003
2. `const slot = room.slots.get(userId)`; if `!slot`, close ws with 4004
3. Register for relay: `room.audioRelay.registerUser(userId, ws)`
4. Wire incoming audio:
   ```ts
   ws.on("message", (data) => {
     if (typeof data !== "string") {
       const buffer = Buffer.from(data as ArrayBuffer);
       slot.audio.feedRawAudio(buffer);
       room.audioRelay.relayAudio(userId, buffer);
     }
   });
   ```
5. On close: `room.audioRelay.unregisterUser(userId)`

**`registerPanelSocket(roomId: RoomId, userId: UserId, ws: WebSocket): void`**
1. `this.panelEmitter.registerSocket(userId, ws)`
2. `this.panelEmitter.setRoom(userId, roomId)`
3. Wire client messages:
   ```ts
   ws.on("message", (data) => {
     try {
       const msg = JSON.parse(data.toString()) as ClientMessage;
       this.handleClientMessage(userId, msg);
     } catch { /* ignore malformed JSON */ }
   });
   ```
4. Send current room status to the newly connected user

**`handleClientMessage(userId: UserId, message: ClientMessage): void`**
- Switch on `message.type`:
  - `"set_profile"`: `this.profileManager.setProfile(userId, message.profile)`
  - `"sign_document"`: handle document signing (see below)
  - `"set_trigger_keyword"`: find user's room, set keyword on trigger detector
  - `"join_room"`: no-op (handled by server level)

**`getRoomUsers(roomId: RoomId): UserId[]`**
- `const room = this.rooms.get(roomId)`
- Return `room ? [...room.slots.keys()] : []`

**`destroy(): void`**
- For each room: cleanup all slots, destroy room services
- Clear rooms map

### Private Methods

**`private getOrCreateRoom(roomId: RoomId): Room | null`**
1. If exists, return it
2. If `this.rooms.size >= MAX_ROOMS`, return null
3. Create LLM provider: `const llmProvider = createLLMProvider(this.config.llm.provider, this.config.llm.apiKey)`
4. Create room:
   ```ts
   const room: Room = {
     id: roomId,
     slots: new Map(),
     audioRelay: new AudioRelayService(),
     triggerDetector: new TriggerDetector({
       keyword: this.config.trigger.keyword,
       smartDetectionEnabled: this.config.trigger.smartDetectionEnabled,
       llmProvider,
       llmModel: this.config.llm.model,
     }),
     negotiation: null,     // created when paired
     document: null,        // created when paired
     payment: new PaymentService({
       secretKey: this.config.stripe.secretKey,
       platformAccountId: this.config.stripe.platformAccountId,
     }),
     paired: false,
   };
   ```
5. Wire trigger detector: `room.triggerDetector.on("triggered", (event) => this.handleTrigger(room, event))`
6. Store and return

**`private createUserSlot(room: Room, userId: UserId): UserSlot`**
1. `const profile = this.profileManager.getProfile(userId) ?? this.profileManager.getDefaultProfile(userId)`
2. Create services:
   ```ts
   const audio = new AudioService();
   audio.setSampleRate(16000);

   const transcription = new TranscriptionService({
     apiKey: this.config.elevenlabs.apiKey,
     region: this.config.elevenlabs.region,
     language: this.config.elevenlabs.language,
   });

   const session = new SessionService();
   session.setStatus("discovering");

   const llmProvider = createLLMProvider(this.config.llm.provider, this.config.llm.apiKey);
   const agent = new AgentService({
     provider: llmProvider,
     model: this.config.llm.model,
     maxTokens: 4096,
   });
   ```
3. Wire audio → transcription: `audio.on("chunk", (chunk) => transcription.feedAudio(chunk))`
4. Wire transcription events:
   ```ts
   transcription.on("final", (transcript: FinalTranscript) => {
     const entry = {
       id: `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
       speaker: userId,
       text: transcript.text,
       timestamp: Date.now(),
       startTime: transcript.startTime,
       endTime: transcript.endTime,
       isFinal: true,
       source: "local" as const,
       words: transcript.words,
     };

     session.addTranscript(entry);
     agent.pushTranscript(entry);
     room.triggerDetector.feedTranscript(entry);

     // Broadcast to all in room
     this.panelEmitter.broadcast(room.id, { panel: "transcript", entry });

     // Send to other user's agent too
     for (const [otherId, otherSlot] of room.slots) {
       if (otherId !== userId) {
         otherSlot.session.addTranscript({ ...entry, source: "peer" });
         otherSlot.agent.pushTranscript({ ...entry, source: "peer" });
       }
     }
   });

   transcription.on("partial", (partial: PartialTranscript) => {
     this.panelEmitter.broadcast(room.id, {
       panel: "transcript",
       entry: {
         id: `partial-${userId}`,
         speaker: userId,
         text: partial.text,
         timestamp: Date.now(),
         isFinal: false,
         source: "local" as const,
       },
     });
   });
   ```
5. Start transcription: `transcription.start().catch(err => console.error("[room] Transcription start failed:", err))`
6. Setup Monzo if token available:
   ```ts
   let monzo: MonzoService | null = null;
   if (profile.monzoAccessToken) {
     monzo = new MonzoService();
     monzo.setAccessToken(profile.monzoAccessToken);
   }
   ```
7. Return slot object

**`private pairUsers(room: Room): void`**
1. `room.paired = true`
2. Get both user IDs: `const [userIdA, userIdB] = [...room.slots.keys()]`
3. Get both slots
4. Create peer pair: `const [peerA, peerB] = InProcessPeer.createPair(userIdA, userIdB)`
5. Store peers in slots: `slotA.peer = peerA; slotB.peer = peerB`
6. Set sessions to active:
   ```ts
   slotA.session.setStatus("active");
   slotB.session.setStatus("active");
   ```
7. Create shared negotiation: `room.negotiation = new NegotiationService(room.id)`
8. Create shared document service:
   ```ts
   const llmProvider = createLLMProvider(this.config.llm.provider, this.config.llm.apiKey);
   room.document = new DocumentService({ llmProvider, llmModel: this.config.llm.model });
   ```
9. Wire negotiation events:
   ```ts
   room.negotiation.on("negotiation:started", (neg) => {
     this.panelEmitter.broadcast(room.id, { panel: "negotiation", negotiation: neg });
   });
   room.negotiation.on("negotiation:updated", (neg) => {
     this.panelEmitter.broadcast(room.id, { panel: "negotiation", negotiation: neg });
   });
   room.negotiation.on("negotiation:agreed", (neg) => {
     this.panelEmitter.broadcast(room.id, { panel: "negotiation", negotiation: neg });
     this.handleAgreement(room, neg);
   });
   room.negotiation.on("negotiation:rejected", (neg) => {
     this.panelEmitter.broadcast(room.id, { panel: "negotiation", negotiation: neg });
     // Reset sessions to active, allow re-trigger
     slotA.session.setStatus("active");
     slotB.session.setStatus("active");
     room.triggerDetector.reset();
   });
   room.negotiation.on("negotiation:expired", (neg) => {
     this.panelEmitter.broadcast(room.id, { panel: "negotiation", negotiation: neg });
     slotA.session.setStatus("active");
     slotB.session.setStatus("active");
     room.triggerDetector.reset();
   });
   ```
10. Wire peer message routing:
    ```ts
    peerA.on("message", (msg: AgentMessage) => {
      room.negotiation?.handleAgentMessage(msg);
      slotB.agent.receiveAgentMessage(msg);
    });
    peerB.on("message", (msg: AgentMessage) => {
      room.negotiation?.handleAgentMessage(msg);
      slotA.agent.receiveAgentMessage(msg);
    });
    ```
11. Build tools for each user and start agents:
    ```ts
    for (const [uid, slot] of room.slots) {
      const otherUid = uid === userIdA ? userIdB : userIdA;
      const otherProfile = this.profileManager.getProfile(otherUid);
      const profile = this.profileManager.getProfile(uid) ?? this.profileManager.getDefaultProfile(uid);

      const toolDeps: ToolDependencies = {
        payment: room.payment,
        monzo: slot.monzo,
        negotiation: room.negotiation!,
        panelEmitter: this.panelEmitter,
        userId: uid,
        displayName: profile.displayName,
        recipientAccountId: otherProfile?.stripeAccountId ?? "",
        roomId: room.id,
        otherUserId: otherUid,
      };

      const tools = buildTools(toolDeps);
      slot.agent.setTools(tools);
      slot.agent.start(profile).catch(err => console.error(`[room] Agent start failed for ${uid}:`, err));
    }
    ```
12. Wire agent messages to panels:
    ```ts
    for (const [uid, slot] of room.slots) {
      slot.agent.on("agent:message", (msg) => {
        this.panelEmitter.sendToUser(uid, {
          panel: "agent",
          userId: uid,
          text: msg.text,
          timestamp: msg.timestamp,
        });
      });
      slot.agent.on("agent:tool_call", (call) => {
        this.panelEmitter.sendToUser(uid, {
          panel: "agent",
          userId: uid,
          text: `[Tool: ${call.name}] ${call.result}`,
          timestamp: Date.now(),
        });
      });
    }
    ```
13. Broadcast paired status:
    ```ts
    this.panelEmitter.broadcast(room.id, {
      panel: "status",
      roomId: room.id,
      users: [...room.slots.keys()],
      sessionStatus: "active",
    });
    ```

**`private handleTrigger(room: Room, event: TriggerEvent): void`**
1. Log: `[room] Trigger detected: ${event.type} by ${event.speakerId}`
2. Set sessions to negotiating:
   ```ts
   for (const slot of room.slots.values()) {
     slot.session.setStatus("negotiating");
   }
   ```
3. Determine initiator: `event.speakerId`
4. Get conversation context from initiator's session: `slot.session.getTranscriptText()`
5. Start negotiation on initiator's agent:
   ```ts
   const initiatorSlot = room.slots.get(event.speakerId);
   initiatorSlot?.agent.startNegotiation(event, conversationContext);
   ```

**`private async handleAgreement(room: Room, negotiation: Negotiation): Promise<void>`**
1. Set sessions to signing:
   ```ts
   for (const slot of room.slots.values()) {
     slot.session.setStatus("signing");
   }
   ```
2. Build parties array from profiles
3. Get conversation context
4. Generate document:
   ```ts
   const doc = await room.document?.generateDocument(
     negotiation,
     negotiation.currentProposal,
     parties,
     conversationContext,
   );
   ```
5. Broadcast document to all users:
   ```ts
   if (doc) {
     this.panelEmitter.broadcast(room.id, { panel: "document", document: doc });
   }
   ```
6. Wire document completion:
   ```ts
   room.document?.on("document:signed", ({ documentId, userId }) => {
     this.panelEmitter.broadcast(room.id, {
       panel: "execution",
       negotiationId: negotiation.id,
       step: "signature",
       status: `${userId} signed`,
     });
   });
   room.document?.on("document:completed", async (completedDoc) => {
     await this.executePayments(room, negotiation);
   });
   ```

**Document signing (from `handleClientMessage`):**
```ts
case "sign_document": {
  // Find user's room
  for (const room of this.rooms.values()) {
    if (room.slots.has(userId) && room.document) {
      room.document.signDocument(message.documentId, userId);
      break;
    }
  }
  break;
}
```

**`private async executePayments(room: Room, negotiation: Negotiation): Promise<void>`**
1. For each line item in `negotiation.currentProposal.lineItems`:
   - Determine payer (initiator) and recipient (responder) account IDs
   - If type is "immediate":
     ```ts
     const result = await room.payment.executePayment({
       amount: li.amount,
       currency: negotiation.currentProposal.currency,
       description: li.description,
       recipientAccountId: recipientStripeId,
     });
     this.panelEmitter.broadcast(room.id, {
       panel: "execution",
       negotiationId: negotiation.id,
       step: `payment_${li.description}`,
       status: result.success ? "done" : "failed",
       details: result.success ? `Payment: £${(li.amount / 100).toFixed(2)}` : result.error,
     });
     ```
   - If type is "escrow":
     ```ts
     const hold = await room.payment.createEscrowHold({ ... });
     // broadcast escrow creation
     ```
2. Set sessions to completed:
   ```ts
   for (const slot of room.slots.values()) {
     slot.session.setStatus("completed");
   }
   ```
3. Broadcast completion

**`private cleanupSlot(room: Room, userId: UserId): void`**
1. `const slot = room.slots.get(userId)`; if `!slot`, return
2. `slot.agent.stop()`
3. `slot.transcription.stop().catch(() => {})`
4. `slot.audio.destroy()`
5. `slot.session.reset()`
6. `this.panelEmitter.unregisterSocket(userId)`
7. `room.audioRelay.unregisterUser(userId)`
8. `room.slots.delete(userId)`
9. `room.paired = false`

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `IRoomManager` interface
- Room creation with MAX_ROOMS limit
- User pairing wires full pipeline
- Trigger detection routes to initiator's agent
- Agreement triggers document generation
- Document completion triggers payment execution
- Clean destruction of all services
