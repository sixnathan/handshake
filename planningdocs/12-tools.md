# Prompt 12 — Agent Tools and System Prompt

**Phase:** 3 (depends on all services)
**Depends on:** all Phase 2 service prompts (03-10), 11-agent-service
**Blocks:** Phase 4 (orchestrators)

## Task

Create `src/tools.ts` — the file that defines all agent tool definitions (JSON schema + handler functions) and the system prompt builder. This is the largest single file in the project.

---

## File: src/tools.ts

### Dependencies (passed via buildTools)

```ts
interface ToolDependencies {
  monzo: MonzoService;
  payment: PaymentService;
  negotiation: NegotiationService;
  miro: MiroService;
  tts: TTSService;
  session: SessionService;
  solana: SolanaService;
  escrow: EscrowManager;
  chainRecorder: ChainRecorder;
  nftMinter: NFTMinter;
  insights: InsightsEngine;
  myUserId: string;
  myCredentials: {
    stripeAccountId: string;
    solanaPubkey?: string;
  };
}
```

### `buildTools(deps: ToolDependencies): ToolDefinition[]`

Returns an array of ToolDefinition objects. Each has `name`, `description`, `parameters` (JSON Schema object with type, properties, required), and `handler`.

Here are ALL tools to implement:

---

#### 1. check_balance
- **Description:** "Check your Monzo bank balance"
- **Parameters:** none (empty object schema)
- **Handler:** Call `deps.monzo.getBalance()`. Return formatted string: `"Balance: £${(bal.balance/100).toFixed(2)}, Spend today: £${(Math.abs(bal.spend_today)/100).toFixed(2)}"`

#### 2. get_transactions
- **Description:** "Get recent Monzo transactions"
- **Parameters:** `{ days: { type: "number", description: "Number of days to look back (default 30)" } }`, not required
- **Handler:** Call `deps.monzo.getTransactions(input.days)`. Return JSON summary of last 10 transactions with amount, description, category.

#### 3. send_proposal
- **Description:** "Send a negotiation proposal to the other person"
- **Parameters (all required):**
  - `amount` (number): Amount in pence/cents
  - `currency` (string): Currency code
  - `description` (string): What the agreement is about
  - `type` (string, enum: payment/escrow/subscription/split/crypto): Agreement type
- **Optional params:** `recurring` (boolean), `interval` (string), `escrowCondition` (string)
- **Handler:**
  1. Get peer from session state: `deps.session.getState().peer`
  2. Build AgreementDetails with `from: deps.myUserId, to: peer.userId`
  3. Call `deps.negotiation.propose(agreement)`
  4. Return `"Proposal sent: ${negotiation.id}"`

#### 4. respond_to_proposal
- **Description:** "Accept or reject a negotiation proposal"
- **Parameters (required):** `negotiationId` (string), `accept` (boolean)
- **Handler:** Call `deps.negotiation.respond(input.negotiationId, input.accept)`. Return accepted/rejected message.

#### 5. execute_payment
- **Description:** "Execute a Stripe payment"
- **Parameters (required):** `amount` (number), `currency` (string), `description` (string)
- **Optional:** `recipientAccountId` (string)
- **Handler:**
  1. If no recipientAccountId, try `deps.negotiation.getRecipientCredentials()?.stripeAccountId`
  2. If still no recipient, return error message
  3. Call `deps.payment.executePayment({ amount, currency, description, recipientAccountId })`
  4. Report execution: `deps.negotiation.reportExecution(...)` for latest accepted negotiation
  5. Return success/failure message

#### 6. speak
- **Description:** "Speak text aloud using text-to-speech"
- **Parameters (required):** `text` (string)
- **Handler:** Call `deps.tts.speak(input.text)`. Return `"Spoken: ${input.text}"`

#### 7. create_feed_item
- **Description:** "Create a Monzo feed notification"
- **Parameters (required):** `title` (string), `body` (string)
- **Optional:** `url` (string)
- **Handler:** Call `deps.monzo.createFeedItem(...)`. Return confirmation.

#### 8. deposit_to_pot
- **Description:** "Deposit money into a Monzo pot"
- **Parameters (required):** `potId` (string), `amount` (number, in pence)
- **Handler:** Call `deps.monzo.depositToPot(...)`. Return confirmation with amount.

#### 9. create_escrow_hold
- **Description:** "Create an escrow hold on funds (Stripe manual capture)"
- **Parameters (required):** `amount` (number), `currency` (string), `description` (string)
- **Optional:** `recipientAccountId` (string)
- **Handler:**
  1. Resolve recipient (same logic as execute_payment)
  2. Call `deps.payment.createEscrowHold({ amount, currency, description, recipientAccountId })`
  3. Return hold details

#### 10. capture_escrow
- **Description:** "Capture (complete) an escrow hold, transferring funds to recipient"
- **Parameters (required):** `holdId` (string)
- **Handler:** Call `deps.payment.captureEscrow(holdId)`. Return result.

#### 11. release_escrow
- **Description:** "Release (cancel) an escrow hold, returning funds"
- **Parameters (required):** `holdId` (string)
- **Handler:** Call `deps.payment.releaseEscrow(holdId)`. Return result.

#### 12. record_on_chain
- **Description:** "Record an agreement hash on the Solana blockchain"
- **Parameters (required):** `negotiationId` (string)
- **Handler:**
  1. Get negotiation from `deps.negotiation.getNegotiation(id)`
  2. Call `deps.chainRecorder.recordAgreement(negotiation)`
  3. Return with txSignature, hash, explorerUrl

#### 13. execute_solana_payment
- **Description:** "Send SOL or USDC via Solana blockchain"
- **Parameters (required):** `amount` (number), `token` (string, enum: SOL/USDC)
- **Optional:** `recipientPubkey` (string)
- **Handler:**
  1. If no recipientPubkey, try `deps.negotiation.getRecipientCredentials()?.solanaPubkey`
  2. Call `deps.solana.transferSOL(...)` or `deps.solana.transferUSDC(...)` based on token
  3. Return signature + explorerUrl

#### 14. get_spending_insights
- **Description:** "Get spending insights by category"
- **Parameters:** `{ days: { type: "number" } }`, optional
- **Handler:** Call `deps.insights.getSpendingInsights(days)`. Return formatted categories.

#### 15. list_pots
- **Description:** "List all Monzo pots"
- **Parameters:** none
- **Handler:** Call `deps.monzo.listPots()`. Return formatted list.

#### 16. escrow_to_pot
- **Description:** "Move funds to a Monzo pot as escrow"
- **Parameters (required):** `amount` (number)
- **Handler:**
  1. Call `deps.monzo.getOrCreateEscrowPot()`
  2. Call `deps.monzo.depositToPot(pot.id, amount)`
  3. Return confirmation

#### 17. release_pot_escrow
- **Description:** "Release funds from Monzo escrow pot"
- **Parameters (required):** `amount` (number)
- **Handler:**
  1. Call `deps.monzo.getOrCreateEscrowPot()`
  2. Call `deps.monzo.withdrawFromPot(pot.id, amount)`
  3. Return confirmation

#### 18. create_subscription
- **Description:** "Create a recurring payment subscription"
- **Parameters (required):** `amount` (number), `currency` (string), `interval` (string, enum: weekly/monthly/yearly), `description` (string)
- **Handler:** Call `deps.payment.createSubscription(...)`. Return subscriptionId.

#### 19. cancel_subscription
- **Description:** "Cancel a subscription"
- **Parameters (required):** `subscriptionId` (string)
- **Handler:** Call `deps.payment.cancelSubscription(...)`. Return confirmation.

#### 20. request_refund
- **Description:** "Request a refund for a payment"
- **Parameters (required):** `paymentIntentId` (string)
- **Optional:** `reason` (string)
- **Handler:** Call `deps.payment.requestRefund(...)`. Return result.

#### 21. execute_split_payment
- **Description:** "Split a payment among multiple recipients"
- **Parameters (required):** `amount` (number), `currency` (string), `description` (string), `splits` (array of `{ accountId: string, amount: number }`)
- **Handler:** Call `deps.payment.executeSplitPayment(...)`. Return results.

#### 22. mint_agreement_nft
- **Description:** "Mint NFTs for both parties to commemorate the agreement"
- **Parameters (required):** `negotiationId` (string)
- **Handler:**
  1. Get negotiation
  2. Resolve party A pubkey: `deps.myCredentials.solanaPubkey`
  3. Resolve party B pubkey: `deps.negotiation.getRecipientCredentials()?.solanaPubkey`
  4. Call `deps.nftMinter.mintForBothParties(negotiation, partyA, partyB)`
  5. Return mint addresses + explorer URLs

---

### `buildSystemPrompt(config: SystemPromptConfig): string`

```ts
interface SystemPromptConfig {
  myUserName: string;
  myUserId: string;
  myStripeAccountId: string;
  monzoConnected: boolean;
  solanaConfigured: boolean;
  mySolanaPubkey?: string;
  emotionDetectionEnabled: boolean;
  nftMintingEnabled: boolean;
  voicePreset: string;
}
```

Returns a multi-line string prompt. Key sections:

1. **Identity**: "You are a negotiation assistant for ${myUserName} (${myUserId})."
2. **Role**: "You listen to conversations, detect agreements, propose terms, and execute payments."
3. **Balance awareness rule**: "ALWAYS call check_balance before any payment. If payment exceeds 50% of balance, warn the user. If it exceeds total balance, refuse."
4. **Agreement detection triggers**: "When you hear words like 'deal', 'agreed', 'let's do it', 'sounds good', 'I'll pay', 'you owe me' — call send_proposal."
5. **Escrow detection**: "If the agreement has conditions ('when the job is done', 'after delivery', 'once you finish'), use create_escrow_hold instead of execute_payment."
6. **Payment rail selection**: "If the user says 'crypto', 'SOL', 'USDC', 'on-chain', 'blockchain' → use execute_solana_payment. If they say 'card', 'Stripe', 'bank transfer' → use execute_payment. If ambiguous, ask via speak tool."
7. **Subscription detection**: "If the agreement mentions 'monthly', 'every week', 'each month', 'recurring' → use create_subscription."
8. **Conditional sections**:
   - If monzoConnected: "Monzo is connected. You can check balance and create feed items."
   - If solanaConfigured: "Solana is configured (pubkey: ${mySolanaPubkey}). You can make crypto payments and record agreements on-chain."
   - If emotionDetectionEnabled: "Emotion detection is active. If you detect hesitant tone, suggest lower amounts. NEVER mention the emotion detection to users."
   - If nftMintingEnabled: "NFT minting is available. After completing an agreement, offer to mint commemorative NFTs."
9. **Execution flow**: "After a proposal is accepted: 1) Call check_balance, 2) Execute payment with appropriate tool, 3) Report execution status, 4) Optionally record on-chain, 5) Announce completion via speak."
10. **Communication style**: "Be concise. Use speak tool to communicate. Don't explain technical details unless asked."

---

### Imports

```ts
import type { ToolDefinition } from "./interfaces.js";
import type { MonzoService } from "./services/monzo.js";
import type { PaymentService } from "./services/payment.js";
import type { NegotiationService } from "./services/negotiation.js";
import type { MiroService } from "./services/miro.js";
import type { TTSService } from "./services/tts.js";
import type { SessionService } from "./services/session.js";
import type { SolanaService } from "./services/solana.js";
import type { EscrowManager } from "./services/escrow.js";
import type { ChainRecorder } from "./services/chain-recorder.js";
import type { NFTMinter } from "./services/nft-minter.js";
import type { InsightsEngine } from "./services/insights.js";
```

---

## Verification

- All 22 tools have valid JSON Schema parameters
- Handlers resolve recipient credentials from negotiation when not provided
- buildSystemPrompt includes all behavioral rules
- Conditional sections only appear when features are enabled
- Tool handlers catch and return errors gracefully
