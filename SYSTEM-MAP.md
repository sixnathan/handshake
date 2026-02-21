# Handshake — System Map

## File Tree

```
src/
├── web.ts                          # Entrypoint — loads config, starts server
├── config.ts                       # AppConfig from .env (required/optional/oneOf/flag helpers)
├── types.ts                        # All domain types (316 lines)
├── interfaces.ts                   # All service contracts (219 lines)
├── server.ts                       # HTTP + WebSocket server
├── tools.ts                        # 9 Claude tools the agents can call
├── providers/
│   ├── provider.ts                 # ILLMProvider interface
│   ├── types.ts                    # LLM message/response types
│   ├── index.ts                    # createLLMProvider factory
│   ├── anthropic.ts                # Anthropic SDK provider
│   └── openrouter.ts               # OpenRouter (OpenAI-compat) provider
└── services/
    ├── room-manager.ts             # Central orchestrator — rooms, wiring, lifecycle (694 lines)
    ├── agent.ts                    # Per-user Claude agent (LLM loop + tool execution)
    ├── trigger-detector.ts         # Keyword + smart (LLM) trigger detection
    ├── transcription.ts            # ElevenLabs Scribe v2 WebSocket client
    ├── audio.ts                    # PCM buffer → chunked AudioChunk emitter
    ├── audio-relay.ts              # Relay binary audio between users in a room
    ├── session.ts                  # Per-user transcript store + session status
    ├── negotiation.ts              # Proposal/counter/accept/reject state machine
    ├── document.ts                 # LLM-generated legal document + signatures
    ├── payment.ts                  # Stripe PaymentIntents + escrow (manual capture)
    ├── monzo.ts                    # Monzo API client (balance, transactions)
    ├── in-process-peer.ts          # Agent-to-agent message channel (in-memory)
    ├── panel-emitter.ts            # WebSocket broadcaster (server → browser panels)
    └── profile-manager.ts          # User profile store + validation

public/
└── index.html                      # Single-file frontend (HTML + CSS + JS, 1392 lines)

tests/                              # Vitest unit tests (one per service + integration/)
```

## Data Flow

```
Browser A                          Server                           Browser B
─────────                          ──────                           ─────────
getUserMedia → PCM ──ws/audio──→  AudioService A                    AudioService B ←──ws/audio── PCM ← getUserMedia
                                  │ emit("chunk")                   │ emit("chunk")
                                  ↓                                 ↓
                                  TranscriptionService A            TranscriptionService B
                                  │ (ElevenLabs WS)                 │ (ElevenLabs WS)
                                  │ emit("final")                   │ emit("final")
                                  ↓                                 ↓
                                  SessionService A                  SessionService B
                                  │ (stores transcripts)            │ (stores transcripts)
                                  ↓                                 ↓
                                  TriggerDetector A                 TriggerDetector B
                                  │ keyword match OR smart LLM      │ keyword match OR smart LLM
                                  │ emit("triggered")               │ emit("triggered")
                                  ↓                                 ↓
                                  AgentService A ←──InProcessPeer──→ AgentService B
                                  │ (Claude LLM loop)               │ (Claude LLM loop)
                                  │ calls tools:                    │ calls tools:
                                  │  analyze_and_propose             │  evaluate_proposal
                                  │  execute_payment                 │  check_balance
                                  │  create_escrow_hold              │  send_message_to_user
                                  ↓                                 ↓
                                  NegotiationService (shared per room)
                                  │ state: proposed → countering → accepted
                                  ↓
                                  DocumentService (LLM-generated legal doc)
                                  │ both users sign
                                  ↓
                                  PaymentService (Stripe)
                                  │ immediate payments + escrow holds
                                  ↓
                                  PanelEmitter ──ws/panels──→ Both browsers
                                  (JSON messages: transcript, agent, negotiation, document, execution, status)
```

## WebSocket Endpoints

| Path | Protocol | Direction | Purpose |
|------|----------|-----------|---------|
| `/ws/audio?room=X&user=Y` | Binary (PCM Int16) | Browser → Server → Browser | Mic audio capture + relay to peer |
| `/ws/panels?room=X&user=Y` | JSON | Bidirectional | Panel updates (server→client) + client commands (client→server) |

## Client → Server Messages (via panels WS)

| type | Purpose |
|------|---------|
| `set_profile` | Set user's AgentProfile (name, role, preferences, Stripe ID) |
| `join_room` | Join a room by ID |
| `sign_document` | Sign a legal document by ID |
| `set_trigger_keyword` | Change the trigger keyword |

## Server → Client Messages (via panels WS)

| panel | Purpose |
|-------|---------|
| `transcript` | Real-time transcript entries (partial + final) |
| `agent` | Agent thinking/tool calls/messages |
| `negotiation` | Negotiation state changes |
| `document` | Generated legal document |
| `execution` | Payment execution steps |
| `status` | Room status (users, session state) |
| `error` | Error messages |

## Agent Tools (9 total)

| # | Tool | Purpose |
|---|------|---------|
| 1 | `analyze_and_propose` | Parse conversation → structured proposal with line items |
| 2 | `evaluate_proposal` | Accept / counter / reject an incoming proposal |
| 3 | `execute_payment` | Immediate Stripe payment |
| 4 | `create_escrow_hold` | Authorize funds without capturing |
| 5 | `capture_escrow` | Capture held funds (supports partial) |
| 6 | `release_escrow` | Cancel escrow hold |
| 7 | `check_balance` | Read Monzo balance |
| 8 | `check_transactions` | Read recent Monzo transactions |
| 9 | `send_message_to_user` | Display message in user's agent panel |

## Room Lifecycle

1. User A opens app → enters name + room code → `join_room` → RoomManager creates Room
2. User B opens app → same room code → `join_room` → Room now has 2 slots
3. `pairUsers()` fires:
   - Creates InProcessPeer pair (A↔B)
   - Creates NegotiationService + DocumentService for the room
   - Wires peer message routing (A's send → B's receive and vice versa)
   - Builds tools for each agent (with correct userId/otherUserId/recipientAccountId)
   - Starts both agents (loads system prompt with user's preferences)
   - Wires agent events to PanelEmitter
4. Audio flows: browser mic → ws/audio → AudioService → TranscriptionService → SessionService + TriggerDetector + AgentService
5. Trigger fires (keyword or smart) → AgentService.startNegotiation() → LLM analyzes conversation → calls `analyze_and_propose`
6. Proposal sent via InProcessPeer → other agent receives → calls `evaluate_proposal` → accept/counter/reject
7. On acceptance → NegotiationService emits `negotiation:agreed` → DocumentService generates legal doc → broadcast to browsers
8. Users sign via bottom sheet → DocumentService tracks signatures → on fully_signed → PaymentService executes payments
9. Payments complete → session status = "completed"

## External Services

| Service | Usage | Auth |
|---------|-------|------|
| ElevenLabs Scribe v2 | Real-time speech-to-text | `xi-api-key` header on WebSocket |
| Claude (via OpenRouter or Anthropic) | Agent reasoning + tool use + document generation + smart detection | Bearer token / API key |
| Stripe Connect | Platform transfers, escrow via manual-capture PaymentIntents | `STRIPE_SECRET_KEY` |
| Monzo | Read-only balance + transactions (optional) | Bearer token |
