# Handshake — Complete Architecture Reference

## Overview

Handshake is an AI-powered verbal agreement system. Two people talk; an AI agent listens, detects agreements, proposes terms, and executes payments — all through voice.

**Tech stack:** TypeScript 5.7 strict, Node.js 22, tsx runtime (no build step).

**External APIs:** ElevenLabs (STT + TTS), Anthropic/OpenRouter (LLM), Stripe (payments), Solana (crypto), Monzo (banking), Miro (summaries), Metaplex (NFTs).

**Modes:** CLI (mDNS peer discovery, SoX mic) and Web (WebSocket rooms, browser mic).

---

## Project Structure

```
handshake/
├── package.json
├── tsconfig.json
├── .env.example
├── railway.toml
├── public/
│   └── index.html          # Single-page web frontend
└── src/
    ├── web.ts               # Web mode entry point
    ├── index.ts             # CLI mode orchestrator
    ├── server.ts            # HTTP + WebSocket server
    ├── cli.ts               # CLI router (start, logs, check)
    ├── config.ts            # Env → AppConfig loader
    ├── types.ts             # All domain types
    ├── interfaces.ts        # Service interface contracts
    ├── tools.ts             # Agent tool definitions + system prompt
    ├── logger.ts            # Multi-channel file + console logger
    ├── mic.ts               # SoX microphone capture
    ├── providers/
    │   ├── types.ts         # LLM message/response types
    │   ├── provider.ts      # ILLMProvider interface
    │   ├── anthropic.ts     # Anthropic SDK wrapper
    │   ├── openrouter.ts    # OpenRouter (OpenAI-compatible) client
    │   └── index.ts         # Factory: createLLMProvider()
    └── services/
        ├── audio.ts         # PCM buffer → 250ms chunks
        ├── transcription.ts # ElevenLabs Scribe v2 realtime STT
        ├── session.ts       # Conversation state machine
        ├── agent.ts         # LLM conversation loop
        ├── negotiation.ts   # Proposal/counter/accept protocol
        ├── payment.ts       # Stripe payments + escrow
        ├── solana.ts        # SOL/USDC transfers + memos
        ├── monzo.ts         # Monzo banking API
        ├── tts.ts           # ElevenLabs text-to-speech
        ├── miro.ts          # Post-conversation Miro board
        ├── escrow.ts        # Unified escrow (Stripe + Solana)
        ├── chain-recorder.ts # On-chain agreement hashing
        ├── nft-minter.ts    # Metaplex NFT minting
        ├── emotion.ts       # Prosodic emotion analysis
        ├── insights.ts      # Spending insights from Monzo
        ├── peer.ts          # mDNS peer discovery (CLI)
        ├── in-process-peer.ts # In-memory peer (Web)
        ├── signaling.ts     # WebRTC signaling relay
        ├── panel-emitter.ts # WebSocket → browser panels
        └── room-manager.ts  # Multi-user room orchestrator
```

---

## Type System (types.ts)

### Core IDs
- `UserId`: string (e.g., "alice-x7k2")
- `NegotiationId`: string (uuid)

### User & Peer
```
UserConfig { userId, name, stripeAccountId, savedPaymentMethod? }
PeerIdentity { userId, name, stripeAccountId, solanaPubkey? }
```

### Audio
```
AudioChunk { buffer: Buffer, sampleRate: number, timestamp: number }
SpeakerSegment { speaker: string, start: number, end: number }
WordTimestamp { word: string, start: number, end: number, confidence: number }
```

### Transcript
```
TranscriptEntry {
  id, speaker, text, timestamp, startTime?, endTime?,
  isFinal: boolean, source: "local" | "peer"
}
```

### Negotiation (11-state machine)
```
NegotiationStatus =
  "proposed" | "pending_response" | "accepted" | "rejected" |
  "countered" | "expired" | "executing" | "completed" |
  "failed" | "cancelled" | "disputed"

AgreementType = "payment" | "escrow" | "subscription" | "split" | "crypto"

AgreementDetails {
  amount: number (pence/cents), currency, description,
  type: AgreementType, from: UserId, to: UserId,
  recurring?, interval?, splitParticipants?, escrowCondition?
}

Negotiation {
  id: NegotiationId, status, proposer, responder,
  agreement: AgreementDetails, counterRound: number,
  createdAt, updatedAt, expiresAt?, executionSteps: ExecutionStep[]
}
```

### Peer Messages (discriminated union)
```
PeerMessage = { type: "identity" | "transcript" | "proposal" |
  "response" | "counter" | "execution_update" | "execution_request" |
  "calibration" | "goodbye", ...payload }
```

### Payment
```
PaymentRequest { amount, currency, description, recipientAccountId, paymentMethodId? }
PaymentResult { success, paymentIntentId?, error? }
EscrowHold { holdId, amount, currency, status, paymentIntentId }
```

### Solana
```
SolanaEscrow { id, amount, token, sender, recipient, memo, status }
AgreementNFT { mintAddress, metadataUri, explorerUrl }
```

### Monzo
```
MonzoBalance { balance, total_balance, currency, spend_today }
MonzoTransaction { id, amount, currency, description, created, merchant?, category }
MonzoPot { id, name, balance, currency, type }
```

### Emotion
```
EmotionMetrics { wpm, avgPauseDuration, silenceRatio, avgConfidence }
EmotionState = "confident" | "hesitant" | "urgent" | "neutral"
```

### Subscription
```
SubscriptionAgreement { id, amount, currency, interval, description, stripeSubscriptionId?, status }
```

### AppConfig
```
AppConfig {
  elevenlabs: { apiKey, region?, language?, voiceId, voiceName, model },
  stripe: { secretKey, accountId },
  monzo: { accessToken? },
  llm: { provider: "anthropic" | "openrouter", apiKey, model },
  miro: { accessToken?, boardId? },
  solana: { rpcUrl, keypairSecret?, network, usdcMint?, myPubkey? },
  user: { id, name },
  features: { solana, emotionDetection, nftMinting }
}
```

---

## Interface Contracts (interfaces.ts)

All services use EventEmitter3. Key interfaces:

| Interface | Events | Key Methods |
|-----------|--------|-------------|
| IPeerService | "connected", "message", "disconnected" | send(), startDiscovery(), getRemoteIdentity() |
| ISessionService | "status:changed", "transcript:new" | initConversation(), setPeer(), setSpeakerMapping(), addLocalTranscript(), addPeerTranscript(), getState(), getStatus() |
| IAudioService | "audio:chunk" | startCapture(), stopCapture(), feedRawAudio() |
| ITranscriptionService | "transcript:partial", "transcript:final" | start(), stop(), feedAudio() |
| INegotiationService | "proposal:received", "confirmed", "execution:update" | propose(), respond(), counter(), reportExecution() |
| IPaymentService | — | executePayment(), createEscrowHold(), captureEscrow(), releaseEscrow() |
| IAgentService | "agent:response", "agent:tool_call" | start(), stop(), pushTranscript(), pushNegotiationEvent() |
| ITTSService | — | speak(), speakStream() |
| IMonzoService | — | getBalance(), getTransactions(), createFeedItem(), depositToPot(), listPots() |
| ISolanaService | — | transferSOL(), transferUSDC(), recordMemo(), isConfigured() |
| IEscrowManager | — | createHold(), capture(), release() |
| IChainRecorder | — | recordAgreement(), verifyRecord() |
| INFTMinter | — | mintForBothParties() |
| IInsightsEngine | — | getSpendingInsights(), getPeerHistory(), checkAffordability() |
| IEmotionAnalyzer | — | analyzeSegment() |

---

## Service Implementations

### AudioService
- Buffers raw PCM via `feedRawAudio(buffer)`
- Emits 250ms chunks at 16kHz via `setInterval`
- `audio:chunk` event carries `AudioChunk`

### TranscriptionService (ElevenLabs Scribe v2 Realtime)
- WebSocket to `wss://api.elevenlabs.io/v1/speech-to-text/realtime`
- Config via URL query params: `model_id=scribe_v2_realtime`, `language_code`, `commit_strategy=vad`
- Auth: `xi-api-key` header
- Sends: `{ type: "input_audio_chunk", data: base64 }`
- Receives message_type: `session_started`, `partial_transcript`, `committed_transcript`, `committed_transcript_with_timestamps`
- `committed_transcript_with_timestamps` includes `words: WordTimestamp[]`
- Emits: `transcript:partial` and `transcript:final` (FinalTranscript: `{ text, startTime, endTime, words }`)

### SessionService (State Machine)
- States: `discovering` → `calibrating` → `active` → `ended`
- LocalState: `{ myUser, peer?, transcripts: { local: [], peer: [] }, speakerMapping, negotiations: Map, status }`
- `initConversation(UserConfig)` → discovering
- `setPeer(PeerIdentity)` → calibrating
- `setSpeakerMapping(mapping)` → active
- `addLocalTranscript(entry)` / `addPeerTranscript(entry)` append and emit `transcript:new`
- `getTranscriptText()` returns formatted conversation string

### AgentService (LLM Conversation Loop)
- Holds message history as `LLMMessage[]`
- `pushTranscript(entry)` batches transcripts with 2-second silence timer (setTimeout)
- When timer fires, flushes batch as a single user message: `[Transcript] Speaker: text`
- `pushNegotiationEvent(event)` adds as user message immediately
- `callClaudeLoop()`: calls provider.createMessage() → if stopReason === "tool_use", executes tool handlers, adds results, calls again recursively. Stops on "end_turn" or "max_tokens".
- Emits `agent:response` (text blocks) and `agent:tool_call` (tool name + input + result)
- `start(systemPrompt, tools)` stores tools and system prompt
- `stop()` sets running = false

### NegotiationService
- Holds `Map<NegotiationId, Negotiation>`
- `propose(agreement)`: creates Negotiation, sends via peer, starts 30s timeout
- `respond(id, accept: boolean)`: sends response via peer, updates status
- `counter(id, newAgreement)`: increments counterRound (max 3), sends via peer
- `reportExecution(id, step, status)`: tracks execution steps, sends update via peer
- Listens to peer `message` events for incoming proposals/responses/counters/execution_updates
- Emits: `proposal:received`, `confirmed`, `execution:update`
- Timeout handler sets status to "expired" after 30s

### PaymentService (Stripe)
- `executePayment(req)`: creates PaymentIntent with `transfer_data: { destination: recipientAccountId }`, auto-confirms
- `createEscrowHold(req)`: PaymentIntent with `capture_method: "manual"`, status remains `requires_capture`
- `captureEscrow(holdId)`: calls `paymentIntents.capture()`
- `releaseEscrow(holdId)`: calls `paymentIntents.cancel()`
- `createSubscription(agreement)`: creates Product → Price (recurring interval) → Customer → Subscription
- `cancelSubscription(subscriptionId)`: calls `subscriptions.cancel()`
- `requestRefund(paymentIntentId, reason?)`: checks existing refunds, creates refund
- `executeSplitPayment(req)`: `Promise.all()` of separate PaymentIntents per participant
- `savePaymentMethod(pmId)` stores default payment method

### SolanaService
- Connection to RPC URL + Keypair from secret
- `transferSOL(to, amount)`: SystemProgram.transfer, returns explorer URL
- `transferUSDC(to, amount)`: SPL token transfer, auto-creates ATA if missing
- `recordMemo(text)`: MemoProgram instruction, returns txSig + explorer URL
- `isConfigured()`: checks if keypair exists
- Explorer URLs: `https://explorer.solana.com/tx/${sig}?cluster=${network}`

### MonzoService
- OAuth bearer token via `setAccessToken()`
- `getBalance()`: GET /balance
- `getTransactions(days?)`: GET /transactions with `since` param
- `createFeedItem(title, body, url?)`: POST /feed
- `depositToPot(potId, amount)`: PUT /pots/{id}/deposit
- `withdrawFromPot(potId, amount)`: PUT /pots/{id}/withdraw
- `listPots()`: GET /pots
- `getOrCreateEscrowPot()`: finds or creates pot named "Handshake Escrow"

### TTSService (ElevenLabs)
- `speak(text)`: POST `/v1/text-to-speech/{voiceId}/stream`, returns audio Buffer
- `speakStream(text)`: same endpoint, returns ReadableStream for streaming playback
- Config: voiceId, model_id, voice_settings (stability, similarity_boost)

### MiroService
- `generateSummary(participants, transcripts, negotiations)`: creates frame with 4 sections:
  1. Conversation timeline (keyword-filtered sticky notes)
  2. Agreement cards (amount, parties, status)
  3. Key excerpts (up to 6 quotes)
  4. Execution proof checklist
- Uses Miro REST API v2: POST /boards/{boardId}/frames, /sticky_notes, /cards, /shapes
- Color coding: green headers, speaker-specific colors, light content backgrounds

### ChainRecorder
- `recordAgreement(negotiation)`: SHA-256 hash of JSON.stringify(agreement), stored as Solana memo
- `verifyRecord(txSignature, negotiation)`: fetches transaction, checks logs for matching hash
- Returns `{ txSignature, hash, explorerUrl, verified }`

### EscrowManager
- Unified interface over Stripe and Solana
- `createHold(agreement, rail)`: routes to Stripe manual capture or Solana memo-tagged transfer
- `capture(holdId)` / `release(holdId)`: operates on correct backend
- Tracks active escrows in local Maps

### NFTMinter (Metaplex)
- Uses `@metaplex-foundation/js` with `irysStorage()` (devnet)
- `mintForBothParties(negotiation, partyAPubkey, partyBPubkey)`:
  1. Uploads metadata with agreement attributes (amount, type, parties, date, hash)
  2. Mints NFT to party A
  3. Mints NFT to party B
  4. Returns `AgreementNFT[]` with mintAddress, metadataUri, explorerUrl

### EmotionAnalyzer
- Input: `WordTimestamp[]` (from ElevenLabs committed_transcript_with_timestamps)
- Calculates: WPM, avgPauseDuration, silenceRatio, avgConfidence
- Classification thresholds:
  - WPM > 180 + short pauses → "urgent"
  - WPM < 100 or long pauses (>0.8s) → "hesitant"
  - High confidence (>0.95) + moderate WPM → "confident"
  - Else → "neutral"
- Minimum 3 words required (else "neutral")

### InsightsEngine
- `getSpendingInsights(days?)`: groups Monzo transactions by category, calculates totals
- `getPeerHistory(peerId)`: filters transactions mentioning peer
- `checkAffordability(amount)`: balance - amount > £100 buffer → "comfortable"

---

## LLM Provider Layer (providers/)

### ILLMProvider Interface
```
createMessage(params: LLMCreateParams): Promise<LLMResponse>
```

### LLMCreateParams
```
{ model, maxTokens, system (string), messages: LLMMessage[], tools?: ToolDefinition[] }
```

### LLMMessage
```
{ role: "user" | "assistant", content: string | LLMContentBlock[] }
```

### LLMContentBlock (discriminated union)
```
{ type: "text", text } | { type: "tool_use", id, name, input } | { type: "tool_result", tool_use_id, content }
```

### LLMResponse
```
{ content: LLMContentBlock[], stopReason: "end_turn" | "tool_use" | "max_tokens", usage: { input, output } }
```

### AnthropicProvider
- Wraps `@anthropic-ai/sdk` (Anthropic class)
- Translates normalized types ↔ Anthropic SDK types
- Maps tool definitions to Anthropic's `input_schema` format

### OpenRouterProvider
- HTTP fetch to `https://openrouter.ai/api/v1/chat/completions`
- Translates to OpenAI-compatible format: `messages`, `tools` (function calling), `tool_choice: "auto"`
- Converts OpenAI `tool_calls` response back to normalized LLMContentBlock[]

### Factory
```
createLLMProvider(provider: "anthropic" | "openrouter", apiKey: string): ILLMProvider
```

---

## Agent Tools (tools.ts)

### buildTools() — 20+ tool definitions

Each tool is: `{ name, description, parameters: JSONSchema, handler: (input) => Promise<string> }`

**Core tools:**
| Tool | Purpose |
|------|---------|
| check_balance | Get Monzo balance |
| get_transactions | Recent Monzo transactions |
| send_proposal | Create negotiation proposal |
| respond_to_proposal | Accept/reject proposal |
| execute_payment | Stripe payment with transfer_data |
| speak | ElevenLabs TTS |
| create_feed_item | Monzo feed notification |

**Advanced tools:**
| Tool | Purpose |
|------|---------|
| deposit_to_pot | Monzo pot deposit |
| create_escrow_hold | Stripe manual capture hold |
| capture_escrow / release_escrow | Complete or cancel escrow |
| record_on_chain | SHA-256 → Solana memo |
| execute_solana_payment | SOL or USDC transfer |
| get_spending_insights | Category spending analysis |
| list_pots | Monzo pots |
| escrow_to_pot / release_pot_escrow | Pot-based escrow |
| create_subscription / cancel_subscription | Recurring Stripe payments |
| request_refund | Stripe refund |
| execute_split_payment | Multi-party split |
| mint_agreement_nft | Metaplex NFT for both parties |

### buildSystemPrompt() — Agent behavioral instructions

Key rules encoded in system prompt:
1. **Balance awareness**: Must call check_balance before any payment. Warn if >50% of balance. Reject if exceeds total.
2. **Escrow detection**: Conditional language ("when job is done", "after delivery") → create_escrow_hold instead of execute_payment
3. **Payment rail selection**: "crypto/SOL/USDC/on-chain" → execute_solana_payment. "card/Stripe/bank" → execute_payment. Ambiguous → ask via TTS.
4. **Subscription detection**: "monthly/every week/each month" → create_subscription
5. **Agreement detection triggers**: Words like "deal", "agreed", "let's do it", "sounds good" → send_proposal
6. **Emotion integration**: If hesitant tone detected, suggest lower amounts. Never mention emotion detection to users.
7. **NFT auto-resolution**: mint_agreement_nft resolves both parties' Solana pubkeys from negotiation credentials automatically.

---

## Web Mode Architecture

### Entry: web.ts
- Loads config, parses PORT env var, calls `startWebServer(config, port)`

### Server: server.ts
- HTTP server serves static files from `public/` directory
- MIME type map for .html, .css, .js, .json, .png, .ico, .svg
- Directory traversal prevention: `resolved.startsWith(PUBLIC_DIR)`
- Health endpoint: `GET /health` → `{ status, rooms, signalRooms }`
- WebSocketServer on same HTTP server
- Three WS paths:
  - `/ws/audio?room=X&user=Y&name=Z` → binary PCM frames
  - `/ws/panels?room=X&user=Y` → JSON panel messages
  - `/ws/signal?room=X&user=Y` → WebRTC signaling relay
- Input validation: `VALID_ID = /^[a-zA-Z0-9_-]{1,64}$/`
- Name sanitization: strip `<>"'&`, limit 100 chars

### RoomManager: room-manager.ts
- `Room { code, slots: Map<userId, UserSlot>, paired }`
- `UserSlot { userId, userName, audio, transcription, session, agent, peer?, negotiation?, panelCleanup?, transcriptCounter }`
- `MAX_USERS_PER_ROOM = 2`, `MAX_ROOMS = 50`
- `getOrCreateRoom()`: finds or creates room, respects MAX_ROOMS
- `getOrCreateSlot()`: creates per-user AudioService, TranscriptionService, SessionService, AgentService. Wires audio→transcription. Starts both. Peer and negotiation are deferred to pairing.
- `handleAudioConnection()`: receives WS, room, userId, userName. Binary messages → `slot.audio.feedRawAudio()`. On close → `cleanupSlot()`. If 2 users → `pairUsers()`.
- `handlePanelConnection()`: registers WS with PanelEmitter, sends room status.
- `pairUsers()`:
  1. Creates InProcessPeer pair via static factory
  2. Creates NegotiationService for each user
  3. Links peers via startDiscovery()
  4. Sets peer identity on each session
  5. Sets speaker mapping (each user = their own speaker)
  6. Wires transcription pipeline: finals go to BOTH users' panels (source as "local", other as "peer")
  7. Wires negotiation → agent events
  8. Wires panel emitter for each user
  9. Starts agents with full tool suite
  10. Notifies both users of pairing
- `cleanupSlot()`: stops all services, destroys peer, removes from room

### InProcessPeer: in-process-peer.ts
- Static `createPair()` links two instances via direct reference
- `send(msg)`: `process.nextTick(() => other.handleMessage({...msg}))` — async delivery with spread-copy for isolation
- `startDiscovery()`: immediately emits "connected" (since peer is already linked)
- Implements IPeerService interface

### PanelEmitter: panel-emitter.ts
- Holds `Map<userId, Set<WebSocket>>`
- `addConnection(userId, ws)`: adds to set, removes on close
- `sendToUser(userId, msg)`: JSON.stringify to all connections for that user
- `wireServices(userId, { agent, session, negotiation })`: subscribes to EventEmitter events, returns cleanup function
- Routes: agent:response → panel:"agent", agent:tool_call → panel:"agent", session transcript:new → panel:"transcript", negotiation events → panel:"execution"

### SignalingService: signaling.ts
- Room-based `Map<string, Map<string, WebSocket>>`
- Validates message types: "offer", "answer", "ice-candidate"
- Relays messages to other users in same room (not back to sender)

### Frontend: public/index.html
- Single-page vanilla HTML/CSS/JS (no framework)
- Pairing screen: name input + room code (auto-generated 6-char code avoiding confusing chars O/0/I/1)
- User ID: `sanitizedName-randomSuffix` (e.g., "alice-x7k2")
- Session screen: 3-panel layout (transcript / agent / execution)
- Audio capture: `getUserMedia({ audio: { sampleRate: 16000 } })` → AudioContext → ScriptProcessorNode (bufferSize 4096)
- Float32 [-1,1] → Int16 PCM conversion: `Math.max(-1, Math.min(1, sample)) * 0x7FFF`
- Binary PCM sent via audio WebSocket
- Panel WebSocket receives JSON, routes by `msg.panel`:
  - "transcript": color-codes by source (local=green, peer=blue), handles partials per speaker
  - "agent": shows text responses + tool calls with formatted JSON
  - "execution": chronicles negotiation lifecycle
  - "status": room status, pairing, errors
- Auto-scroll: checks if near bottom before scrolling (prevents jarring jumps)
- Dark theme, monospace fonts (SF Mono, Fira Code, Cascadia Code)
- Semantic colors: green=success, orange=pending, red=error, purple=AI tools
- Mobile responsive: stacks panels vertically

---

## CLI Mode Architecture

### Entry: index.ts
- `startSystem()`:
  1. Load config
  2. Create services: Audio, Transcription, Session, Agent, Peer, Negotiation, Payment, Monzo, TTS, Miro, Solana, ChainRecorder, Escrow, NFTMinter, Emotion, Insights
  3. Wire pipeline: audio→transcription, transcription→session+agent
  4. Start peer discovery (mDNS or direct connect)
  5. On peer connected: exchange identities, set peer on session
  6. Start diarisation calibration → speaker mapping → session active
  7. Start agent with tools and system prompt
  8. Graceful shutdown: stop all services, generate Miro summary if configured

### cli.ts
- parseArgs for commands: `start`, `logs`, `check`
- `start`: calls startSystem()
- `logs`: tail-follow log files with level/service filtering
- `check`: validates Node version, sox installed, Python available, .env keys present

### mic.ts
- Spawns SoX `rec` command: `rec -q -r 16000 -b 16 -c 1 -e signed-integer -t raw -`
- Pipes stdout to AudioService.feedRawAudio()

### peer.ts
- Bonjour/mDNS service discovery on local network
- Deterministic leader election: lower IP = server (creates WS server), higher IP = client (connects)
- Direct mode: `--peer <ip:port>` and `--role server|client`
- JSON message exchange over WebSocket

### logger.ts
- Channel routing: each service writes to its own log file
- Files in `/tmp/handshake-{PID}/`
- JSON entries with timestamp, level, channel, message
- Colored console output by level

---

## Data Flow (Web Mode)

```
Browser Mic → getUserMedia → AudioContext (16kHz)
  → ScriptProcessorNode → Float32→Int16 PCM
  → WebSocket /ws/audio (binary)
  → RoomManager.handleAudioConnection()
  → UserSlot.audio.feedRawAudio()
  → AudioService buffer → 250ms chunks (audio:chunk event)
  → TranscriptionService.feedAudio()
  → ElevenLabs WS (base64 audio)
  → transcript:partial → PanelEmitter → both users' panels
  → transcript:final → PanelEmitter → both users' panels
                      → SessionService (addLocal/addPeer)
                      → AgentService.pushTranscript() (2s batch)
                      → InProcessPeer.send() → other user's agent
  → AgentService.callClaudeLoop()
  → LLM response → agent:response → PanelEmitter → panel
  → Tool execution → agent:tool_call → PanelEmitter → panel
  → NegotiationService → proposal/response → peer relay → other agent
  → PaymentService / SolanaService → execution
  → PanelEmitter → execution panel
```

---

## Environment Variables

```env
# ElevenLabs (required)
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_VOICE_NAME=Rachel
ELEVENLABS_MODEL=eleven_monolingual_v1
ELEVENLABS_REGION=us
ELEVENLABS_LANGUAGE=en

# Stripe (required)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_ACCOUNT_ID=acct_...
STRIPE_PAYMENT_METHOD=pm_...  # optional saved PM

# LLM (required)
LLM_PROVIDER=anthropic  # or "openrouter"
LLM_API_KEY=
LLM_MODEL=claude-sonnet-4-20250514

# User Identity (required)
MY_USER_ID=
MY_USER_NAME=

# Monzo (optional)
MONZO_ACCESS_TOKEN=

# Miro (optional)
MIRO_ACCESS_TOKEN=
MIRO_BOARD_ID=

# Solana (optional)
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_KEYPAIR_SECRET=  # JSON array of bytes
SOLANA_NETWORK=devnet
SOLANA_USDC_MINT=
SOLANA_MY_PUBKEY=

# Feature Flags
ENABLE_SOLANA=false
ENABLE_EMOTION_DETECTION=true
ENABLE_NFT_MINTING=false

# Server
PORT=3000
```

---

## Deployment (Railway)

```toml
[build]
buildCommand = "npm ci"

[deploy]
startCommand = "npx tsx src/web.ts"
healthcheckPath = "/health"
```

No TypeScript compile step — tsx handles TS at runtime.
