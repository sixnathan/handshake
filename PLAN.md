# Implementation Plan: Wave 2 — Types, Interfaces, Config, and LLM Providers

## Overview

Wave 2 establishes the foundational type system, service interface contracts, environment configuration loader, and LLM provider abstraction layer. It produces 8 source files across 2 logical groups. Every subsequent wave depends on these files compiling cleanly.

## Files to Create (8 total)

| # | File | Lines | Description | Depends On |
|---|------|-------|-------------|------------|
| 1 | `src/types.ts` | ~180 | All domain types (UserId, Negotiation, AppConfig, etc.) | None |
| 2 | `src/providers/types.ts` | ~45 | Normalized LLM types (LLMMessage, LLMResponse, etc.) | None |
| 3 | `src/interfaces.ts` | ~160 | 18 service interfaces + helper types | types.ts |
| 4 | `src/providers/provider.ts` | ~6 | `ILLMProvider` interface | providers/types.ts |
| 5 | `src/config.ts` | ~65 | `loadConfig()` with required/optional/flag helpers | types.ts |
| 6 | `src/providers/anthropic.ts` | ~70 | Wraps `@anthropic-ai/sdk`, filters ThinkingBlock | providers/provider.ts, providers/types.ts |
| 7 | `src/providers/openrouter.ts` | ~150 | HTTP fetch to OpenAI-compatible API with format translation | providers/provider.ts, providers/types.ts |
| 8 | `src/providers/index.ts` | ~20 | Factory `createLLMProvider()` + barrel re-exports | All provider files |

**Total: ~696 lines across 8 files**

## Dependency Graph

```
src/types.ts (no deps)              src/providers/types.ts (no deps)
  │                                   │
  ├── src/interfaces.ts               ├── src/providers/provider.ts
  │                                   │
  └── src/config.ts                   ├── src/providers/anthropic.ts
                                      ├── src/providers/openrouter.ts
                                      └── src/providers/index.ts
```

## Parallelization

Two independent sub-trees with zero cross-imports:

```
Agent 1 (domain):                 Agent 2 (providers):
  1. src/types.ts                   1. src/providers/types.ts
  2. src/interfaces.ts              2. src/providers/provider.ts
  3. src/config.ts                  3. src/providers/anthropic.ts
                                    4. src/providers/openrouter.ts
                                    5. src/providers/index.ts
```

## Key Implementation Details

### src/types.ts
- 13 sections: Core IDs, User/Peer, Audio, Transcript, Agreement/Negotiation (11-state machine), PeerMessage (9-variant union), Payment, Subscription, Monzo, Solana, Emotion, AppConfig, LocalState
- `LocalState.negotiations` is `Map<NegotiationId, Negotiation>`, not a plain object
- All types exported as `export type` or `export interface`

### src/interfaces.ts
- 18 interfaces total (15 service interfaces + ToolDefinition, FinalTranscript, PartialTranscript)
- Services with events extend `EventEmitter` from `eventemitter3` (not Node built-in)
- `ITTSService.speakStream()` returns `Promise<ReadableStream>` — globally available in `@types/node` v22

### src/providers/anthropic.ts
- **Must filter ThinkingBlock/RedactedThinkingBlock** from response content (SDK returns them in `ContentBlock` union)
- `ToolUseBlock.input` is typed as `unknown` — needs `as Record<string, unknown>` assertion
- Stop reason mapping: `stop_sequence` and `null` → `"end_turn"`

### src/providers/openrouter.ts
- Full OpenAI-compatible format translation (messages, tools, tool_calls)
- `JSON.parse(tc.function.arguments)` wrapped in try/catch with `{}` fallback
- Finish reason mapping: `stop` → `"end_turn"`, `tool_calls` → `"tool_use"`, `length` → `"max_tokens"`

### src/config.ts
- `dotenv.config()` called at module level (idempotent, intentional per spec)
- Helper functions: `required()` throws on missing, `optional()` with fallback, `flag()` for booleans
- Required vars: ELEVENLABS_API_KEY, STRIPE_SECRET_KEY, STRIPE_ACCOUNT_ID, LLM_API_KEY, MY_USER_ID, MY_USER_NAME

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Anthropic SDK ContentBlock includes ThinkingBlock | Medium | Filter by `block.type === "text" \|\| block.type === "tool_use"` |
| Anthropic SDK message type assertions | Low | `as MessageParam[]` — runtime shapes are compatible |
| OpenRouter malformed tool arguments | Low | try/catch around JSON.parse, default to `{}` |
| dotenv.config() side effect | Low | Intentional per spec, idempotent |

## Verification

```bash
npx tsc --noEmit  # Must exit 0 with zero errors
```

## Success Criteria

- [ ] All 8 files created
- [ ] `npx tsc --noEmit` passes
- [ ] All imports use `.js` extensions
- [ ] No default exports
- [ ] No circular dependencies
- [ ] Every file under 200 lines
- [ ] Wave 3 can begin immediately after
