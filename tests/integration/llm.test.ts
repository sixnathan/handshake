import { describe, it, expect, beforeAll } from "vitest";
import { createLLMProvider } from "../../src/providers/index.js";
import { loadConfig } from "../../src/config.js";
import type { ILLMProvider } from "../../src/providers/provider.js";
import type { AppConfig } from "../../src/types.js";

describe("LLM Provider Integration (real API)", () => {
  let provider: ILLMProvider;
  let config: AppConfig;

  beforeAll(() => {
    config = loadConfig();
    provider = createLLMProvider(config.llm.provider, config.llm.apiKey);
  });

  it("should get a text response from the LLM", async () => {
    const response = await provider.createMessage({
      model: config.llm.model,
      maxTokens: 50,
      system: "Reply with exactly: HANDSHAKE_TEST_OK",
      messages: [{ role: "user", content: "Test" }],
    });

    expect(response.content.length).toBeGreaterThan(0);
    const textBlock = response.content.find((b) => b.type === "text");
    expect(textBlock).toBeDefined();
    expect(response.stopReason).toBe("end_turn");
    // OpenRouter may not return token usage for all providers
    expect(response.usage).toBeDefined();
  }, 30000);

  it("should handle tool use responses", async () => {
    const response = await provider.createMessage({
      model: config.llm.model,
      maxTokens: 200,
      system: "You must use the provided tool to answer.",
      messages: [{ role: "user", content: "What is 2+2?" }],
      tools: [
        {
          name: "calculator",
          description: "Performs arithmetic",
          input_schema: {
            type: "object",
            properties: {
              expression: { type: "string" },
            },
            required: ["expression"],
          },
        },
      ],
    });

    // Should either use the tool or respond with text
    expect(response.content.length).toBeGreaterThan(0);
    expect(["end_turn", "tool_use"]).toContain(response.stopReason);

    if (response.stopReason === "tool_use") {
      const toolBlock = response.content.find((b) => b.type === "tool_use");
      expect(toolBlock).toBeDefined();
      if (toolBlock && toolBlock.type === "tool_use") {
        expect(toolBlock.name).toBe("calculator");
        expect(toolBlock.id).toBeTruthy();
      }
    }
  }, 30000);

  it("should parse trigger detection JSON from LLM", async () => {
    const SMART_DETECTION_PROMPT = `You are a financial agreement detector. Analyze the conversation and determine if a financial agreement is being made. Respond with ONLY a JSON object:
{"triggered": true/false, "confidence": 0.0-1.0, "terms": [{"term": "phrase", "confidence": 0.0-1.0, "context": "sentence"}]}`;

    const response = await provider.createMessage({
      model: config.llm.model,
      maxTokens: 300,
      system: SMART_DETECTION_PROMPT,
      messages: [
        {
          role: "user",
          content:
            "alice: I need my boiler fixed\nbob: I can do that for £500\nalice: Sounds good, deal!",
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    expect(textBlock).toBeDefined();

    if (textBlock && textBlock.type === "text") {
      // Should be parseable JSON
      const parsed = JSON.parse(textBlock.text);
      expect(typeof parsed.triggered).toBe("boolean");
      expect(typeof parsed.confidence).toBe("number");
      expect(Array.isArray(parsed.terms)).toBe(true);

      // Given such obvious financial language, should trigger
      expect(parsed.triggered).toBe(true);
      expect(parsed.confidence).toBeGreaterThan(0.5);
    }
  }, 30000);
});
