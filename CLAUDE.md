# Handshake

AI-powered verbal agreement system. Two people talk, each with their own AI agent that listens. When a financial agreement is detected, the agents negotiate terms autonomously, generate a legal document, and execute payment — all through voice.

## Hackathon Context

**Event:** HackEurope 2026
**Format:** 2-minute live in-person demo
**Team:** Solo developer (Nat) + multiple Claude Code instances in parallel
**Track:** FinTech (Monzo) — "Build a project that makes money simpler, fairer or more accessible"
**Track Prize:** €1,000

### Challenges Entered

| Challenge | Prize | Core Requirement |
|-----------|-------|------------------|
| Best Stripe Integration | €3,000 + Dublin Office Visit | Meaningful Stripe integration — reimagine financial tools that simplify day-to-day life |
| Best Use of ElevenLabs | AirPod Pros | Use ElevenLabs API to generate or stream voice content as an integral part of the project |
| Best Use of Claude | $10k / $3k / $1k Claude Credits | Leverage Claude's API for reasoning, analysis, or automation — Claude does the powerlifting |

### How Handshake Maps to Each Challenge

**Stripe:** Stripe Connect powers all payments. Platform transfers between users, escrow via manual-capture PaymentIntents, partial captures for line items. The agent negotiates and executes payments autonomously — agentic commerce.

**ElevenLabs:** ElevenLabs Scribe v2 provides real-time speech-to-text with word-level timestamps. The transcription pipeline feeds both the trigger detector and the agent's conversation context. Voice is the primary interface.

**Claude:** Claude (via OpenRouter) is the reasoning engine. Each user gets their own agent that: interprets conversation context, detects financial agreements, generates structured proposals with line items, negotiates counter-offers, drafts legal documents, and orchestrates payment execution. Claude's tool use drives the entire workflow.

**Monzo (Track):** Read-only Monzo integration for balance checks and transaction history. Agents can check affordability before agreeing to terms.

### Demo Flow (2 minutes)

Two people open the app in their browsers, join the same room, and start talking. They discuss a real scenario (e.g., plumber fixing a boiler). When one says the trigger word, both agents activate — they analyze the conversation, generate a structured proposal with line items, negotiate back and forth, produce a legal document for both parties to sign, and execute payment via Stripe. All in real-time, all from voice.

### Judging Criteria to Optimize For

1. **Stripe:** Depth of integration, real payment flows, agentic commerce patterns
2. **ElevenLabs:** Audio is integral (not bolted on), real-time streaming, quality of voice pipeline
3. **Claude:** Complex reasoning, tool use, agentic workflow — Claude is doing heavy lifting
4. **FinTech Track:** Makes money simpler/fairer/more accessible, practical utility

### Out of Scope

- Solana/blockchain — removed from codebase, no deps
- Smart detection insights panel (future feature)
- TTS voice output (future feature)

### Secondary Features (implemented but not in demo flow)

- **Milestone verification** — services exist (`verification.ts`, `phone-verification.ts`, `verification-tools.ts`), wired into RoomManager, frontend has `VerificationModal.tsx`. Config is optional (`ELEVENLABS_PHONE_NUMBER_ID`). Not part of the 2-minute demo.
- **Monzo balance checks** — read-only, agent can call `check_balance`/`check_transactions` tools. Requires `MONZO_ACCESS_TOKEN`.

## Tech Stack

- **Backend:** TypeScript 5.7 strict, Node.js 22, tsx runtime (no build step for backend)
- **Frontend:** React 19, Vite 6, Tailwind CSS 4, Zustand 5 (in `frontend/`)
- **STT:** ElevenLabs Scribe v2 (real-time via WebSocket)
- **LLM:** Claude via OpenRouter (agent reasoning + tool use)
- **Payments:** Stripe Connect (platform transfers, escrow, manual-capture PaymentIntents)
- **Banking:** Monzo API (read-only balance/transactions, optional)
- **Deploy:** Railway (single service, backend serves frontend static build)

## Architecture

### How It All Connects

```
Browser A                         SERVER                          Browser B
─────────                         ──────                          ─────────
React app                    Node.js (tsx)                        React app
 │                                │                                │
 ├─/ws/audio (binary PCM)───────►├── AudioService A               │
 │                                │    └► TranscriptionService A   │
 │                                │        (ElevenLabs Scribe)     │
 │                                │        └► TriggerDetector A    │
 │                                │        └► AgentService A ◄─┐   │
 │                                │              │ InProcessPeer│   │
 │                                │              └─────────────►│   │
 │                                │        ┌► AgentService B ◄──┘   │
 │                                │        │   (Claude + 11 tools)  │
 │                                │    └► TranscriptionService B    │
 │                                ├── AudioService B ◄──────────────┤
 │                                │                    /ws/audio    │
 │                                │                                │
 │◄──panel messages (JSON)────────├── PanelEmitter ────────────────►│
 │   /ws/panels                   │    ↑ events from:              │
 │                                │    ├─ NegotiationService       │
 │                                │    ├─ DocumentService          │
 │                                │    ├─ PaymentService           │
 │                                │    └─ VerificationService      │
 │                                │                                │
 ├─sign_document─────────────────►├── RoomManager (orchestrator)   │
 ├─verify_milestone──────────────►│                                │
 ├─set_profile───────────────────►│                                │
 └─join_room─────────────────────►│                                │
```

### Server Entry Point

`src/web.ts` → loads config → calls `startWebServer()` in `src/server.ts`

The server handles:
- **HTTP:** Static file serving from `frontend/dist/` (SPA fallback to `index.html`)
- **GET /health:** Health check for Railway
- **WS /ws/audio?room=X&user=Y:** Binary PCM audio stream (per user)
- **WS /ws/panels?room=X&user=Y:** Bidirectional JSON messages (control + updates)

### Backend Services (src/services/)

| Service | File | Purpose |
|---------|------|---------|
| **RoomManager** | `room-manager.ts` | Orchestrator — creates/destroys rooms, wires all per-room services, handles all client messages |
| **AudioService** | `audio.ts` | Buffers raw PCM, emits 250ms chunks |
| **AudioRelayService** | `audio-relay.ts` | Relays audio binary between users in a room |
| **TranscriptionService** | `transcription.ts` | WebSocket to ElevenLabs Scribe v2, emits partial/final text |
| **TriggerDetector** | `trigger-detector.ts` | Keyword match + LLM smart detection (every 10s) |
| **SessionService** | `session.ts` | Session status state machine, transcript log |
| **AgentService** | `agent.ts` | Autonomous Claude agent loop — 2s debounce, max 20 recursions, message trimming |
| **InProcessPeer** | `in-process-peer.ts` | In-memory message broker between two agents (no network hop) |
| **NegotiationService** | `negotiation.ts` | Proposal/counter/accept state machine — max 5 rounds, 30s/round timeout |
| **DocumentService** | `document.ts` | LLM generates legal markdown document from agreed terms |
| **PaymentService** | `payment.ts` | Stripe Connect — immediate payments, escrow holds (manual capture), partial capture |
| **MonzoService** | `monzo.ts` | Read-only Monzo API — balance, transactions |
| **PanelEmitter** | `panel-emitter.ts` | WebSocket broadcaster — unicast to user or broadcast to room |
| **ProfileManager** | `profile-manager.ts` | Per-user agent profiles with validation |
| **VerificationService** | `verification.ts` | LLM-driven milestone verification (secondary feature) |
| **PhoneVerificationService** | `phone-verification.ts` | ElevenLabs phone call verification (secondary feature) |

### Agent Tools (src/tools.ts)

11 tools available to each agent via `buildTools()`:

| Tool | What It Does |
|------|-------------|
| `analyze_and_propose` | Create initial proposal with line items |
| `evaluate_proposal` | Accept, counter, or reject incoming proposal |
| `execute_payment` | Immediate Stripe payment |
| `create_escrow_hold` | Hold funds via manual-capture PaymentIntent |
| `capture_escrow` | Release held escrow (supports partial capture) |
| `release_escrow` | Return held funds to payer |
| `check_balance` | Query user's Monzo balance |
| `check_transactions` | Query user's recent Monzo transactions |
| `send_message_to_user` | Display agent message in UI |
| `generate_document` | Create legal document after agreement |
| `complete_milestone` | Mark milestone ready for verification |

### Provider Layer (src/providers/)

LLM abstraction with two implementations:
- `AnthropicProvider` — direct Anthropic SDK (`@anthropic-ai/sdk`)
- `OpenRouterProvider` — OpenAI-compatible format via OpenRouter
- Factory: `createLLMProvider(provider, apiKey)` returns either

### Frontend (frontend/src/)

React 19 SPA with three screens:

**SetupScreen** → `SessionScreen` → `ContractsScreen`

| Screen | Components | Purpose |
|--------|-----------|---------|
| Setup | `JoinForm`, `SettingsSheet` | Name + room code, profile settings (localStorage) |
| Session | `TopBar`, `PulseRing`, `ExpandedView`, `BottomSheet`, `DocumentOverlay` | Live call UI — transcript, timeline, document signing |
| Contracts | `VerificationModal` | View saved contracts, verify milestones |

**Zustand Stores** (5 stores, no circular deps):

| Store | Purpose | Written By |
|-------|---------|-----------|
| `sessionStore` | Screen routing, user/room IDs, peer status, session status text | `use-websocket.ts`, `JoinForm` |
| `transcriptStore` | Final transcript entries + in-progress partials | `use-websocket.ts` (transcript messages) |
| `timelineStore` | Agent event log (detect, propose, counter, accept, sign, pay) | `use-websocket.ts` (all message types) |
| `documentStore` | Current legal document, milestones, bottom sheet/overlay visibility | `use-websocket.ts` (document + milestone messages) |
| `verificationStore` | Verification modal state, steps, result | `use-websocket.ts` (verification messages) |

**Hooks:**

| Hook | Purpose |
|------|---------|
| `usePanelWebSocket()` | Connects to `/ws/panels`, routes all panel messages to stores |
| `useAudioWebSocket()` | Connects to `/ws/audio`, captures mic → PCM 16kHz → server, plays peer audio |
| `useCallTimer()` | MM:SS timer while peer connected |
| `useProfile()` | localStorage read/write for profile + contracts |

### WebSocket Protocol

**No HTTP API** — everything runs over two WebSocket connections per user.

**Client → Server (ClientMessage):**
- `set_profile` — agent profile (display name, role, preferences, Stripe ID)
- `join_room` — join room by code
- `sign_document` — sign a legal document
- `complete_milestone` — mark milestone ready for verification
- `verify_milestone` — start LLM verification of a milestone
- `set_trigger_keyword` — change trigger word

**Server → Client (PanelMessage):**
- `transcript` — speech text (partial or final)
- `agent` — agent reasoning/tool results
- `negotiation` — proposal/counter/accept status + amounts
- `document` — generated legal document (markdown)
- `milestone` — milestone status update
- `verification` — verification progress steps + result
- `execution` — signing/payment execution steps
- `payment_receipt` — payment confirmation
- `status` — room user list (triggers peer detection)
- `error` — error message

## Development

```bash
# Install
npm ci && cd frontend && npm ci && cd ..

# Dev (backend + frontend in separate terminals)
npm run dev              # Backend: tsx watch src/web.ts (port 3000)
npm run dev:frontend     # Frontend: vite dev server (port 5173, proxies /ws to :3000)

# Build frontend
npm run build:frontend   # Compiles to frontend/dist/

# Type check
npm run typecheck        # Backend: tsc --noEmit

# Test
npm test                 # vitest run
npm run test:watch       # vitest (watch mode)
npm run test:coverage    # vitest with v8 coverage
```

## Deployment (Railway)

Single Railway service. Build installs both root + frontend deps, builds React app, then runs backend via tsx.

```
Build:  npm ci && cd frontend && npm ci && npm run build
Start:  npx tsx src/web.ts
Health: GET /health → {"status":"ok"}
```

Backend serves `frontend/dist/` as static files with SPA fallback. No separate frontend deployment.

## Environment Variables

See `.env.example`. Required: `ELEVENLABS_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PLATFORM_ACCOUNT_ID`, `LLM_API_KEY`. Everything else has defaults or is optional.

## Key Files

| File | Purpose |
|------|---------|
| `src/web.ts` | Entry point — loads config, starts server |
| `src/server.ts` | HTTP + WebSocket server, static file serving |
| `src/config.ts` | Type-safe environment config loader |
| `src/types.ts` | All domain types (branded IDs, proposals, documents, payments) |
| `src/interfaces.ts` | All service contracts (EventEmitter-based) |
| `src/tools.ts` | 11 agent tool definitions + execution handlers |
| `src/verification-tools.ts` | 6 verification tool definitions (secondary feature) |
| `src/providers/` | LLM provider abstraction (Anthropic + OpenRouter) |
| `src/services/room-manager.ts` | **The orchestrator** — wires all services per room |
| `src/services/agent.ts` | Autonomous Claude agent loop |
| `src/services/negotiation.ts` | Proposal state machine (max 5 rounds) |
| `src/services/payment.ts` | Stripe Connect integration |
| `src/services/transcription.ts` | ElevenLabs Scribe v2 WebSocket client |
| `frontend/src/hooks/use-websocket.ts` | Panel WebSocket — routes all messages to Zustand stores |
| `frontend/src/hooks/use-audio.ts` | Audio WebSocket — mic capture + peer playback |
| `frontend/src/stores/` | 5 Zustand stores (session, transcript, timeline, document, verification) |
