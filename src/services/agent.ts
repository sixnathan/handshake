import { EventEmitter } from "eventemitter3";
import type { ILLMProvider } from "../providers/provider.js";
import type {
  LLMMessage,
  LLMToolUseBlock,
  LLMToolResultBlock,
} from "../providers/types.js";
import type {
  TranscriptEntry,
  AgentProfile,
  AgentMessage,
  TriggerEvent,
} from "../types.js";
import type { IAgentService, ToolDefinition } from "../interfaces.js";

function buildAgentSystemPrompt(profile: AgentProfile): string {
  const maxApprove = (profile.preferences.maxAutoApproveAmount / 100).toFixed(
    2,
  );
  const escrowThresh = (profile.preferences.escrowThreshold / 100).toFixed(2);

  return `You are an autonomous AI negotiation agent acting on behalf of ${profile.displayName}.

SITUATION:
You are listening to a live voice conversation between ${profile.displayName} and another person.
The conversation is being transcribed in real-time and fed to you as it happens.
Transcript lines are labeled: [local] = your user speaking, [peer] = the other person.

YOUR ROLE:
You represent ${profile.displayName}'s financial interests. When a deal, agreement, or
financial commitment emerges from the conversation, you:
1. Analyze what's being discussed
2. Propose structured terms (amounts, line items, conditions)
3. Negotiate with the other person's agent (they have their own AI agent)
4. Execute payment via Stripe when both sides agree

YOUR USER'S PREFERENCES:
- Display name: ${profile.displayName}
- Role: ${profile.role}
- Max auto-approve: £${maxApprove}
- Preferred currency: ${profile.preferences.preferredCurrency}
- Escrow preference: ${profile.preferences.escrowPreference}
- Escrow threshold: £${escrowThresh}
- Negotiation style: ${profile.preferences.negotiationStyle}
${profile.customInstructions ? `\nCUSTOM INSTRUCTIONS FROM YOUR USER:\n${profile.customInstructions}\n` : ""}
NEGOTIATION RULES:
- NEVER auto-approve amounts above £${maxApprove}
- Use escrow for amounts above £${escrowThresh} (when escrowPreference is "above_threshold")
- If escrowPreference is "always", always use escrow regardless of amount
- If escrowPreference is "never", never use escrow
- Style guide:
  - aggressive: counter with 20-30% lower amounts, push for better terms
  - balanced: counter with 10-15% adjustments, seek fair middle ground
  - conservative: accept reasonable proposals quickly, avoid prolonged negotiation

COMMUNICATION:
- Use send_message_to_user to keep ${profile.displayName} informed about:
  - What you detected in the conversation
  - What you're proposing and why
  - Incoming proposals and your assessment
  - Final outcomes
- Be concise but informative
- Explain your reasoning

IMPORTANT:
- You are negotiating with ANOTHER AI AGENT, not a human
- The other agent represents the other person's interests
- Both agents must agree for a deal to proceed
- You receive proposals via [INCOMING PROPOSAL] messages
- You respond using the evaluate_proposal tool`;
}

export class AgentService extends EventEmitter implements IAgentService {
  private messages: LLMMessage[] = [];
  private systemPrompt = "";
  private tools: ToolDefinition[] = [];
  private running = false;
  private transcriptBatch: TranscriptEntry[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private recursionDepth = 0;
  private readonly MAX_RECURSION_DEPTH = 20;

  constructor(
    private readonly config: {
      provider: ILLMProvider;
      model: string;
      maxTokens: number;
    },
  ) {
    super();
  }

  async start(profile: AgentProfile): Promise<void> {
    this.systemPrompt = buildAgentSystemPrompt(profile);
    this.running = true;
  }

  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
  }

  stop(): void {
    this.running = false;
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.messages = [];
  }

  pushTranscript(entry: TranscriptEntry): void {
    if (!this.running) return;
    this.transcriptBatch.push(entry);
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
    }
    this.batchTimer = setTimeout(() => this.flushTranscriptBatch(), 2000);
  }

  async startNegotiation(
    trigger: TriggerEvent,
    conversationContext: string,
  ): Promise<void> {
    if (!this.running) return;

    const content = `[NEGOTIATION TRIGGERED]
Trigger type: ${trigger.type}
Matched: ${trigger.matchedText}
Confidence: ${trigger.confidence}

Analyze the conversation below and use the analyze_and_propose tool to extract agreement terms and build a structured proposal.

=== Conversation ===
${conversationContext}`;

    this.messages.push({ role: "user", content });
    await this.callLLMLoop();
  }

  async receiveAgentMessage(message: AgentMessage): Promise<void> {
    if (!this.running) return;

    let content: string;

    switch (message.type) {
      case "agent_proposal":
        content = `[INCOMING PROPOSAL from ${message.fromAgent}]
${JSON.stringify(message.proposal, null, 2)}

Use the evaluate_proposal tool to assess this proposal against your preferences and decide to accept, counter, or reject.`;
        break;

      case "agent_counter":
        content = `[COUNTER-PROPOSAL from ${message.fromAgent}]
Reason: ${message.reason}
${JSON.stringify(message.proposal, null, 2)}

Use the evaluate_proposal tool to assess this counter-proposal.`;
        break;

      case "agent_accept":
        content = `[PROPOSAL ACCEPTED by ${message.fromAgent}]
The other party's agent has accepted your proposal. Inform your user.`;
        break;

      case "agent_reject":
        content = `[PROPOSAL REJECTED by ${message.fromAgent}]
Reason: ${message.reason}
Inform your user that the negotiation was not successful.`;
        break;
    }

    this.messages.push({ role: "user", content });
    await this.callLLMLoop();
  }

  private async flushTranscriptBatch(): Promise<void> {
    if (this.transcriptBatch.length === 0) return;

    const batch = [...this.transcriptBatch];
    this.transcriptBatch = [];
    this.batchTimer = null;

    const content = batch
      .map((e) => `[${e.source}] ${e.speaker}: ${e.text}`)
      .join("\n");
    this.messages.push({ role: "user", content });
    await this.callLLMLoop();
  }

  private async callLLMLoop(): Promise<void> {
    if (this.processing || !this.running) return;
    this.processing = true;
    this.recursionDepth = 0;
    try {
      await this.runLLMStep();
    } finally {
      this.processing = false;
    }
  }

  private trimMessages(): void {
    const MAX_MESSAGES = 60;
    const KEEP_TAIL = 40;
    if (this.messages.length > MAX_MESSAGES) {
      // Keep first 2 messages (system context) and last KEEP_TAIL messages
      const head = this.messages.slice(0, 2);
      const tail = this.messages.slice(-KEEP_TAIL);
      this.messages = [...head, ...tail];
      console.log(
        `[agent] Trimmed messages from ${MAX_MESSAGES}+ to ${this.messages.length}`,
      );
    }
  }

  private async runLLMStep(): Promise<void> {
    try {
      if (this.recursionDepth >= this.MAX_RECURSION_DEPTH) {
        console.error("[agent] Max recursion depth reached, stopping loop");
        this.emit("agent:message", {
          text: "Error: Agent processing limit reached.",
          timestamp: Date.now(),
        });
        return;
      }
      this.recursionDepth++;

      this.trimMessages();

      const messageCountBefore = this.messages.length;

      const llmTools = this.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));

      const response = await this.config.provider.createMessage({
        model: this.config.model,
        maxTokens: this.config.maxTokens,
        system: this.systemPrompt,
        messages: this.messages,
        tools: llmTools.length > 0 ? llmTools : undefined,
      });

      this.messages.push({ role: "assistant", content: response.content });

      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          this.emit("agent:message", {
            text: block.text,
            timestamp: Date.now(),
          });
        }
      }

      if (response.stopReason === "tool_use") {
        const toolUseBlocks = response.content.filter(
          (b): b is LLMToolUseBlock => b.type === "tool_use",
        );

        const toolResults: LLMToolResultBlock[] = [];

        for (const toolUse of toolUseBlocks) {
          const tool = this.tools.find((t) => t.name === toolUse.name);
          let result: string;

          if (tool) {
            try {
              result = await tool.handler(toolUse.input);
            } catch (err) {
              result = `Error: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else {
            result = `Error: Unknown tool "${toolUse.name}"`;
          }

          this.emit("agent:tool_call", {
            name: toolUse.name,
            input: toolUse.input,
            result,
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        }

        this.messages.push({ role: "user", content: toolResults });
        await this.runLLMStep();
        return;
      }

      // Check if new messages arrived during processing
      if (this.messages.length > messageCountBefore + 1) {
        await this.runLLMStep();
        return;
      }
    } catch (err) {
      console.error("[agent] LLM call failed:", err);
    }
  }
}
