# Handshake

AI-powered verbal agreement system. Two people talk, each with their own AI agent that listens. When a financial agreement is detected, the agents negotiate terms autonomously, generate a legal document, and execute payment — all through voice.

## How It Works

1. Two users open the app and join the same room
2. They talk naturally (e.g., a plumber discussing a boiler repair)
3. Both say the trigger word — their AI agents activate
4. Agents analyze the conversation, generate a structured proposal with line items
5. Agents negotiate back and forth (up to 5 rounds)
6. A legal document is generated for both parties to sign
7. Payment executes via Stripe

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | TypeScript, Node.js 22, tsx |
| Frontend | React 19, Vite, Tailwind CSS 4, Zustand |
| Speech-to-Text | ElevenLabs Scribe v2 (real-time WebSocket) |
| AI/Reasoning | Claude via OpenRouter (tool use + agentic loop) |
| Payments | Stripe Connect (transfers, escrow, partial capture) |
| Deploy | Railway (single service) |

## Architecture

```
Browser A                         Server                          Browser B
─────────                         ──────                          ─────────
  /ws/audio ──► AudioService ──► TranscriptionService ──► ElevenLabs Scribe
                     │                    │
                     ▼                    ▼
               AudioRelay          TriggerDetector
                                         │
                                         ▼
                                   AgentService A ◄──► AgentService B
                                   (Claude + tools)    (Claude + tools)
                                         │
                              ┌──────────┼──────────┐
                              ▼          ▼          ▼
                        Negotiation  Document   Payment
                                                (Stripe)
  /ws/panels ◄──────── PanelEmitter ────────────────────► /ws/panels
```

Each user gets two WebSocket connections: one for binary PCM audio, one for JSON control messages. The server runs one ElevenLabs transcription session and one Claude agent per user.

## Quick Start

```bash
# Install
npm ci && cd frontend && npm ci && cd ..

# Dev (two terminals)
npm run dev              # Backend on :3000
npm run dev:frontend     # Frontend on :5173 (proxies to :3000)

# Build
npm run build:frontend

# Type check
npm run typecheck
```

## Environment Variables

Copy `.env.example` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs Scribe v2 API key |
| `LLM_API_KEY` | Yes | OpenRouter or Anthropic API key |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key |
| `STRIPE_PLATFORM_ACCOUNT_ID` | Yes | Stripe Connect platform account |
| `LLM_PROVIDER` | No | `openrouter` (default) or `anthropic` |
| `LLM_MODEL` | No | Default: `anthropic/claude-sonnet-4` |
| `STRIPE_CUSTOMER_ID` | No | Demo customer with saved card |
| `MONZO_ACCESS_TOKEN` | No | Read-only Monzo balance/transactions |

## Deploy (Railway)

Single service. Backend serves the frontend static build.

```
Build:  npm ci && cd frontend && npm ci && npm run build
Start:  npx tsx src/web.ts
Health: GET /health
```

## License

Built for HackEurope 2026.
