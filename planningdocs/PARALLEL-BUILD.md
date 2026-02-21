# Parallel Build Guide

## How to Use

Each spec below is a self-contained file in `planningdocs/specs/`. Give ONE spec to ONE Claude instance. Each spec contains:
- Exact file path to create
- All imports (verbatim)
- Full constructor/method signatures
- Event names and payloads
- Error handling patterns
- Types used (with references to `src/types.ts` and `src/interfaces.ts`)

## Parallelization Map

### Tier 1 — Fully Independent (no cross-service deps)
These can ALL run simultaneously. Each creates ONE file with ZERO imports from other `services/` files.

| Spec | File to Create | Est. Lines |
|------|---------------|-----------|
| `W3A-audio.md` | `src/services/audio.ts` | ~60 |
| `W3B-transcription.md` | `src/services/transcription.ts` | ~120 |
| `W3C-audio-relay.md` | `src/services/audio-relay.ts` | ~50 |
| `W3D-trigger-detector.md` | `src/services/trigger-detector.ts` | ~180 |
| `W3E-session.md` | `src/services/session.ts` | ~80 |
| `W3F-monzo.md` | `src/services/monzo.ts` | ~80 |
| `W3G-profile-manager.md` | `src/services/profile-manager.ts` | ~60 |
| `W3H-in-process-peer.md` | `src/services/in-process-peer.ts` | ~60 |
| `W3I-panel-emitter.md` | `src/services/panel-emitter.ts` | ~70 |
| `W4D-payment.md` | `src/services/payment.ts` | ~100 |

### Tier 2 — Depends on LLM providers only
Needs `src/providers/` (already built) but no other services.

| Spec | File to Create | Depends On |
|------|---------------|-----------|
| `W4A-agent.md` | `src/services/agent.ts` | providers/ |
| `W4C-document.md` | `src/services/document.ts` | providers/ |

### Tier 3 — Depends on Tier 1+2 services
Needs other services to exist (imports types from them).

| Spec | File to Create | Depends On |
|------|---------------|-----------|
| `W4B-negotiation.md` | `src/services/negotiation.ts` | in-process-peer |

### Tier 4 — Orchestration (depends on everything)
Must run LAST. Imports all services.

| Spec | File to Create | Depends On |
|------|---------------|-----------|
| `W6A-tools.md` | `src/tools.ts` | all services |
| `W6B-room-manager.md` | `src/services/room-manager.ts` | all services |
| `W6C-server.md` | `src/server.ts` + `src/web.ts` | room-manager |
| `W7-frontend.md` | `public/index.html` | server (for WS protocol) |

## Shared Conventions

All services must follow:
1. `import { EventEmitter } from "eventemitter3"` (named import, NOT default)
2. All imports from project use `.js` extension (Node16 module resolution)
3. TypeScript strict mode — no `any`, no `!` assertions
4. Immutable patterns — return new objects, don't mutate inputs
5. Methods < 50 lines, files < 400 lines
6. All errors caught and handled, never silently swallowed

## Verification

After ALL specs are implemented:
```bash
npx tsc --noEmit        # zero errors
npm run start:web       # server starts
curl localhost:3000/health  # { "status": "ok" }
```
