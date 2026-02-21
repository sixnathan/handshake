# Prompt 02 — Config Loader and LLM Providers

**Phase:** 1 (foundation)
**Depends on:** 00-scaffold, 01-types-and-interfaces
**Blocks:** Phase 2+ prompts that need config or LLM

## Task

Create the config loader and the LLM provider abstraction layer (4 files in providers/, 1 config file).

---

## File 1: src/config.ts

Loads environment variables via dotenv and maps them to the `AppConfig` type.

```ts
import dotenv from "dotenv";
import type { AppConfig } from "./types.js";

dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback?: string): string | undefined {
  return process.env[key] ?? fallback;
}

function flag(key: string, fallback = false): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  return val === "true" || val === "1";
}

export function loadConfig(): AppConfig {
  return {
    elevenlabs: {
      apiKey: required("ELEVENLABS_API_KEY"),
      region: optional("ELEVENLABS_REGION", "us"),
      language: optional("ELEVENLABS_LANGUAGE", "en"),
      voiceId: optional("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")!,
      voiceName: optional("ELEVENLABS_VOICE_NAME", "Rachel")!,
      model: optional("ELEVENLABS_MODEL", "eleven_monolingual_v1")!,
    },
    stripe: {
      secretKey: required("STRIPE_SECRET_KEY"),
      accountId: required("STRIPE_ACCOUNT_ID"),
    },
    monzo: {
      accessToken: optional("MONZO_ACCESS_TOKEN"),
    },
    llm: {
      provider: (optional("LLM_PROVIDER", "anthropic") as "anthropic" | "openrouter"),
      apiKey: required("LLM_API_KEY"),
      model: optional("LLM_MODEL", "claude-sonnet-4-20250514")!,
    },
    miro: {
      accessToken: optional("MIRO_ACCESS_TOKEN"),
      boardId: optional("MIRO_BOARD_ID"),
    },
    solana: {
      rpcUrl: optional("SOLANA_RPC_URL", "https://api.devnet.solana.com")!,
      keypairSecret: optional("SOLANA_KEYPAIR_SECRET"),
      network: optional("SOLANA_NETWORK", "devnet")!,
      usdcMint: optional("SOLANA_USDC_MINT"),
      myPubkey: optional("SOLANA_MY_PUBKEY"),
    },
    user: {
      id: required("MY_USER_ID"),
      name: required("MY_USER_NAME"),
    },
    features: {
      solana: flag("ENABLE_SOLANA"),
      emotionDetection: flag("ENABLE_EMOTION_DETECTION", true),
      nftMinting: flag("ENABLE_NFT_MINTING"),
    },
  };
}
```

---

## File 2: src/providers/types.ts

Normalized LLM types that abstract over Anthropic and OpenRouter.

```ts
export interface LLMTextBlock {
  type: "text";
  text: string;
}

export interface LLMToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type LLMContentBlock = LLMTextBlock | LLMToolUseBlock | LLMToolResultBlock;

export interface LLMMessage {
  role: "user" | "assistant";
  content: string | LLMContentBlock[];
}

export interface LLMResponse {
  content: LLMContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: { input: number; output: number };
}

export interface LLMCreateParams {
  model: string;
  maxTokens: number;
  system: string;
  messages: LLMMessage[];
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}
```

---

## File 3: src/providers/provider.ts

```ts
import type { LLMCreateParams, LLMResponse } from "./types.js";

export interface ILLMProvider {
  createMessage(params: LLMCreateParams): Promise<LLMResponse>;
}
```

---

## File 4: src/providers/anthropic.ts

Wraps the `@anthropic-ai/sdk` package.

Key implementation details:
- Constructor takes `apiKey` string
- Creates `new Anthropic({ apiKey })` client
- `createMessage()` calls `this.client.messages.create()` with:
  - `model`, `max_tokens`, `system`, `messages`, `tools` (mapped to Anthropic format)
- Maps Anthropic response content blocks back to normalized `LLMContentBlock[]`
- Maps Anthropic's `stop_reason` to normalized `stopReason` (Anthropic uses snake_case: "end_turn", "tool_use", "max_tokens")
- Tool definitions: Anthropic uses `input_schema` (same as our normalized format)
- Content blocks: Anthropic returns `{ type: "text", text }` and `{ type: "tool_use", id, name, input }` — same shape as our types
- Tool results sent as `{ type: "tool_result", tool_use_id, content }` — same shape

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { ILLMProvider } from "./provider.js";
import type { LLMCreateParams, LLMResponse, LLMContentBlock } from "./types.js";
```

The mapping is nearly 1:1 since our normalized types are modeled after Anthropic's format.

---

## File 5: src/providers/openrouter.ts

HTTP client for OpenRouter's OpenAI-compatible API.

Key implementation details:
- Constructor takes `apiKey` string
- Base URL: `https://openrouter.ai/api/v1/chat/completions`
- `createMessage()` translates to OpenAI format:
  - `system` → first message with `role: "system"`
  - `messages` → map each message:
    - If content is string → `{ role, content }`
    - If content is array of blocks:
      - `tool_result` blocks → `{ role: "tool", tool_call_id, content }`
      - `text` blocks → `{ role, content: text }`
      - `tool_use` blocks in assistant messages → `{ role: "assistant", tool_calls: [...] }`
  - `tools` → mapped to OpenAI format: `{ type: "function", function: { name, description, parameters } }`
    where `parameters` comes from `input_schema`
  - `tool_choice: "auto"` when tools are present
- Response translation:
  - `choices[0].message.content` → `LLMTextBlock`
  - `choices[0].message.tool_calls` → `LLMToolUseBlock[]` (map `function.name`, `function.arguments` (JSON.parse), `id`)
  - `choices[0].finish_reason`: "stop" → "end_turn", "tool_calls" → "tool_use", "length" → "max_tokens"
  - `usage.prompt_tokens` → `input`, `usage.completion_tokens` → `output`
- Uses `fetch()` with `Authorization: Bearer ${apiKey}` header
- Sets `HTTP-Referer` and `X-Title` headers for OpenRouter identification

```ts
import type { ILLMProvider } from "./provider.js";
import type { LLMCreateParams, LLMResponse, LLMContentBlock, LLMMessage } from "./types.js";
```

---

## File 6: src/providers/index.ts

Factory function:

```ts
import type { ILLMProvider } from "./provider.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenRouterProvider } from "./openrouter.js";

export function createLLMProvider(
  provider: "anthropic" | "openrouter",
  apiKey: string,
): ILLMProvider {
  switch (provider) {
    case "anthropic":
      return new AnthropicProvider(apiKey);
    case "openrouter":
      return new OpenRouterProvider(apiKey);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

export type { ILLMProvider } from "./provider.js";
export * from "./types.js";
```

---

## Verification

- `npx tsc --noEmit src/config.ts src/providers/*.ts` — no errors
- Config loader throws on missing required vars
- Both providers implement ILLMProvider
- Factory returns correct provider based on string
