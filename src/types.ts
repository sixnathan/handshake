// ── Core IDs ────────────────────────────────

export type UserId = string;
export type NegotiationId = string;
export type RoomId = string;
export type DocumentId = string;
export type MilestoneId = string;
export type VerificationId = string;

// ── Agent Profile ──────────────────────────

export interface AgentPreferences {
  maxAutoApproveAmount: number; // pence
  preferredCurrency: string;
  escrowPreference: "always" | "above_threshold" | "never";
  escrowThreshold: number; // pence
  negotiationStyle: "aggressive" | "balanced" | "conservative";
}

export interface AgentProfile {
  displayName: string;
  role: string; // "landlord", "plumber", etc.
  customInstructions: string; // freeform agent instructions
  preferences: AgentPreferences;
  stripeAccountId?: string;
  monzoAccessToken?: string;
  trade?: string;
  experienceYears?: number;
  certifications?: string[];
  typicalRateRange?: { min: number; max: number; unit: "hour" | "day" | "job" };
  serviceArea?: string;
  contextDocuments?: string[]; // text content from uploaded docs
}

// ── User & Peer ─────────────────────────────

export interface RoomUser {
  userId: UserId;
  profile: AgentProfile;
  roomId: RoomId;
  joinedAt: number;
}

export interface PeerIdentity {
  userId: UserId;
  displayName: string;
  role: string;
  stripeAccountId?: string;
}

// ── Audio ───────────────────────────────────

export interface AudioChunk {
  buffer: Buffer;
  sampleRate: number;
  timestamp: number;
}

export interface SpeakerSegment {
  speaker: string;
  start: number;
  end: number;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

// ── Transcript ──────────────────────────────

export interface TranscriptEntry {
  id: string;
  speaker: UserId;
  text: string;
  timestamp: number;
  startTime?: number;
  endTime?: number;
  isFinal: boolean;
  source: "local" | "peer";
  words?: WordTimestamp[];
}

// ── Trigger Detection ──────────────────────

export interface DetectedTerm {
  term: string;
  confidence: number;
  context: string; // surrounding sentence
}

export interface TriggerEvent {
  type: "keyword" | "smart" | "dual_keyword";
  confidence: number;
  matchedText: string;
  detectedTerms?: DetectedTerm[];
  timestamp: number;
  speakerId: UserId;
  role?: "proposer" | "responder" | "unclear";
  summary?: string;
}

export interface KeywordState {
  userId: UserId;
  detectedAt: number;
}

// ── Price Factors ──────────────────────────

export interface PriceFactor {
  name: string;
  description: string;
  impact: "increases" | "decreases" | "determines";
}

// ── Agreement & Negotiation ─────────────────

export type NegotiationStatus =
  | "proposed"
  | "countering"
  | "accepted"
  | "rejected"
  | "expired"
  | "executing"
  | "completed"
  | "failed";

export interface LineItem {
  description: string;
  amount: number; // pence
  type: "immediate" | "escrow" | "conditional";
  condition?: string;
  minAmount?: number; // pence — lower bound of range
  maxAmount?: number; // pence — upper bound (escrow holds this)
  factors?: PriceFactor[];
}

export interface ProposalMilestone {
  lineItemIndex: number; // which line item (0-based)
  title: string; // clear, specific deliverable name
  deliverables: string[]; // specific outputs/results
  verificationMethod: string; // how to verify (inspection, receipt, phone call, etc.)
  completionCriteria: string[]; // explicit checklist — ALL must be true
  amount: number; // pence
  expectedTimeline?: string; // "Within 2 hours", "Same day", etc.
}

export interface AgentProposal {
  summary: string;
  lineItems: LineItem[];
  totalAmount: number; // pence
  currency: string;
  conditions: string[];
  expiresAt: number;
  factorSummary?: string; // plain English explanation of how factors determine price
  milestones?: ProposalMilestone[];
}

export interface NegotiationRound {
  round: number;
  fromAgent: UserId;
  proposal: AgentProposal;
  action: "propose" | "counter" | "accept" | "reject";
  reason?: string;
  timestamp: number;
}

export interface Negotiation {
  id: NegotiationId;
  roomId: RoomId;
  status: NegotiationStatus;
  initiator: UserId;
  responder: UserId;
  currentProposal: AgentProposal;
  rounds: NegotiationRound[];
  maxRounds: number;
  roundTimeoutMs: number;
  totalTimeoutMs: number;
  createdAt: number;
  updatedAt: number;
}

// ── Milestone ─────────────────────────────

export type MilestoneStatus =
  | "pending"
  | "provider_confirmed"
  | "client_confirmed"
  | "pending_amount" // both confirmed, awaiting amount proposal for range-priced
  | "completed"
  | "released" // provider voluntarily released escrow
  // Legacy (kept for data compat):
  | "verifying"
  | "failed"
  | "disputed";

export interface Milestone {
  id: MilestoneId;
  documentId: DocumentId;
  lineItemIndex: number;
  description: string;
  amount: number;
  condition: string;
  status: MilestoneStatus;
  deliverables?: string[];
  verificationMethod?: string;
  completionCriteria?: string[];
  expectedTimeline?: string;
  escrowHoldId?: string;
  completedAt?: number;
  completedBy?: UserId;
  verificationId?: VerificationId;
  verificationResult?: VerificationResult;
  providerConfirmed?: boolean;
  clientConfirmed?: boolean;
  proposedAmount?: number; // pence — provider's proposed final capture amount
  proposedBy?: UserId;
  minAmount?: number; // pence — copied from LineItem for frontend
  maxAmount?: number; // pence — copied from LineItem for frontend
}

// ── Verification ──────────────────────────

export type VerificationStatus =
  | "pending"
  | "in_progress"
  | "passed"
  | "failed"
  | "disputed";

export interface VerificationEvidence {
  type:
    | "phone_call"
    | "self_attestation"
    | "payment_history"
    | "factor_assessment";
  description: string;
  result: "confirmed" | "denied" | "inconclusive" | "not_applicable";
  details: string;
  timestamp: number;
}

export interface VerificationResult {
  id: VerificationId;
  milestoneId: MilestoneId;
  status: VerificationStatus;
  evidence: VerificationEvidence[];
  reasoning: string;
  recommendedAmount?: number; // pence — for range-priced items
  capturedAmount?: number; // pence — actual amount captured
}

export interface PhoneVerificationRequest {
  phoneNumber: string;
  contactName: string;
  milestoneDescription: string;
  condition: string;
  questions: string[];
}

export interface PhoneVerificationResult {
  success: boolean;
  callId?: string;
  transcript?: string;
  confirmed: boolean;
  details: string;
}

// ── Legal Document ─────────────────────────

export interface DocumentParty {
  userId: UserId;
  name: string;
  role: string;
}

export interface DocumentSignature {
  userId: UserId;
  signedAt: number;
}

export type DocumentStatus = "draft" | "pending_signatures" | "fully_signed";

export interface LegalDocument {
  id: DocumentId;
  title: string;
  content: string; // markdown
  negotiationId: NegotiationId;
  parties: DocumentParty[];
  terms: AgentProposal;
  signatures: DocumentSignature[];
  status: DocumentStatus;
  milestones?: Milestone[];
  providerId?: UserId; // negotiation.initiator
  clientId?: UserId; // negotiation.responder
  createdAt: number;
}

// ── Peer Messages (agent-to-agent) ─────────

export type AgentMessage =
  | {
      type: "agent_proposal";
      negotiationId: NegotiationId;
      proposal: AgentProposal;
      fromAgent: UserId;
    }
  | {
      type: "agent_counter";
      negotiationId: NegotiationId;
      proposal: AgentProposal;
      reason: string;
      fromAgent: UserId;
    }
  | { type: "agent_accept"; negotiationId: NegotiationId; fromAgent: UserId }
  | {
      type: "agent_reject";
      negotiationId: NegotiationId;
      reason: string;
      fromAgent: UserId;
    };

// ── Panel Messages (server → browser) ──────

export type PanelMessage =
  | { panel: "transcript"; entry: TranscriptEntry }
  | { panel: "agent"; userId: UserId; text: string; timestamp: number }
  | { panel: "negotiation"; negotiation: Negotiation }
  | { panel: "document"; document: LegalDocument }
  | { panel: "milestone"; milestone: Milestone }
  | {
      panel: "execution";
      negotiationId: NegotiationId;
      step: string;
      status: string;
      details?: string;
    }
  | {
      panel: "payment_receipt";
      amount: number;
      currency: string;
      recipient: string;
      status: "processing" | "succeeded" | "failed";
      paymentIntentId: string;
      description: string;
    }
  | {
      panel: "status";
      roomId: RoomId;
      users: UserId[];
      sessionStatus: SessionStatus;
    }
  | { panel: "error"; message: string }
  | {
      panel: "verification";
      verificationId: VerificationId;
      milestoneId: MilestoneId;
      step: string;
      status: VerificationStatus;
      details?: string;
      result?: VerificationResult;
    };

// ── Client Messages (browser → server) ─────

export type ClientMessage =
  | { type: "set_profile"; profile: AgentProfile }
  | { type: "sign_document"; documentId: DocumentId }
  | { type: "set_trigger_keyword"; keyword: string }
  | { type: "join_room"; roomId: RoomId }
  | {
      type: "confirm_milestone";
      milestoneId: MilestoneId;
      documentId: DocumentId;
    }
  | {
      type: "propose_milestone_amount";
      milestoneId: MilestoneId;
      documentId: DocumentId;
      amount: number;
    }
  | {
      type: "approve_milestone_amount";
      milestoneId: MilestoneId;
      documentId: DocumentId;
    }
  | {
      type: "release_escrow";
      milestoneId: MilestoneId;
      documentId: DocumentId;
    };

// ── Payment ─────────────────────────────────

export interface PaymentRequest {
  amount: number; // pence
  currency: string;
  description: string;
  recipientAccountId: string; // Stripe Connect account ID
  payerCustomerId?: string; // Stripe Customer ID (for demo: pre-created with saved payment method)
}

export interface PaymentResult {
  success: boolean;
  paymentIntentId?: string;
  transferId?: string;
  error?: string;
}

export interface EscrowHold {
  holdId: string;
  amount: number; // pence — authorized amount
  currency: string;
  status: "held" | "captured" | "released";
  paymentIntentId: string;
  recipientAccountId: string;
  createdAt: number;
}

// ── Monzo ───────────────────────────────────

export interface MonzoBalance {
  balance: number;
  total_balance: number;
  currency: string;
  spend_today: number;
}

export interface MonzoTransaction {
  id: string;
  amount: number;
  currency: string;
  description: string;
  created: string;
  merchant?: { name: string; category?: string };
  category: string;
}

// ── Session ─────────────────────────────────

export type SessionStatus =
  | "discovering"
  | "active"
  | "negotiating"
  | "signing"
  | "completed"
  | "ended";

// ── AppConfig ───────────────────────────────

export interface AppConfig {
  elevenlabs: {
    apiKey: string;
    region: string;
    language: string;
    phoneNumberId?: string;
  };
  stripe: {
    secretKey: string;
    platformAccountId: string;
    customerIdForDemo?: string;
  };
  llm: {
    provider: "anthropic" | "openrouter";
    apiKey: string;
    model: string;
  };
  trigger: {
    keyword: string;
    smartDetectionEnabled: boolean;
  };
  monzo: {
    accessToken?: string;
  };
  port: number;
}
