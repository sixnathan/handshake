# Prompt 01 — Types and Interfaces

**Phase:** 1 (foundation)
**Depends on:** 00-scaffold
**Blocks:** all Phase 2+ prompts

## Task

Create the complete type system and service interface contracts. These two files define every data structure and service boundary in the system.

## File 1: src/types.ts

Create `src/types.ts` with the following types. Use `export type` for type aliases and `export interface` for objects.

### Core IDs

```ts
export type UserId = string;
export type NegotiationId = string;
```

### User & Peer

```ts
export interface UserConfig {
  userId: UserId;
  name: string;
  stripeAccountId: string;
  savedPaymentMethod?: string;
}

export interface PeerIdentity {
  userId: UserId;
  name: string;
  stripeAccountId: string;
  solanaPubkey?: string;
}
```

### Audio

```ts
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
```

### Transcript

```ts
export interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  startTime?: number;
  endTime?: number;
  isFinal: boolean;
  source: "local" | "peer";
}
```

### Agreement & Negotiation

```ts
export type AgreementType = "payment" | "escrow" | "subscription" | "split" | "crypto";

export type NegotiationStatus =
  | "proposed"
  | "pending_response"
  | "accepted"
  | "rejected"
  | "countered"
  | "expired"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"
  | "disputed";

export interface AgreementDetails {
  amount: number; // in smallest currency unit (pence/cents)
  currency: string;
  description: string;
  type: AgreementType;
  from: UserId;
  to: UserId;
  recurring?: boolean;
  interval?: "weekly" | "monthly" | "yearly";
  splitParticipants?: Array<{ userId: UserId; amount: number }>;
  escrowCondition?: string;
}

export interface ExecutionStep {
  step: string;
  status: "pending" | "done" | "failed";
  timestamp: number;
  details?: string;
}

export interface Negotiation {
  id: NegotiationId;
  status: NegotiationStatus;
  proposer: UserId;
  responder: UserId;
  agreement: AgreementDetails;
  counterRound: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  executionSteps: ExecutionStep[];
}
```

### Peer Messages (discriminated union on `type`)

```ts
export type PeerMessage =
  | { type: "identity"; identity: PeerIdentity }
  | { type: "transcript"; entry: TranscriptEntry }
  | { type: "proposal"; negotiation: Negotiation }
  | { type: "response"; negotiationId: NegotiationId; accepted: boolean }
  | { type: "counter"; negotiationId: NegotiationId; newAgreement: AgreementDetails }
  | { type: "execution_update"; negotiationId: NegotiationId; step: string; status: string }
  | { type: "execution_request"; negotiationId: NegotiationId; step: string }
  | { type: "calibration"; data: Record<string, string> }
  | { type: "goodbye" };
```

### Payment

```ts
export interface PaymentRequest {
  amount: number;
  currency: string;
  description: string;
  recipientAccountId: string;
  paymentMethodId?: string;
}

export interface PaymentResult {
  success: boolean;
  paymentIntentId?: string;
  error?: string;
}

export interface EscrowHold {
  holdId: string;
  amount: number;
  currency: string;
  status: "held" | "captured" | "released";
  paymentIntentId: string;
}
```

### Subscription

```ts
export interface SubscriptionAgreement {
  id: string;
  amount: number;
  currency: string;
  interval: "weekly" | "monthly" | "yearly";
  description: string;
  stripeSubscriptionId?: string;
  status: "active" | "cancelled" | "past_due";
}
```

### Monzo

```ts
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

export interface MonzoPot {
  id: string;
  name: string;
  balance: number;
  currency: string;
  type: string;
}
```

### Solana

```ts
export interface SolanaEscrow {
  id: string;
  amount: number;
  token: "SOL" | "USDC";
  sender: string;
  recipient: string;
  memo: string;
  status: "held" | "released";
}

export interface AgreementNFT {
  mintAddress: string;
  metadataUri: string;
  explorerUrl: string;
}
```

### Emotion

```ts
export interface EmotionMetrics {
  wpm: number;
  avgPauseDuration: number;
  silenceRatio: number;
  avgConfidence: number;
}

export type EmotionState = "confident" | "hesitant" | "urgent" | "neutral";
```

### AppConfig

```ts
export interface AppConfig {
  elevenlabs: {
    apiKey: string;
    region?: string;
    language?: string;
    voiceId: string;
    voiceName: string;
    model: string;
  };
  stripe: {
    secretKey: string;
    accountId: string;
  };
  monzo: {
    accessToken?: string;
  };
  llm: {
    provider: "anthropic" | "openrouter";
    apiKey: string;
    model: string;
  };
  miro: {
    accessToken?: string;
    boardId?: string;
  };
  solana: {
    rpcUrl: string;
    keypairSecret?: string;
    network: string;
    usdcMint?: string;
    myPubkey?: string;
  };
  user: {
    id: string;
    name: string;
  };
  features: {
    solana: boolean;
    emotionDetection: boolean;
    nftMinting: boolean;
  };
}
```

### Speaker Mapping

```ts
export type SpeakerMapping = Record<string, UserId>;
```

### Local State

```ts
export type ConversationStatus = "discovering" | "calibrating" | "active" | "ended";

export interface LocalState {
  myUser: UserConfig;
  peer?: PeerIdentity;
  transcripts: {
    local: TranscriptEntry[];
    peer: TranscriptEntry[];
  };
  speakerMapping: SpeakerMapping;
  negotiations: Map<NegotiationId, Negotiation>;
  status: ConversationStatus;
}
```

---

## File 2: src/interfaces.ts

Create `src/interfaces.ts`. Import types from `./types.js`. All interfaces extend EventEmitter3.

```ts
import EventEmitter from "eventemitter3";
// Import all relevant types from ./types.js
```

### FinalTranscript (used by transcription events)

```ts
export interface FinalTranscript {
  text: string;
  startTime?: number;
  endTime?: number;
  words?: WordTimestamp[];
}

export interface PartialTranscript {
  text: string;
}
```

### IPeerService

```ts
export interface IPeerService extends EventEmitter {
  // Events: "connected", "message" (PeerMessage), "disconnected"
  send(message: PeerMessage): void;
  startDiscovery(): Promise<void>;
  getRemoteIdentity(): PeerIdentity | null;
  destroy(): void;
}
```

### ISessionService

```ts
export interface ISessionService extends EventEmitter {
  // Events: "status:changed" (ConversationStatus), "transcript:new" (TranscriptEntry)
  initConversation(config: UserConfig): void;
  setPeer(peer: PeerIdentity): void;
  setSpeakerMapping(mapping: SpeakerMapping): void;
  addLocalTranscript(entry: TranscriptEntry): void;
  addPeerTranscript(entry: TranscriptEntry): void;
  getState(): LocalState;
  getStatus(): ConversationStatus;
  getTranscriptText(): string;
  endConversation(): void;
}
```

### IAudioService

```ts
export interface IAudioService extends EventEmitter {
  // Events: "audio:chunk" (AudioChunk)
  startCapture(sampleRate: number): Promise<void>;
  stopCapture(): void;
  feedRawAudio(buffer: Buffer): void;
}
```

### ITranscriptionService

```ts
export interface ITranscriptionService extends EventEmitter {
  // Events: "transcript:partial" (PartialTranscript), "transcript:final" (FinalTranscript)
  start(): Promise<void>;
  stop(): Promise<void>;
  feedAudio(chunk: AudioChunk): void;
}
```

### INegotiationService

```ts
export interface INegotiationService extends EventEmitter {
  // Events: "proposal:received" (Negotiation), "confirmed" (Negotiation), "execution:update" ({ negotiation, step, status })
  propose(agreement: AgreementDetails): Negotiation;
  respond(negotiationId: NegotiationId, accept: boolean): void;
  counter(negotiationId: NegotiationId, newAgreement: AgreementDetails): void;
  reportExecution(negotiationId: NegotiationId, step: string, status: string): void;
  getNegotiation(id: NegotiationId): Negotiation | undefined;
  getRecipientCredentials(): PeerIdentity | null;
}
```

### IPaymentService

```ts
export interface IPaymentService {
  executePayment(request: PaymentRequest): Promise<PaymentResult>;
  createEscrowHold(request: PaymentRequest): Promise<EscrowHold>;
  captureEscrow(holdId: string): Promise<PaymentResult>;
  releaseEscrow(holdId: string): Promise<PaymentResult>;
  createSubscription(agreement: SubscriptionAgreement): Promise<{ subscriptionId: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  requestRefund(paymentIntentId: string, reason?: string): Promise<PaymentResult>;
  executeSplitPayment(request: PaymentRequest, splits: Array<{ accountId: string; amount: number }>): Promise<PaymentResult[]>;
  savePaymentMethod(paymentMethodId: string): void;
}
```

### IAgentService

```ts
export interface IAgentService extends EventEmitter {
  // Events: "agent:response" (string), "agent:tool_call" ({ name, input, result })
  start(systemPrompt: string, tools: ToolDefinition[]): Promise<void>;
  stop(): void;
  pushTranscript(entry: TranscriptEntry): void;
  pushNegotiationEvent(event: { type: string; negotiation?: Negotiation; message?: string }): void;
}
```

### ITTSService

```ts
export interface ITTSService {
  speak(text: string): Promise<Buffer>;
  speakStream(text: string): Promise<ReadableStream>;
}
```

### IMonzoService

```ts
export interface IMonzoService {
  setAccessToken(token: string): void;
  isAuthenticated(): boolean;
  getBalance(): Promise<MonzoBalance>;
  getTransactions(days?: number): Promise<MonzoTransaction[]>;
  createFeedItem(title: string, body: string, url?: string): Promise<void>;
  depositToPot(potId: string, amount: number): Promise<void>;
  withdrawFromPot(potId: string, amount: number): Promise<void>;
  listPots(): Promise<MonzoPot[]>;
  getOrCreateEscrowPot(): Promise<MonzoPot>;
}
```

### ISolanaService

```ts
export interface ISolanaService {
  isConfigured(): boolean;
  transferSOL(to: string, amount: number): Promise<{ signature: string; explorerUrl: string }>;
  transferUSDC(to: string, amount: number): Promise<{ signature: string; explorerUrl: string }>;
  recordMemo(text: string): Promise<{ signature: string; explorerUrl: string }>;
  getPublicKey(): string | null;
}
```

### IEscrowManager

```ts
export interface IEscrowManager {
  createHold(agreement: AgreementDetails, rail: "stripe" | "solana"): Promise<EscrowHold | SolanaEscrow>;
  capture(holdId: string): Promise<void>;
  release(holdId: string): Promise<void>;
}
```

### IChainRecorder

```ts
export interface IChainRecorder {
  recordAgreement(negotiation: Negotiation): Promise<{ txSignature: string; hash: string; explorerUrl: string }>;
  verifyRecord(txSignature: string, negotiation: Negotiation): Promise<{ verified: boolean }>;
}
```

### INFTMinter

```ts
export interface INFTMinter {
  mintForBothParties(
    negotiation: Negotiation,
    partyAPubkey: string,
    partyBPubkey: string,
  ): Promise<AgreementNFT[]>;
}
```

### IInsightsEngine

```ts
export interface IInsightsEngine {
  getSpendingInsights(days?: number): Promise<{ categories: Record<string, number>; total: number }>;
  getPeerHistory(peerId: string): Promise<MonzoTransaction[]>;
  checkAffordability(amount: number): Promise<{ affordable: boolean; remainingAfter: number; assessment: string }>;
}
```

### IEmotionAnalyzer

```ts
export interface IEmotionAnalyzer {
  analyzeSegment(words: WordTimestamp[]): { state: EmotionState; metrics: EmotionMetrics };
}
```

### ToolDefinition (used by agent)

```ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  handler: (input: Record<string, unknown>) => Promise<string>;
}
```

---

## Verification

- `npx tsc --noEmit src/types.ts src/interfaces.ts` — no type errors
- All types are exported
- All interfaces reference correct type imports
- EventEmitter import from "eventemitter3"
