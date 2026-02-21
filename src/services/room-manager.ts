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
    console.log(`[room] Audio socket registered for ${userId}`);
    const room = this.rooms.get(roomId);
    if (!room) {
      ws.close(4003, "Room not found");
      return;
    }
    const slot = room.slots.get(userId);
    if (!slot) {
      ws.close(4004, "User not in room");
      return;
    }

    room.audioRelay.registerUser(userId, ws);

    // Start transcription when audio socket connects (lazy — avoids wasting API time before audio flows)
    slot.transcription.start().catch((err) => {
      console.error("[room] Transcription start failed:", err);
      this.panelEmitter.sendToUser(userId, {
        panel: "error",
        message: `Transcription failed: ${(err as Error).message}`,
      });
    });

    let audioFlowing = false;
    ws.on("message", (data) => {
      if (typeof data !== "string") {
        if (!audioFlowing) {
          console.log(`[room] Audio flowing for ${userId}`);
          audioFlowing = true;
        }
        const buffer = Buffer.from(data as ArrayBuffer);
        slot.audio.feedRawAudio(buffer);
        room.audioRelay.relayAudio(userId, buffer);
      }
    });

    ws.on("close", () => {
      room.audioRelay.unregisterUser(userId);
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

    const transcription = new TranscriptionService({
      apiKey: this.config.elevenlabs.apiKey,
      region: this.config.elevenlabs.region,
      language: this.config.elevenlabs.language,
    });

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

    // Per-user TriggerDetector
    const triggerLlmProvider = createLLMProvider(
      this.config.llm.provider,
      this.config.llm.apiKey,
    );
    const triggerDetector = new TriggerDetector({
      keyword: this.config.trigger.keyword,
      smartDetectionEnabled: this.config.trigger.smartDetectionEnabled,
      llmProvider: triggerLlmProvider,
      llmModel: this.config.llm.model,
      userId,
      displayName: profile.displayName,
    });

    // Wire per-user trigger events
    triggerDetector.on("triggered", (event: TriggerEvent) =>
      this.handleUserTrigger(room, userId, event),
    );

    triggerDetector.on(
      "smart:check",
      (info: {
        transcriptLines: number;
        inputPreview: string;
        timestamp: number;
      }) => {
        this.panelEmitter.sendToUser(userId, {
          panel: "agent",
          userId: "system",
          text: `[Smart Detection] Analyzing ${info.transcriptLines} transcript lines...\n"${info.inputPreview}"`,
          timestamp: info.timestamp,
        });
      },
    );

    triggerDetector.on(
      "smart:result",
      (result: {
        triggered: boolean;
        confidence: number;
        terms: Array<{ term: string; confidence: number; context: string }>;
        role?: string;
        summary?: string;
        error?: string;
        timestamp: number;
      }) => {
        let text: string;
        if (result.error) {
          text = `[Smart Detection] Error: ${result.error}`;
        } else if (result.triggered) {
          const termList = result.terms
            .map(
              (t) =>
                `"${t.term}" (${(t.confidence * 100).toFixed(0)}%) — ${t.context}`,
            )
            .join("\n  ");
          const roleInfo =
            result.role && result.role !== "unclear"
              ? ` | Role: ${result.role}`
              : "";
          text = `[Smart Detection] TRIGGERED (confidence: ${(result.confidence * 100).toFixed(0)}%${roleInfo})\n  ${termList}`;
          if (result.summary) {
            text += `\n  Summary: ${result.summary}`;
          }
        } else {
          text = `[Smart Detection] No agreement detected (confidence: ${(result.confidence * 100).toFixed(0)}%)`;
        }
        this.panelEmitter.sendToUser(userId, {
          panel: "agent",
          userId: "system",
          text,
          timestamp: result.timestamp,
        });
      },
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
      slotA.session.setStatus("active");
      slotB.session.setStatus("active");
      slotA.triggerDetector.reset();
      slotB.triggerDetector.reset();
    });

    // Wire peer message routing
    peerA.on("message", (msg: AgentMessage) => {
      room.negotiation?.handleAgentMessage(msg);
      slotB.agent.receiveAgentMessage(msg);
    });
    peerB.on("message", (msg: AgentMessage) => {
      room.negotiation?.handleAgentMessage(msg);
      slotA.agent.receiveAgentMessage(msg);
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
        panelEmitter: this.panelEmitter,
        peer: slot.peer!,
        userId: uid,
        otherUserId: otherUid,
        displayName: userProfile.displayName,
        recipientAccountId: otherProfile?.stripeAccountId ?? "",
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

  private handleUserTrigger(
    room: Room,
    userId: UserId,
    event: TriggerEvent,
  ): void {
    // Double-trigger guard: if negotiation already active, ignore
    if (room.negotiation?.getActiveNegotiation()) {
      console.log(
        `[room] Trigger from ${userId} ignored — negotiation already active`,
      );
      return;
    }
    this.handleTrigger(room, event);
  }

  private handleTrigger(room: Room, event: TriggerEvent): void {
    console.log(`[room] Trigger detected: ${event.type} by ${event.speakerId}`);

    for (const slot of room.slots.values()) {
      slot.session.setStatus("negotiating");
    }

    const initiatorSlot = room.slots.get(event.speakerId);
    if (!initiatorSlot) return;

    const conversationContext = initiatorSlot.session.getTranscriptText();
    initiatorSlot.agent
      .startNegotiation(event, conversationContext)
      .catch((err) => console.error("[room] Start negotiation failed:", err));
  }

  private async handleAgreement(
    room: Room,
    negotiation: Negotiation,
  ): Promise<void> {
    for (const slot of room.slots.values()) {
      slot.session.setStatus("signing");
    }

    const parties = [...room.slots.entries()].map(([uid]) => {
      const profile =
        this.profileManager.getProfile(uid) ??
        this.profileManager.getDefaultProfile(uid);
      return { userId: uid, name: profile.displayName, role: profile.role };
    });

    const firstSlot = room.slots.values().next().value;
    const conversationContext = firstSlot
      ? firstSlot.session.getTranscriptText()
      : "";

    const doc = await room.document?.generateDocument(
      negotiation,
      negotiation.currentProposal,
      parties,
      conversationContext,
    );

    if (doc) {
      this.panelEmitter.broadcast(room.id, {
        panel: "document",
        document: doc,
      });
    }

    room.document?.once(
      "document:signed",
      ({ documentId, userId }: { documentId: string; userId: string }) => {
        this.panelEmitter.broadcast(room.id, {
          panel: "execution",
          negotiationId: negotiation.id,
          step: "signature",
          status: `${userId} signed`,
        });
      },
    );

    room.document?.once("document:completed", async () => {
      await this.executePayments(room, negotiation);
    });
  }

  private async executePayments(
    room: Room,
    negotiation: Negotiation,
  ): Promise<void> {
    const responderProfile = this.profileManager.getProfile(
      negotiation.responder,
    );
    const recipientStripeId = responderProfile?.stripeAccountId ?? "";

    for (const li of negotiation.currentProposal.lineItems) {
      if (li.type === "immediate") {
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
          details: result.success
            ? `Payment: £${(li.amount / 100).toFixed(2)}`
            : result.error,
        });
      } else if (li.type === "escrow") {
        try {
          const hold = await room.payment.createEscrowHold({
            amount: li.amount,
            currency: negotiation.currentProposal.currency,
            description: li.description,
            recipientAccountId: recipientStripeId,
          });
          this.panelEmitter.broadcast(room.id, {
            panel: "execution",
            negotiationId: negotiation.id,
            step: `escrow_${li.description}`,
            status: "done",
            details: `Escrow: £${(hold.amount / 100).toFixed(2)} held (${hold.holdId})`,
          });
        } catch (err) {
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
    room.paired = false;
  }
}
