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

## Tech Stack

- TypeScript 5.7 strict, Node.js 22, tsx runtime (no build step)
- ElevenLabs Scribe v2 (real-time STT via WebSocket)
- Claude via OpenRouter (agent reasoning + tool use)
- Stripe Connect (platform transfers, escrow, payments)
- Monzo API (read-only balance/transactions)
- WebSocket-based web frontend (vanilla HTML/CSS/JS)

## Architecture

Web-only mode. Two users join a room via browser. Each gets:
- Mic capture → PCM audio → WebSocket → server
- Per-user AudioService → TranscriptionService (ElevenLabs)
- Per-user TriggerDetector (keyword + smart detection)
- Per-user AgentService (Claude) with negotiation tools
- InProcessPeer for agent-to-agent communication
- NegotiationService for proposal/counter/accept protocol
- DocumentService for legal document generation
- PaymentService for Stripe execution

## Key Files

- `src/types.ts` — All domain types
- `src/interfaces.ts` — Service interface contracts
- `src/config.ts` — Environment config loader
- `src/providers/` — LLM provider abstraction (Anthropic, OpenRouter)
