# Build Order — Dependency Graph & Execution Plan

## Dependency Graph

```
Phase 0 ─── 00-scaffold
              │
Phase 1 ─── 01-types-and-interfaces ─┬─ 02-config-and-providers
              │                       │
Phase 2 ─────┼─── 03-audio-and-transcription  ──┐
              │                                   │
              ├─── 04-session-service  ───────────┤
              │                                   │
              ├─── 05-negotiation-service  ───────┤
              │                                   │
              ├─── 06-payment-service  ───────────┤
              │                                   │
              ├─── 07-solana-and-blockchain  ─────┤
              │                                   │
              ├─── 08-monzo-and-analytics  ───────┤
              │                                   │
              ├─── 09-tts-and-miro  ──────────────┤
              │                                   │
              └─── 10-communication-layer  ───────┤
                                                  │
Phase 3 ─── 11-agent-service  ────────────────────┤
              │                                   │
              └─── 12-tools  ─────────────────────┤
                                                  │
Phase 4 ─── 13-web-orchestrator  ─────────────────┤
              │                                   │
              ├─── 14-cli-orchestrator  ───────────┘
              │
Phase 5 ─── 15-frontend
```

## Execution Plan

### Wave 1 (sequential — must go first)

| # | Prompt | Est. Files | Notes |
|---|--------|-----------|-------|
| 1 | 00-scaffold | 6 | package.json, tsconfig, .env.example, railway.toml, .gitignore, dirs |

### Wave 2 (sequential — foundation types)

| # | Prompt | Est. Files | Notes |
|---|--------|-----------|-------|
| 2 | 01-types-and-interfaces | 2 | types.ts, interfaces.ts |
| 3 | 02-config-and-providers | 6 | config.ts + 5 provider files |

**Wave 2 must complete before Wave 3 can start.**

### Wave 3 (PARALLEL — 8 independent prompts)

All of these can run simultaneously on separate Claude Code instances:

| # | Prompt | Est. Files | Notes |
|---|--------|-----------|-------|
| 4a | 03-audio-and-transcription | 2 | audio.ts, transcription.ts |
| 4b | 04-session-service | 1 | session.ts |
| 4c | 05-negotiation-service | 1 | negotiation.ts |
| 4d | 06-payment-service | 1 | payment.ts |
| 4e | 07-solana-and-blockchain | 4 | solana.ts, chain-recorder.ts, escrow.ts, nft-minter.ts |
| 4f | 08-monzo-and-analytics | 3 | monzo.ts, insights.ts, emotion.ts |
| 4g | 09-tts-and-miro | 2 | tts.ts, miro.ts |
| 4h | 10-communication-layer | 4 | peer.ts, in-process-peer.ts, signaling.ts, panel-emitter.ts |

**Maximum parallelism: 8 instances running at once.**

### Wave 4 (sequential — agent depends on all services)

| # | Prompt | Est. Files | Notes |
|---|--------|-----------|-------|
| 5 | 11-agent-service | 1 | agent.ts |
| 6 | 12-tools | 1 | tools.ts (largest file, ~1200 lines) |

### Wave 5 (PARALLEL — two orchestrators are independent)

| # | Prompt | Est. Files | Notes |
|---|--------|-----------|-------|
| 7a | 13-web-orchestrator | 3 | web.ts, server.ts, room-manager.ts |
| 7b | 14-cli-orchestrator | 4 | index.ts, cli.ts, mic.ts, logger.ts |

### Wave 6 (sequential — needs server routes)

| # | Prompt | Est. Files | Notes |
|---|--------|-----------|-------|
| 8 | 15-frontend | 1 | public/index.html |

---

## Total: 16 prompts → 36 files

## Optimal timeline with parallelism:

```
Time →   ████ Wave 1 (00)
         ████████ Wave 2 (01, 02)
         ████████████████ Wave 3 (03-10, ALL PARALLEL)
         ████████ Wave 4 (11, 12)
         ████████ Wave 5 (13 ∥ 14)
         ████ Wave 6 (15)
```

6 sequential waves, but Wave 3 alone gives 8x parallelism.

---

## Post-Build Verification

After all prompts complete:

1. **Type check:** `npx tsc --noEmit` — should have zero errors
2. **Start web mode:** `npm run start:web` — server should listen on port 3000
3. **Health check:** `curl http://localhost:3000/health` — returns `{ "status": "ok" }`
4. **Frontend loads:** Open `http://localhost:3000/` in browser — pairing screen appears
5. **Two-user test:** Open two browser tabs, join same room, both should pair

---

## Important Notes for Each Instance

1. **File extensions:** Always use `.js` in import paths (e.g., `import { Foo } from "./foo.js"`). TypeScript + Node16 module resolution requires `.js` extensions even for `.ts` files.

2. **EventEmitter:** Import from `eventemitter3`, not Node's built-in events.

3. **No default exports:** Use named exports everywhere.

4. **Strict mode:** TypeScript strict is on — handle all possible `undefined`/`null` values.

5. **Working directory:** All prompts assume the working directory is the project root (`handshake/`).

6. **Don't install packages:** Wave 1 (00-scaffold) already runs `npm install`. Subsequent prompts just create source files.
