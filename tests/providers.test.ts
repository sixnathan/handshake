import { describe, it, expect } from "vitest";
import { createLLMProvider } from "../src/providers/index.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { OpenRouterProvider } from "../src/providers/openrouter.js";

describe("Provider Factory Module", () => {
  it("should create AnthropicProvider for 'anthropic' type", () => {
    const provider = createLLMProvider("anthropic", "test-key");
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("should create OpenRouterProvider for 'openrouter' type", () => {
    const provider = createLLMProvider("openrouter", "test-key");
    expect(provider).toBeInstanceOf(OpenRouterProvider);
  });

  it("should throw for unknown provider type", () => {
    expect(() => createLLMProvider("unknown" as any, "key")).toThrow();
  });
});
