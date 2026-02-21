import type { ILLMProvider } from "./provider.js";
import type {
  LLMCreateParams,
  LLMResponse,
  LLMContentBlock,
  LLMMessage,
} from "./types.js";

// ── Internal OpenAI-compatible types ────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ── Constants ───────────────────────────────

const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

const FINISH_REASON_MAP: Record<string, LLMResponse["stopReason"]> = {
  stop: "end_turn",
  tool_calls: "tool_use",
  length: "max_tokens",
};

// ── Provider ────────────────────────────────

export class OpenRouterProvider implements ILLMProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createMessage(params: LLMCreateParams): Promise<LLMResponse> {
    const messages = this.translateMessages(params.system, params.messages);

    const tools: OpenAITool[] | undefined = params.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const body = {
      model: params.model,
      max_tokens: params.maxTokens,
      messages,
      ...(tools && { tools, tool_choice: "auto" }),
    };

    const httpResponse = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/handshake",
        "X-Title": "Handshake",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!httpResponse.ok) {
      const errorText = await httpResponse.text();
      throw new Error(
        `OpenRouter API error (${httpResponse.status}): ${errorText}`,
      );
    }

    const data = (await httpResponse.json()) as OpenAIResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error("OpenRouter returned empty choices array");
    }

    const choice = data.choices[0];
    const content: LLMContentBlock[] = [];

    if (choice.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // Malformed JSON from LLM — default to empty object
        }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    const stopReason = FINISH_REASON_MAP[choice.finish_reason] ?? "end_turn";

    const usage = {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
    };

    return { content, stopReason, usage };
  }

  private translateMessages(
    system: string,
    messages: LLMMessage[],
  ): OpenAIMessage[] {
    const result: OpenAIMessage[] = [{ role: "system", content: system }];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (msg.role === "assistant") {
        const textParts: string[] = [];
        const toolCalls: OpenAIToolCall[] = [];

        for (const block of msg.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          }
        }

        const assistantMsg: OpenAIMessage = {
          role: "assistant",
          content: textParts.length > 0 ? textParts.join("\n") : null,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        };
        result.push(assistantMsg);
      } else {
        for (const block of msg.content) {
          if (block.type === "tool_result") {
            result.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: block.content,
            });
          } else if (block.type === "text") {
            result.push({ role: "user", content: block.text });
          }
        }
      }
    }

    return result;
  }
}
