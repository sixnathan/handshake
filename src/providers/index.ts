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
