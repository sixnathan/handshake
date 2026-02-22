import type WebSocket from "ws";
import type {
  AppConfig,
  UserId,
  RoomId,
  AgentProfile,
  AgentMessage,
  ClientMessage,
  TriggerEvent,
  Negotiation,
  DocumentId,
  MilestoneId,
} from "../types.js";
import type {
  FinalTranscript,
  PartialTranscript,
  IRoomManager,
} from "../interfaces.js";
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

interface UserSlot {
  userId: UserId;
  audio: AudioService;
  transcription: TranscriptionService;
  session: SessionService;
  agent: AgentService;
  triggerDetector: TriggerDetector;
  peer: InProcessPeer | null;
  monzo: MonzoService | null;
}

interface Room {
  id: RoomId;
  slots: Map<UserId, UserSlot>;
  audioRelay: AudioRelayService;
  negotiation: NegotiationService | null;
  document: DocumentService | null;
  payment: PaymentService;
  paired: boolean;
  triggerInProgress: boolean;
  paymentsExecuted: boolean;
  documentIds?: string[];
  pendingTrigger: { userId: UserId; timestamp: number } | null;
  pendingTriggerTimeout: ReturnType<typeof setTimeout> | null;
}

const MAX_USERS_PER_ROOM = 2;
const MAX_ROOMS = 50;

export class RoomManager implements IRoomManager {
  private rooms = new Map<RoomId, Room>();

  constructor(
    private readonly config: AppConfig,
    private readonly panelEmitter: PanelEmitter,
    private readonly profileManager: ProfileManager,
  ) {}

  joinRoom(roomId: RoomId, userId: UserId, profile: AgentProfile): void {
    console.log(`[room] User ${userId} joining room ${roomId}`);
    this.profileManager.setProfile(userId, profile);
    const room = this.getOrCreateRoom(roomId);
    if (!room) throw new Error("Maximum rooms reached");
    if (room.slots.size >= MAX_USERS_PER_ROOM) throw new Error("Room is full");
    if (room.slots.has(userId)) return;

    const slot = this.createUserSlot(room, userId);
    room.slots.set(userId, slot);

    this.panelEmitter.broadcast(roomId, {
      panel: "status",
      roomId,
      users: [...room.slots.keys()],
      sessionStatus: "discovering",
    });

    if (room.slots.size === 2 && !room.paired) {
      this.pairUsers(room);
    }
  }

  leaveRoom(roomId: RoomId, userId: UserId): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    this.cleanupSlot(room, userId);

    if (room.slots.size === 0) {
      room.audioRelay.destroy();
      room.negotiation?.destroy();
      this.rooms.delete(roomId);
    }
  }

  registerAudioSocket(roomId: RoomId, userId: UserId, ws: WebSocket): void {
    console.log(
      `[room] Audio socket registered for ${userId} in room ${roomId}`,
    );

    // Try to wire immediately if both room and slot exist
    const room = this.rooms.get(roomId);
    if (room) {
      const slot = room.slots.get(userId);
      if (slot) {
        this.wireAudioSocket(room, slot, userId, ws);
        return;
      }
    }

    // Room or slot doesn't exist yet — join_room message is likely in-flight.
    // Poll briefly for both to appear instead of rejecting immediately.
    console.log(
      `[room] Waiting for room/slot for ${userId} (room=${!!room}, slot=${!!room?.slots.get(userId)})`,
    );
    this.waitForRoomAndSlot(roomId, userId, ws);
  }

  private waitForRoomAndSlot(
    roomId: RoomId,
    userId: UserId,
    ws: WebSocket,
  ): void {
    const POLL_INTERVAL_MS = 200;
    const MAX_ATTEMPTS = 25; // 5s total
    let attempts = 0;

    const timer = setInterval(() => {
      attempts++;

      // WebSocket closed while waiting — stop polling
      if (ws.readyState !== ws.OPEN) {
        clearInterval(timer);
        console.log(`[room] Audio socket closed while waiting for ${userId}`);
        return;
      }

      const room = this.rooms.get(roomId);
      const slot = room?.slots.get(userId);
      if (room && slot) {
        clearInterval(timer);
        console.log(
          `[room] Room+slot appeared for ${userId} after ${attempts * POLL_INTERVAL_MS}ms`,
        );
        this.wireAudioSocket(room, slot, userId, ws);
        return;
      }

      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(timer);
        const reason = !room ? "Room not found" : "User not in room";
        console.log(
          `[room] Wait timed out for ${userId} after ${MAX_ATTEMPTS * POLL_INTERVAL_MS}ms: ${reason}`,
        );
        ws.close(!room ? 4003 : 4004, reason);
      }
    }, POLL_INTERVAL_MS);
  }

  private wireAudioSocket(
    room: Room,
    slot: UserSlot,
    userId: UserId,
    ws: WebSocket,
  ): void {
    room.audioRelay.registerUser(userId, ws);

    // Start transcription when audio socket connects (lazy — avoids wasting API time before audio flows)
    console.log(`[room] Transcription started for ${userId}`);
    slot.transcription.start().catch((err) => {
      console.error(`[room] Transcription start failed for ${userId}:`, err);
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: `Transcription failed: ${(err as Error).message}`,
      });
    });

    let audioFlowing = false;
    ws.on("message", (data) => {
      if (typeof data === "string") {
        try {
          const msg = JSON.parse(data) as { type: string };
          if (msg.type === "mute") {
            console.log(
              `[room] Mute signal from ${userId}, flushing transcription`,
            );
            slot.transcription.flush();
          } else if (msg.type === "unmute") {
            console.log(
              `[room] Unmute signal from ${userId}, resuming transcription`,
            );
            slot.transcription.resumeFromMute();
          }
        } catch {
          /* ignore malformed JSON */
        }
        return;
      }
      if (!audioFlowing) {
        console.log(`[room] Audio flowing for ${userId}`);
        audioFlowing = true;
      }
      const buffer = Buffer.from(data as ArrayBuffer);
      slot.audio.feedRawAudio(buffer);
      room.audioRelay.relayAudio(userId, buffer);
    });

    ws.on("close", () => {
      room.audioRelay.unregisterUser(userId);
      slot.transcription.stop().catch(() => {});
    });
  }

  registerPanelSocket(roomId: RoomId, userId: UserId, ws: WebSocket): void {
    console.log(`[room] Panel socket registered for ${userId}`);
    this.panelEmitter.registerSocket(userId, ws);
    this.panelEmitter.setRoom(userId, roomId);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
        this.handleClientMessage(userId, msg);
      } catch {
        /* ignore malformed JSON */
      }
    });

    ws.on("close", () => {
      this.panelEmitter.unregisterSocket(userId);
    });

    const room = this.rooms.get(roomId);
    if (room) {
      this.panelEmitter.sendToUser(userId, {
        panel: "status",
        roomId,
        users: [...room.slots.keys()],
        sessionStatus: room.paired ? "active" : "discovering",
      });
    }
  }

  handleClientMessage(userId: UserId, message: ClientMessage): void {
    switch (message.type) {
      case "set_profile":
        this.profileManager.setProfile(userId, message.profile);
        break;

      case "sign_document": {
        for (const room of this.rooms.values()) {
          if (room.slots.has(userId) && room.document) {
            room.document.signDocument(message.documentId, userId);
            break;
          }
        }
        break;
      }

      case "confirm_milestone": {
        this.handleConfirmMilestone(
          userId,
          message.documentId,
          message.milestoneId,
        );
        break;
      }

      case "propose_milestone_amount": {
        this.handleProposeMilestoneAmount(
          userId,
          message.documentId,
          message.milestoneId,
          message.amount,
        );
        break;
      }

      case "approve_milestone_amount": {
        this.handleApproveMilestoneAmount(
          userId,
          message.documentId,
          message.milestoneId,
        );
        break;
      }

      case "release_escrow": {
        this.handleReleaseEscrow(
          userId,
          message.documentId,
          message.milestoneId,
        );
        break;
      }

      case "set_trigger_keyword": {
        for (const room of this.rooms.values()) {
          const slot = room.slots.get(userId);
          if (slot) {
            slot.triggerDetector.setKeyword(message.keyword);
            break;
          }
        }
        break;
      }

      case "join_room": {
        const profile =
          this.profileManager.getProfile(userId) ??
          this.profileManager.getDefaultProfile(userId);
        this.joinRoom(message.roomId, userId, profile);
        break;
      }
    }
  }

  getRoomUsers(roomId: RoomId): UserId[] {
    const room = this.rooms.get(roomId);
    return room ? [...room.slots.keys()] : [];
  }

  destroy(): void {
    for (const room of this.rooms.values()) {
      for (const userId of [...room.slots.keys()]) {
        this.cleanupSlot(room, userId);
      }
      room.audioRelay.destroy();
      room.negotiation?.destroy();
    }
    this.rooms.clear();
  }

  // ── Private Methods ──────────────────────────

  private getOrCreateRoom(roomId: RoomId): Room | null {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    if (this.rooms.size >= MAX_ROOMS) return null;

    const room: Room = {
      id: roomId,
      slots: new Map(),
      audioRelay: new AudioRelayService(),
      negotiation: null,
      document: null,
      payment: new PaymentService({
        secretKey: this.config.stripe.secretKey,
        platformAccountId: this.config.stripe.platformAccountId,
      }),
      paired: false,
      triggerInProgress: false,
      paymentsExecuted: false,
      pendingTrigger: null,
      pendingTriggerTimeout: null,
    };

    this.rooms.set(roomId, room);
    return room;
  }

  private createUserSlot(room: Room, userId: UserId): UserSlot {
    const profile =
      this.profileManager.getProfile(userId) ??
      this.profileManager.getDefaultProfile(userId);

    const audio = new AudioService();
    audio.setSampleRate(16000);

    const transcription = new TranscriptionService(
      {
        apiKey: this.config.elevenlabs.apiKey,
        region: this.config.elevenlabs.region,
        language: this.config.elevenlabs.language,
      },
      userId,
    );

    const session = new SessionService();
    session.setStatus("discovering");

    const llmProvider = createLLMProvider(
      this.config.llm.provider,
      this.config.llm.apiKey,
    );
    const agent = new AgentService({
      provider: llmProvider,
      model: this.config.llm.model,
      maxTokens: 4096,
    });

    // Per-user TriggerDetector (with LLM smart detection fallback)
    const triggerDetector = new TriggerDetector({
      keyword: this.config.trigger.keyword,
      userId,
      llmProvider: llmProvider,
      llmModel: this.config.llm.model,
    });

    // Wire per-user trigger events
    triggerDetector.on("triggered", (event: TriggerEvent) =>
      this.handleUserTrigger(room, userId, event),
    );

    // Wire audio → transcription
    audio.on("chunk", (chunk) => transcription.feedAudio(chunk));

    // Wire transcription events
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
      triggerDetector.feedTranscript(entry);

      this.panelEmitter.broadcast(room.id, { panel: "transcript", entry });

      // Feed transcript to peer's services too
      for (const [otherId, otherSlot] of room.slots) {
        if (otherId !== userId) {
          const peerEntry = { ...entry, source: "peer" as const };
          otherSlot.session.addTranscript(peerEntry);
          otherSlot.agent.pushTranscript(peerEntry);
          otherSlot.triggerDetector.feedTranscript(peerEntry);
        }
      }
    });

    transcription.on("partial", (partial: PartialTranscript) => {
      const partialEntry = {
        id: `partial-${userId}`,
        speaker: userId,
        text: partial.text,
        timestamp: Date.now(),
        isFinal: false,
        source: "local" as const,
      };

      this.panelEmitter.broadcast(room.id, {
        panel: "transcript",
        entry: partialEntry,
      });

      // Feed partials to trigger detector — ElevenLabs finals are slow
      triggerDetector.feedTranscript(partialEntry);
    });

    let monzo: MonzoService | null = null;
    if (profile.monzoAccessToken) {
      monzo = new MonzoService();
      monzo.setAccessToken(profile.monzoAccessToken);
    }

    return {
      userId,
      audio,
      transcription,
      session,
      agent,
      triggerDetector,
      peer: null,
      monzo,
    };
  }

  private pairUsers(room: Room): void {
    console.log(`[room] Users paired in room ${room.id}`);
    room.paired = true;
    const [userIdA, userIdB] = [...room.slots.keys()];
    const slotA = room.slots.get(userIdA)!;
    const slotB = room.slots.get(userIdB)!;

    const [peerA, peerB] = InProcessPeer.createPair(userIdA, userIdB);
    slotA.peer = peerA;
    slotB.peer = peerB;

    slotA.session.setStatus("active");
    slotB.session.setStatus("active");

    room.negotiation = new NegotiationService(room.id);

    const llmProvider = createLLMProvider(
      this.config.llm.provider,
      this.config.llm.apiKey,
    );
    room.document = new DocumentService({
      llmProvider,
      llmModel: this.config.llm.model,
    });

    // Wire negotiation events
    room.negotiation.on("negotiation:started", (neg: Negotiation) => {
      this.panelEmitter.broadcast(room.id, {
        panel: "negotiation",
        negotiation: neg,
      });
    });
    room.negotiation.on("negotiation:updated", (neg: Negotiation) => {
      this.panelEmitter.broadcast(room.id, {
        panel: "negotiation",
        negotiation: neg,
      });
    });
    room.negotiation.on("negotiation:agreed", (neg: Negotiation) => {
      this.panelEmitter.broadcast(room.id, {
        panel: "negotiation",
        negotiation: neg,
      });
      this.handleAgreement(room, neg);
    });
    room.negotiation.on("negotiation:rejected", (neg: Negotiation) => {
      this.panelEmitter.broadcast(room.id, {
        panel: "negotiation",
        negotiation: neg,
      });
      room.triggerInProgress = false;
      room.pendingTrigger = null;
      if (room.pendingTriggerTimeout) {
        clearTimeout(room.pendingTriggerTimeout);
        room.pendingTriggerTimeout = null;
      }
      slotA.session.setStatus("active");
      slotB.session.setStatus("active");
      slotA.triggerDetector.reset();
      slotB.triggerDetector.reset();
    });
    room.negotiation.on("negotiation:expired", (neg: Negotiation) => {
      this.panelEmitter.broadcast(room.id, {
        panel: "negotiation",
        negotiation: neg,
      });
      room.triggerInProgress = false;
      room.pendingTrigger = null;
      if (room.pendingTriggerTimeout) {
        clearTimeout(room.pendingTriggerTimeout);
        room.pendingTriggerTimeout = null;
      }
      slotA.session.setStatus("active");
      slotB.session.setStatus("active");
      slotA.triggerDetector.reset();
      slotB.triggerDetector.reset();
    });

    // Wire peer message routing
    // peerA emits "message" when peerB sends (nat1 sends) → deliver to nat2 (slotA)
    // peerB emits "message" when peerA sends (nat2 sends) → deliver to nat1 (slotB)
    // NOTE: Don't call handleAgentMessage here — the tool handlers already call it
    // before peer.send(). Calling it again would double-process every negotiation message.
    peerA.on("message", (msg: AgentMessage) => {
      slotA.agent.receiveAgentMessage(msg);
    });
    peerB.on("message", (msg: AgentMessage) => {
      slotB.agent.receiveAgentMessage(msg);
    });

    // Build tools for each user and start agents
    for (const [uid, slot] of room.slots) {
      const otherUid = uid === userIdA ? userIdB : userIdA;
      const otherProfile = this.profileManager.getProfile(otherUid);
      const userProfile =
        this.profileManager.getProfile(uid) ??
        this.profileManager.getDefaultProfile(uid);

      const toolDeps: ToolDependencies = {
        payment: room.payment,
        monzo: slot.monzo,
        negotiation: room.negotiation!,
        document: room.document!,
        session: slot.session,
        panelEmitter: this.panelEmitter,
        peer: slot.peer!,
        userId: uid,
        otherUserId: otherUid,
        displayName: userProfile.displayName,
        otherDisplayName: otherProfile?.displayName ?? otherUid,
        recipientAccountId: otherProfile?.stripeAccountId ?? "",
        payerCustomerId: this.config.stripe.customerIdForDemo,
        roomId: room.id,
      };

      const tools = buildTools(toolDeps);
      slot.agent.setTools(tools);
      slot.agent
        .start(userProfile)
        .catch((err) =>
          console.error(`[room] Agent start failed for ${uid}:`, err),
        );
    }

    // Wire agent messages to panels
    for (const [uid, slot] of room.slots) {
      slot.agent.on(
        "agent:message",
        (msg: { text: string; timestamp: number }) => {
          this.panelEmitter.sendToUser(uid, {
            panel: "agent",
            userId: uid,
            text: msg.text,
            timestamp: msg.timestamp,
          });
        },
      );
      slot.agent.on(
        "agent:tool_call",
        (call: { name: string; result: string }) => {
          this.panelEmitter.sendToUser(uid, {
            panel: "agent",
            userId: uid,
            text: `[Tool: ${call.name}] ${call.result}`,
            timestamp: Date.now(),
          });
        },
      );
    }

    // Broadcast paired status
    this.panelEmitter.broadcast(room.id, {
      panel: "status",
      roomId: room.id,
      users: [...room.slots.keys()],
      sessionStatus: "active",
    });
  }

  // 20s window to accommodate smart detection interval (10s polling per user)
  private readonly DUAL_KEYWORD_TIMEOUT_MS = 20_000;

  private handleUserTrigger(
    room: Room,
    userId: UserId,
    event: TriggerEvent,
  ): void {
    console.log(
      `[room] handleUserTrigger: user=${userId}, speaker=${event.speakerId}, type=${event.type}, room=${room.id}`,
    );
    // Guard: if negotiation already active or trigger in progress, ignore
    if (room.negotiation?.getActiveNegotiation() || room.triggerInProgress) {
      console.log(
        `[room] Trigger ignored — negotiation already active or trigger in progress`,
      );
      return;
    }

    // Single-keyword trigger: first person to say "handshake" activates both agents
    room.triggerInProgress = true;

    console.log(
      `[room] Trigger confirmed in room ${room.id} — speaker ${event.speakerId} said "${this.config.trigger.keyword}"`,
    );

    this.handleTrigger(room, {
      ...event,
      type: "dual_keyword",
    });
  }

  private handleTrigger(room: Room, event: TriggerEvent): void {
    console.log(
      `[room] handleTrigger ENTERED: ${event.type} in room ${room.id}, slots=${room.slots.size}, paired=${room.paired}`,
    );

    for (const slot of room.slots.values()) {
      slot.session.setStatus("negotiating");
    }

    // Determine initiator by profile role: the user with a "provider"-like role proposes
    const providerKeywords = [
      "provider",
      "plumber",
      "contractor",
      "electrician",
      "builder",
      "mechanic",
      "tradesperson",
      "freelancer",
      "consultant",
      "developer",
      "designer",
      "painter",
      "cleaner",
      "gardener",
      "roofer",
      "locksmith",
    ];

    let initiatorId: UserId | null = null;
    for (const [uid] of room.slots) {
      const profile = this.profileManager.getProfile(uid);
      if (profile) {
        const roleLower = profile.role.toLowerCase();
        if (providerKeywords.some((kw) => roleLower.includes(kw))) {
          initiatorId = uid;
          break;
        }
      }
    }

    // Fallback: first speaker (the user who triggered first) is initiator
    if (!initiatorId) {
      initiatorId = event.speakerId;
    }

    const initiatorSlot = room.slots.get(initiatorId);
    if (!initiatorSlot) {
      console.error(`[room] No slot found for initiator ${initiatorId}!`);
      return;
    }

    // Gather conversation from ALL trigger detectors (they have both partials + finals)
    // Session only has finals which may not exist yet if trigger came from a partial
    const allTranscripts: Map<string, string> = new Map();
    for (const slot of room.slots.values()) {
      for (const t of slot.triggerDetector.getRecentTranscripts()) {
        // Use latest text per speaker (partials are cumulative, last is most complete)
        allTranscripts.set(t.speaker, t.text);
      }
    }
    let conversationContext = [...allTranscripts.entries()]
      .map(([speaker, text]) => `${speaker}: ${text}`)
      .join("\n");

    // Fallback to session transcripts if trigger detectors are empty
    if (!conversationContext.trim()) {
      conversationContext = initiatorSlot.session.getTranscriptText();
    }
    console.log(
      `[room] Calling startNegotiation on agent for ${initiatorId}, context length=${conversationContext.length}`,
    );
    initiatorSlot.agent
      .startNegotiation(event, conversationContext)
      .then(() =>
        console.log(`[room] startNegotiation resolved for ${initiatorId}`),
      )
      .catch((err) => console.error("[room] Start negotiation failed:", err));
  }

  private async handleAgreement(
    room: Room,
    negotiation: Negotiation,
  ): Promise<void> {
    for (const slot of room.slots.values()) {
      slot.session.setStatus("signing");
    }

    // Track document IDs for milestone linking
    room.documentIds = room.documentIds ?? [];
    room.document?.once(
      "document:generated",
      (doc: import("../types.js").LegalDocument) => {
        if (!room.documentIds!.includes(doc.id)) {
          room.documentIds!.push(doc.id);
        }
      },
    );

    // Wire document events — use .on() so ALL signatures broadcast, not just the first
    room.document?.on(
      "document:signed",
      ({ documentId, userId }: { documentId: string; userId: string }) => {
        this.panelEmitter.broadcast(room.id, {
          panel: "execution",
          negotiationId: negotiation.id,
          step: "signature",
          status: `${userId} signed`,
        });

        // Re-broadcast the updated document so both clients see the new signature count
        const updatedDoc = room.document?.getDocument(documentId);
        if (updatedDoc) {
          this.panelEmitter.broadcast(room.id, {
            panel: "document",
            document: updatedDoc,
          });
        }
      },
    );

    room.document?.once("document:completed", async () => {
      await this.executePayments(room, negotiation);
    });

    // Inject instruction into initiator's agent to generate document via tool
    const initiatorSlot = room.slots.get(negotiation.initiator);
    if (initiatorSlot) {
      const instruction = `[AGREEMENT REACHED — GENERATE DOCUMENT]
The negotiation ${negotiation.id} has been accepted by both parties.
Use the generate_document tool now to create a binding legal document.
Negotiation ID: ${negotiation.id}

Inform your user that the agreement has been reached and you are generating the document.`;

      initiatorSlot.agent
        .injectInstruction(instruction)
        .catch((err) =>
          console.error("[room] Agent document generation failed:", err),
        );
    }
  }

  private async executePayments(
    room: Room,
    negotiation: Negotiation,
  ): Promise<void> {
    // Idempotency guard: prevent duplicate payment execution
    if (room.paymentsExecuted) {
      console.log(
        `[room] Payments already executed for room ${room.id}, skipping`,
      );
      return;
    }
    room.paymentsExecuted = true;

    const responderProfile = this.profileManager.getProfile(
      negotiation.responder,
    );
    const recipientStripeId = responderProfile?.stripeAccountId ?? "";

    if (!recipientStripeId) {
      this.panelEmitter.broadcast(room.id, {
        panel: "execution",
        negotiationId: negotiation.id,
        step: "payment_setup",
        status: "failed",
        details: "Recipient has no Stripe account connected",
      });
      return;
    }

    // Find the document to link escrow holds to milestones
    let documentMilestones: import("../types.js").Milestone[] = [];
    let documentId: string | undefined;
    if (room.document) {
      // Find the document for this negotiation
      for (const [docId, doc] of this.getDocuments(room)) {
        if (doc.negotiationId === negotiation.id) {
          documentMilestones = doc.milestones ?? [];
          documentId = docId;
          break;
        }
      }
    }

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < negotiation.currentProposal.lineItems.length; i++) {
      const li = negotiation.currentProposal.lineItems[i];
      if (li.type === "immediate") {
        // Emit processing receipt
        this.panelEmitter.broadcast(room.id, {
          panel: "payment_receipt",
          amount: li.amount,
          currency: negotiation.currentProposal.currency,
          recipient: responderProfile?.displayName ?? negotiation.responder,
          status: "processing",
          paymentIntentId: "",
          description: li.description,
        });

        try {
          const result = await room.payment.executePayment({
            amount: li.amount,
            currency: negotiation.currentProposal.currency,
            description: li.description,
            recipientAccountId: recipientStripeId,
            payerCustomerId: this.config.stripe.customerIdForDemo,
          });
          if (result.success) {
            succeeded++;
          } else {
            failed++;
          }

          // Emit final receipt
          this.panelEmitter.broadcast(room.id, {
            panel: "payment_receipt",
            amount: li.amount,
            currency: negotiation.currentProposal.currency,
            recipient: responderProfile?.displayName ?? negotiation.responder,
            status: result.success ? "succeeded" : "failed",
            paymentIntentId: result.paymentIntentId ?? "",
            description: li.description,
          });

          this.panelEmitter.broadcast(room.id, {
            panel: "execution",
            negotiationId: negotiation.id,
            step: `payment_${li.description}`,
            status: result.success ? "done" : "failed",
            details: result.success
              ? `Payment: £${(li.amount / 100).toFixed(2)}`
              : result.error,
          });
        } catch (err) {
          failed++;
          this.panelEmitter.broadcast(room.id, {
            panel: "payment_receipt",
            amount: li.amount,
            currency: negotiation.currentProposal.currency,
            recipient: responderProfile?.displayName ?? negotiation.responder,
            status: "failed",
            paymentIntentId: "",
            description: li.description,
          });
          this.panelEmitter.broadcast(room.id, {
            panel: "execution",
            negotiationId: negotiation.id,
            step: `payment_${li.description}`,
            status: "failed",
            details: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (li.type === "escrow") {
        try {
          const hold = await room.payment.createEscrowHold({
            amount: li.maxAmount ?? li.amount,
            currency: negotiation.currentProposal.currency,
            description: li.description,
            recipientAccountId: recipientStripeId,
            payerCustomerId: this.config.stripe.customerIdForDemo,
          });
          succeeded++;

          // Link escrow holdId to corresponding milestone
          const milestone = documentMilestones.find(
            (m) => m.lineItemIndex === i,
          );
          if (milestone && documentId && room.document) {
            const updatedMilestones = documentMilestones.map((m) =>
              m.lineItemIndex === i ? { ...m, escrowHoldId: hold.holdId } : m,
            );
            room.document.updateMilestones(documentId, updatedMilestones);
            documentMilestones = updatedMilestones;
          }

          this.panelEmitter.broadcast(room.id, {
            panel: "execution",
            negotiationId: negotiation.id,
            step: `escrow_${li.description}`,
            status: "done",
            details: `Escrow: £${(hold.amount / 100).toFixed(2)} held (${hold.holdId})`,
          });
        } catch (err) {
          failed++;
          this.panelEmitter.broadcast(room.id, {
            panel: "execution",
            negotiationId: negotiation.id,
            step: `escrow_${li.description}`,
            status: "failed",
            details: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (failed > 0) {
      this.panelEmitter.broadcast(room.id, {
        panel: "execution",
        negotiationId: negotiation.id,
        step: "payment_summary",
        status: "partial_failure",
        details: `${succeeded} succeeded, ${failed} failed out of ${negotiation.currentProposal.lineItems.length} items`,
      });
    }

    // Re-broadcast the completed document (with milestones + escrow holdIds) for client-side persistence
    if (documentId && room.document) {
      const completedDoc = room.document.getDocument(documentId);
      if (completedDoc) {
        this.panelEmitter.broadcast(room.id, {
          panel: "document",
          document: completedDoc,
        });
      }
    }

    // Only set to "completed" if no pending milestones remain
    const hasPendingMilestones = documentMilestones.some(
      (m) => m.status === "pending",
    );

    if (!hasPendingMilestones) {
      for (const slot of room.slots.values()) {
        slot.session.setStatus("completed");
      }

      this.panelEmitter.broadcast(room.id, {
        panel: "status",
        roomId: room.id,
        users: [...room.slots.keys()],
        sessionStatus: "completed",
      });
    }
  }

  private getDocuments(
    room: Room,
  ): Array<[string, import("../types.js").LegalDocument]> {
    // Access the document service's stored documents via getDocument
    // We check documents by iterating known negotiation IDs
    const results: Array<[string, import("../types.js").LegalDocument]> = [];
    if (!room.document || !room.negotiation) return results;
    const neg = room.negotiation.getActiveNegotiation();
    if (!neg) return results;
    // The document ID pattern is "doc_<base36timestamp>_<random>"
    // We can't enumerate, but documents are accessible if we track them
    // Instead, scan by checking all documents emitted via events
    // For now, iterate by checking the negotiation's document
    // DocumentService stores by ID — we need to find it by negotiation ID
    // Use a simple approach: room.document stores docs in a Map, we access via getDocument
    // Since we can't iterate the Map from outside, we'll track doc IDs on the room
    for (const docId of room.documentIds ?? []) {
      const doc = room.document.getDocument(docId);
      if (doc) results.push([docId, doc]);
    }
    return results;
  }

  private findRoomAndMilestone(
    userId: UserId,
    documentId: DocumentId,
    milestoneId: MilestoneId,
  ) {
    for (const room of this.rooms.values()) {
      if (!room.slots.has(userId) || !room.document) continue;

      const doc = room.document.getDocument(documentId);
      if (!doc) {
        this.panelEmitter.sendToUser(userId, {
          panel: "error",
          message: `Document ${documentId} not found`,
        });
        return null;
      }

      const milestone = doc.milestones?.find((m) => m.id === milestoneId);
      if (!milestone) {
        this.panelEmitter.sendToUser(userId, {
          panel: "error",
          message: `Milestone ${milestoneId} not found`,
        });
        return null;
      }

      return { room, doc, milestone };
    }

    this.panelEmitter.sendToUser(userId, {
      panel: "error",
      message: "No active room found",
    });
    return null;
  }

  private handleConfirmMilestone(
    userId: UserId,
    documentId: DocumentId,
    milestoneId: MilestoneId,
  ): void {
    const found = this.findRoomAndMilestone(userId, documentId, milestoneId);
    if (!found) return;
    const { room, doc, milestone } = found;

    // Only allow confirmation from pending / partially confirmed states
    const allowedStatuses = [
      "pending",
      "provider_confirmed",
      "client_confirmed",
    ];
    if (!allowedStatuses.includes(milestone.status)) {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: `Cannot confirm — milestone is ${milestone.status}`,
      });
      return;
    }

    const isProvider = userId === doc.providerId;
    const isClient = userId === doc.clientId;
    if (!isProvider && !isClient) {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: "You are not a party to this document",
      });
      return;
    }

    // Check if this side already confirmed
    if (isProvider && milestone.providerConfirmed) {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: "You already confirmed this milestone",
      });
      return;
    }
    if (isClient && milestone.clientConfirmed) {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: "You already confirmed this milestone",
      });
      return;
    }

    const providerConfirmed = isProvider
      ? true
      : (milestone.providerConfirmed ?? false);
    const clientConfirmed = isClient
      ? true
      : (milestone.clientConfirmed ?? false);
    const bothConfirmed = providerConfirmed && clientConfirmed;

    let newStatus: import("../types.js").MilestoneStatus;
    if (bothConfirmed) {
      // Range-priced items need amount proposal
      const isRange =
        milestone.minAmount != null && milestone.maxAmount != null;
      newStatus = isRange ? "pending_amount" : "completed";
    } else {
      newStatus = isProvider ? "provider_confirmed" : "client_confirmed";
    }

    const updatedMilestone = {
      ...milestone,
      providerConfirmed,
      clientConfirmed,
      status: newStatus,
      ...(newStatus === "completed"
        ? { completedAt: Date.now(), completedBy: userId }
        : {}),
    };

    const updatedMilestones = (doc.milestones ?? []).map((m) =>
      m.id === milestoneId ? updatedMilestone : m,
    );
    room.document!.updateMilestones(documentId, updatedMilestones);

    this.panelEmitter.broadcast(room.id, {
      panel: "milestone",
      milestone: updatedMilestone,
    });
    const updatedDoc = room.document!.getDocument(documentId);
    if (updatedDoc) {
      this.panelEmitter.broadcast(room.id, {
        panel: "document",
        document: updatedDoc,
      });
    }

    // Auto-capture for fixed-price items when both confirmed
    if (newStatus === "completed" && milestone.escrowHoldId) {
      room.payment
        .captureEscrow(milestone.escrowHoldId, milestone.amount)
        .then(() => {
          this.panelEmitter.broadcast(room.id, {
            panel: "payment_receipt",
            amount: milestone.amount,
            currency: doc.terms.currency,
            recipient:
              doc.parties.find((p) => p.userId === doc.providerId)?.name ??
              "Provider",
            status: "succeeded",
            paymentIntentId: milestone.escrowHoldId!,
            description: milestone.description,
          });
          this.checkAllMilestonesComplete(room, documentId);
        })
        .catch((err) => {
          console.error("[room] Escrow capture failed:", err);
          this.panelEmitter.broadcast(room.id, {
            panel: "error",
            message: `Escrow capture failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        });
    } else if (newStatus === "pending_amount") {
      // No capture yet — wait for amount proposal
    }
  }

  private handleProposeMilestoneAmount(
    userId: UserId,
    documentId: DocumentId,
    milestoneId: MilestoneId,
    amount: number,
  ): void {
    const found = this.findRoomAndMilestone(userId, documentId, milestoneId);
    if (!found) return;
    const { room, doc, milestone } = found;

    if (userId !== doc.providerId) {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: "Only the provider can propose an amount",
      });
      return;
    }
    if (milestone.status !== "pending_amount") {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: `Cannot propose amount — milestone is ${milestone.status}`,
      });
      return;
    }
    if (milestone.minAmount != null && amount < milestone.minAmount) {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: `Amount must be at least ${milestone.minAmount}`,
      });
      return;
    }
    if (milestone.maxAmount != null && amount > milestone.maxAmount) {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: `Amount must be at most ${milestone.maxAmount}`,
      });
      return;
    }

    const updatedMilestone = {
      ...milestone,
      proposedAmount: amount,
      proposedBy: userId,
    };
    const updatedMilestones = (doc.milestones ?? []).map((m) =>
      m.id === milestoneId ? updatedMilestone : m,
    );
    room.document!.updateMilestones(documentId, updatedMilestones);

    this.panelEmitter.broadcast(room.id, {
      panel: "milestone",
      milestone: updatedMilestone,
    });
    const updatedDoc = room.document!.getDocument(documentId);
    if (updatedDoc) {
      this.panelEmitter.broadcast(room.id, {
        panel: "document",
        document: updatedDoc,
      });
    }
  }

  private handleApproveMilestoneAmount(
    userId: UserId,
    documentId: DocumentId,
    milestoneId: MilestoneId,
  ): void {
    const found = this.findRoomAndMilestone(userId, documentId, milestoneId);
    if (!found) return;
    const { room, doc, milestone } = found;

    if (userId !== doc.clientId) {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: "Only the client can approve the amount",
      });
      return;
    }
    if (milestone.status !== "pending_amount") {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: `Cannot approve — milestone is ${milestone.status}`,
      });
      return;
    }
    if (milestone.proposedAmount == null) {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: "No amount has been proposed yet",
      });
      return;
    }

    const updatedMilestone = {
      ...milestone,
      status: "completed" as const,
      amount: milestone.proposedAmount,
      completedAt: Date.now(),
      completedBy: userId,
    };
    const updatedMilestones = (doc.milestones ?? []).map((m) =>
      m.id === milestoneId ? updatedMilestone : m,
    );
    room.document!.updateMilestones(documentId, updatedMilestones);

    this.panelEmitter.broadcast(room.id, {
      panel: "milestone",
      milestone: updatedMilestone,
    });
    const updatedDoc = room.document!.getDocument(documentId);
    if (updatedDoc) {
      this.panelEmitter.broadcast(room.id, {
        panel: "document",
        document: updatedDoc,
      });
    }

    // Capture escrow at the approved amount
    if (milestone.escrowHoldId) {
      room.payment
        .captureEscrow(milestone.escrowHoldId, milestone.proposedAmount)
        .then(() => {
          this.panelEmitter.broadcast(room.id, {
            panel: "payment_receipt",
            amount: milestone.proposedAmount!,
            currency: doc.terms.currency,
            recipient:
              doc.parties.find((p) => p.userId === doc.providerId)?.name ??
              "Provider",
            status: "succeeded",
            paymentIntentId: milestone.escrowHoldId!,
            description: milestone.description,
          });
          this.checkAllMilestonesComplete(room, documentId);
        })
        .catch((err) => {
          console.error("[room] Escrow capture failed:", err);
          this.panelEmitter.broadcast(room.id, {
            panel: "error",
            message: `Escrow capture failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        });
    }
  }

  private handleReleaseEscrow(
    userId: UserId,
    documentId: DocumentId,
    milestoneId: MilestoneId,
  ): void {
    const found = this.findRoomAndMilestone(userId, documentId, milestoneId);
    if (!found) return;
    const { room, doc, milestone } = found;

    if (userId !== doc.providerId) {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: "Only the provider can release escrow",
      });
      return;
    }
    if (milestone.status === "completed" || milestone.status === "released") {
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: `Cannot release — milestone is ${milestone.status}`,
      });
      return;
    }

    const updatedMilestone = { ...milestone, status: "released" as const };
    const updatedMilestones = (doc.milestones ?? []).map((m) =>
      m.id === milestoneId ? updatedMilestone : m,
    );
    room.document!.updateMilestones(documentId, updatedMilestones);

    this.panelEmitter.broadcast(room.id, {
      panel: "milestone",
      milestone: updatedMilestone,
    });
    const updatedDoc = room.document!.getDocument(documentId);
    if (updatedDoc) {
      this.panelEmitter.broadcast(room.id, {
        panel: "document",
        document: updatedDoc,
      });
    }

    // Release escrow funds
    if (milestone.escrowHoldId) {
      room.payment
        .releaseEscrow(milestone.escrowHoldId)
        .then(() => {
          this.panelEmitter.broadcast(room.id, {
            panel: "payment_receipt",
            amount: milestone.amount,
            currency: doc.terms.currency,
            recipient:
              doc.parties.find((p) => p.userId === doc.clientId)?.name ??
              "Client",
            status: "succeeded",
            paymentIntentId: milestone.escrowHoldId!,
            description: `Released: ${milestone.description}`,
          });
          this.checkAllMilestonesComplete(room, documentId);
        })
        .catch((err) => {
          console.error("[room] Escrow release failed:", err);
          this.panelEmitter.broadcast(room.id, {
            panel: "error",
            message: `Escrow release failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        });
    }
  }

  private checkAllMilestonesComplete(room: Room, documentId: string): void {
    const doc = room.document?.getDocument(documentId);
    if (!doc?.milestones) return;

    const allDone = doc.milestones.every(
      (m) => m.status === "completed" || m.status === "released",
    );
    if (allDone) {
      for (const slot of room.slots.values()) {
        slot.session.setStatus("completed");
      }
      this.panelEmitter.broadcast(room.id, {
        panel: "status",
        roomId: room.id,
        users: [...room.slots.keys()],
        sessionStatus: "completed",
      });
    }
  }

  private cleanupSlot(room: Room, userId: UserId): void {
    const slot = room.slots.get(userId);
    if (!slot) return;

    slot.agent.stop();
    slot.triggerDetector.destroy();
    slot.transcription.stop().catch(() => {});
    slot.audio.destroy();
    slot.session.reset();
    this.panelEmitter.unregisterSocket(userId);
    room.audioRelay.unregisterUser(userId);
    room.slots.delete(userId);

    // Only unpair when we drop below 2 users
    if (room.slots.size < 2) {
      room.paired = false;
      room.triggerInProgress = false;
      if (room.pendingTriggerTimeout) {
        clearTimeout(room.pendingTriggerTimeout);
      }
      room.pendingTrigger = null;
      room.pendingTriggerTimeout = null;
    }

    // Abort active negotiation when a user leaves
    if (room.negotiation?.getActiveNegotiation()) {
      room.negotiation.destroy();
      room.negotiation = null;
    }
  }
}
