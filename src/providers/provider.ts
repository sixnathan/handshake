import type { LLMCreateParams, LLMResponse } from "./types.js";

export interface ILLMProvider {
  createMessage(params: LLMCreateParams): Promise<LLMResponse>;
}
