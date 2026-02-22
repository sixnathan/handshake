import { EventEmitter } from "eventemitter3";
import type {
  AudioChunk,
  AgentProfile,
  AgentProposal,
  AgentMessage,
  ClientMessage,
  DocumentId,
  EscrowHold,
  LegalDocument,
  DocumentParty,
  LineItem,
  Milestone,
  MilestoneId,
  MonzoBalance,
  MonzoTransaction,
  Negotiation,
  NegotiationId,
  PanelMessage,
  PaymentRequest,
  PaymentResult,
  RoomId,
  SessionStatus,
  TranscriptEntry,
  TriggerEvent,
  UserId,
  VerificationResult,
  WordTimestamp,
} from "./types.js";

// ── Transcript helpers ──────────────────────

export interface FinalTranscript {
  text: string;
  startTime?: number;
  endTime?: number;
  words?: WordTimestamp[];
}

export interface PartialTranscript {
  text: string;
}

// ── IAudioService ───────────────────────────
// Events: "chunk" → AudioChunk

export interface IAudioService extends EventEmitter {
  feedRawAudio(buffer: Buffer): void;
  setSampleRate(rate: number): void;
  destroy(): void;
}

// ── IAudioRelayService ──────────────────────
// Relays PCM audio between users in a room via WebSocket

export interface IAudioRelayService {
  registerUser(userId: UserId, ws: import("ws").WebSocket): void;
  unregisterUser(userId: UserId): void;
  relayAudio(fromUserId: UserId, buffer: Buffer): void;
  destroy(): void;
}

// ── ITranscriptionService ───────────────────
// Events: "partial" → PartialTranscript, "final" → FinalTranscript

export interface ITranscriptionService extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
  feedAudio(chunk: AudioChunk): void;
}

// ── ITriggerDetector ────────────────────────
// Events: "triggered" → TriggerEvent

export interface ITriggerDetector extends EventEmitter {
  feedTranscript(entry: TranscriptEntry): void;
  setKeyword(keyword: string): void;
  reset(): void;
  destroy(): void;
}

// ── ISessionService ─────────────────────────
// Events: "status_changed" → SessionStatus

export interface ISessionService extends EventEmitter {
  getStatus(): SessionStatus;
  setStatus(status: SessionStatus): void;
  addTranscript(entry: TranscriptEntry): void;
  getTranscripts(): readonly TranscriptEntry[];
  getTranscriptText(): string;
  getRecentTranscriptText(windowMs: number): string;
  reset(): void;
}

// ── IProfileManager ─────────────────────────

export interface IProfileManager {
  setProfile(userId: UserId, profile: AgentProfile): void;
  getProfile(userId: UserId): AgentProfile | undefined;
  getDefaultProfile(userId: UserId): AgentProfile;
  removeProfile(userId: UserId): void;
}

// ── IAgentService ───────────────────────────
// Events: "agent:proposal" → { negotiationId, proposal, fromAgent }
//         "agent:counter"  → { negotiationId, proposal, reason, fromAgent }
//         "agent:accept"   → { negotiationId, fromAgent }
//         "agent:reject"   → { negotiationId, reason, fromAgent }
//         "agent:message"  → { text, timestamp }

export interface IAgentService extends EventEmitter {
  start(profile: AgentProfile): Promise<void>;
  stop(): void;
  setTools(tools: ToolDefinition[]): void;
  pushTranscript(entry: TranscriptEntry): void;
  startNegotiation(
    trigger: TriggerEvent,
    conversationContext: string,
  ): Promise<void>;
  receiveAgentMessage(message: AgentMessage): Promise<void>;
  injectInstruction(content: string): Promise<void>;
}

// ── INegotiationService ─────────────────────
// Events: "negotiation:started"  → Negotiation
//         "negotiation:updated"  → Negotiation
//         "negotiation:agreed"   → Negotiation
//         "negotiation:rejected" → Negotiation
//         "negotiation:expired"  → Negotiation

export interface INegotiationService extends EventEmitter {
  createNegotiation(
    initiator: UserId,
    responder: UserId,
    proposal: AgentProposal,
  ): Negotiation;
  handleAgentMessage(message: AgentMessage): void;
  getNegotiation(id: NegotiationId): Negotiation | undefined;
  getActiveNegotiation(): Negotiation | undefined;
  destroy(): void;
}

// ── IDocumentService ────────────────────────
// Events: "document:generated" → LegalDocument
//         "document:signed"    → { documentId, userId }
//         "document:completed" → LegalDocument

export interface IDocumentService extends EventEmitter {
  generateDocument(
    negotiation: Negotiation,
    proposal: AgentProposal,
    parties: DocumentParty[],
    conversationContext: string,
  ): Promise<LegalDocument>;
  signDocument(documentId: DocumentId, userId: UserId): void;
  isFullySigned(documentId: DocumentId): boolean;
  getDocument(documentId: DocumentId): LegalDocument | undefined;
  updateMilestones(documentId: DocumentId, milestones: Milestone[]): void;
}

// ── IPaymentService ─────────────────────────

export interface IPaymentService {
  executePayment(request: PaymentRequest): Promise<PaymentResult>;
  createEscrowHold(request: PaymentRequest): Promise<EscrowHold>;
  captureEscrow(holdId: string, amount?: number): Promise<PaymentResult>;
  releaseEscrow(holdId: string): Promise<PaymentResult>;
}

// ── IMonzoService ───────────────────────────

export interface IMonzoService {
  setAccessToken(token: string): void;
  isAuthenticated(): boolean;
  getBalance(): Promise<MonzoBalance>;
  getTransactions(days?: number): Promise<MonzoTransaction[]>;
}

// ── IInProcessPeer ──────────────────────────
// Events: "message" → AgentMessage

export interface IInProcessPeer extends EventEmitter {
  send(message: AgentMessage): void;
  getOtherUserId(): UserId;
}

// ── IPanelEmitter ───────────────────────────

export interface IPanelEmitter {
  registerSocket(userId: UserId, ws: import("ws").WebSocket): void;
  unregisterSocket(userId: UserId): void;
  setRoom(userId: UserId, roomId: RoomId): void;
  sendToUser(userId: UserId, message: PanelMessage): void;
  broadcast(roomId: RoomId, message: PanelMessage): void;
}

// ── IRoomManager ────────────────────────────

export interface IRoomManager {
  joinRoom(roomId: RoomId, userId: UserId, profile: AgentProfile): void;
  leaveRoom(roomId: RoomId, userId: UserId): void;
  registerAudioSocket(
    roomId: RoomId,
    userId: UserId,
    ws: import("ws").WebSocket,
  ): void;
  registerPanelSocket(
    roomId: RoomId,
    userId: UserId,
    ws: import("ws").WebSocket,
  ): void;
  handleClientMessage(userId: UserId, message: ClientMessage): void;
  getRoomUsers(roomId: RoomId): UserId[];
  destroy(): void;
}

// ── IVerificationService ───────────────────
// Events: "verification:started"   → { verificationId, milestoneId }
//         "verification:update"    → { verificationId, milestoneId, step, details }
//         "verification:completed" → VerificationResult

export interface IVerificationService extends EventEmitter {
  verifyMilestone(
    document: LegalDocument,
    milestone: Milestone,
    lineItem: LineItem,
    requestedBy: UserId,
    phoneNumber?: string,
    contactName?: string,
  ): Promise<VerificationResult>;
  getResult(verificationId: string): VerificationResult | undefined;
}

// ── ToolDefinition ──────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<string>;
}
