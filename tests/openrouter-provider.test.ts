import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenRouterProvider } from "../src/providers/openrouter.js";

describe("OpenRouterProvider Module", () => {
  let provider: OpenRouterProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new OpenRouterProvider("test-api-key");
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should send correct headers", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });

    await provider.createMessage({
      model: "test-model",
      maxTokens: 100,
      system: "Be helpful",
      messages: [{ role: "user", content: "Hi" }],
    });

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(options.headers["Authorization"]).toBe("Bearer test-api-key");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.method).toBe("POST");
  });

  it("should translate messages to OpenAI format", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });

    await provider.createMessage({
      model: "test-model",
      maxTokens: 100,
      system: "System prompt",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
      ],
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.model).toBe("test-model");
    expect(body.max_tokens).toBe(100);
    // System prompt should be first message
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe("System prompt");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toBe("Hello");
  });

  it("should parse text response correctly", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: "Hello world" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });

    const response = await provider.createMessage({
      model: "m",
      maxTokens: 100,
      system: "s",
      messages: [{ role: "user", content: "test" }],
    });

    expect(response.content).toEqual([{ type: "text", text: "Hello world" }]);
    expect(response.stopReason).toBe("end_turn");
  });

  it("should parse tool_calls response", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "send_message",
                    arguments: '{"text":"hello"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });

    const response = await provider.createMessage({
      model: "m",
      maxTokens: 100,
      system: "s",
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          name: "send_message",
          description: "d",
          input_schema: { type: "object", properties: {} },
        },
      ],
    });

    expect(response.stopReason).toBe("tool_use");
    const toolBlock = response.content.find((b) => b.type === "tool_use");
    expect(toolBlock).toBeDefined();
    if (toolBlock && toolBlock.type === "tool_use") {
      expect(toolBlock.name).toBe("send_message");
      expect(toolBlock.id).toBe("call_1");
      expect(toolBlock.input).toEqual({ text: "hello" });
    }
  });

  it("should handle malformed tool arguments JSON", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "test", arguments: "not valid json" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
    });

    const response = await provider.createMessage({
      model: "m",
      maxTokens: 100,
      system: "s",
      messages: [{ role: "user", content: "test" }],
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    expect(toolBlock).toBeDefined();
    if (toolBlock && toolBlock.type === "tool_use") {
      expect(toolBlock.input).toEqual({}); // fallback
    }
  });

  it("should throw on HTTP error", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(
      provider.createMessage({
        model: "m",
        maxTokens: 100,
        system: "s",
        messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toThrow("OpenRouter API error (401)");
  });

  it("should map finish_reason 'length' to 'max_tokens'", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: "truncated" }, finish_reason: "length" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 100 },
      }),
    });

    const response = await provider.createMessage({
      model: "m",
      maxTokens: 100,
      system: "s",
      messages: [{ role: "user", content: "test" }],
    });

    expect(response.stopReason).toBe("max_tokens");
  });

  it("should include tools in request body when provided", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
    });

    await provider.createMessage({
      model: "m",
      maxTokens: 100,
      system: "s",
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          name: "calc",
          description: "Calculator",
          input_schema: {
            type: "object",
            properties: { expr: { type: "string" } },
          },
        },
      ],
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe("calc");
  });

  it("should handle tool_result messages in translation", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
    });

    await provider.createMessage({
      model: "m",
      maxTokens: 100,
      system: "s",
      messages: [
        { role: "user", content: "do calc" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_1",
              name: "calc",
              input: { expr: "2+2" },
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "4" },
          ],
        },
      ],
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    // Should translate tool_result to tool role message
    const toolMsg = body.messages.find((m: any) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe("call_1");
    expect(toolMsg.content).toBe("4");
  });
});
