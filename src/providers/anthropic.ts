import Anthropic from "@anthropic-ai/sdk";
import type { ILLMProvider } from "./provider.js";
import type { LLMCreateParams, LLMResponse, LLMContentBlock } from "./types.js";

const STOP_REASON_MAP: Record<string, LLMResponse["stopReason"]> = {
  end_turn: "end_turn",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  stop_sequence: "end_turn",
};

export class AnthropicProvider implements ILLMProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 60_000 });
  }

  async createMessage(params: LLMCreateParams): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: params.messages as Anthropic.Messages.MessageParam[],
      tools: params.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: {
          type: "object" as const,
          ...t.input_schema,
        },
      })),
    });

    const content: LLMContentBlock[] = response.content
      .filter(
        (
          block,
        ): block is Anthropic.TextBlock | Anthropic.Messages.ToolUseBlock =>
          block.type === "text" || block.type === "tool_use",
      )
      .map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      });

    const stopReason =
      STOP_REASON_MAP[response.stop_reason ?? "end_turn"] ?? "end_turn";

    const usage = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    };

    return { content, stopReason, usage };
  }
}
