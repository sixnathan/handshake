import { describe, it, expect, vi, beforeEach } from "vitest";
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

// Mock the @anthropic-ai/sdk module
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
    constructor() {}
  },
}));

describe("AnthropicProvider", () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider("test-api-key");
    mockCreate.mockReset();
  });

  it("should parse text response correctly", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello from Claude" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const response = await provider.createMessage({
      model: "claude-3-opus",
      maxTokens: 1024,
      system: "Be helpful",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.content).toEqual([
      { type: "text", text: "Hello from Claude" },
    ]);
    expect(response.stopReason).toBe("end_turn");
    expect(response.usage).toEqual({ input: 10, output: 5 });
  });

  it("should parse tool_use response correctly", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_123",
          name: "get_weather",
          input: { city: "London" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 15 },
    });

    const response = await provider.createMessage({
      model: "claude-3-opus",
      maxTokens: 1024,
      system: "Be helpful",
      messages: [{ role: "user", content: "What is the weather?" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather for a city",
          input_schema: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    });

    expect(response.stopReason).toBe("tool_use");
    const toolBlock = response.content.find((b) => b.type === "tool_use");
    expect(toolBlock).toBeDefined();
    if (toolBlock && toolBlock.type === "tool_use") {
      expect(toolBlock.id).toBe("toolu_123");
      expect(toolBlock.name).toBe("get_weather");
      expect(toolBlock.input).toEqual({ city: "London" });
    }
  });

  it("should propagate errors from the SDK", async () => {
    mockCreate.mockRejectedValue(new Error("Authentication failed"));

    await expect(
      provider.createMessage({
        model: "claude-3-opus",
        maxTokens: 1024,
        system: "Be helpful",
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toThrow("Authentication failed");
  });

  it("should return multiple content blocks (mixed text + tool_use)", async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: "text", text: "Let me check that for you." },
        {
          type: "tool_use",
          id: "toolu_456",
          name: "search",
          input: { query: "handshake protocol" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 30, output_tokens: 25 },
    });

    const response = await provider.createMessage({
      model: "claude-3-opus",
      maxTokens: 1024,
      system: "Be helpful",
      messages: [{ role: "user", content: "Search for handshake protocol" }],
      tools: [
        {
          name: "search",
          description: "Search the web",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
    });

    expect(response.content).toHaveLength(2);
    expect(response.content[0]).toEqual({
      type: "text",
      text: "Let me check that for you.",
    });
    expect(response.content[1]).toEqual({
      type: "tool_use",
      id: "toolu_456",
      name: "search",
      input: { query: "handshake protocol" },
    });
    expect(response.stopReason).toBe("tool_use");
  });
});
