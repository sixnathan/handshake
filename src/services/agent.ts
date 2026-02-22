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

function buildProfessionalContext(profile: AgentProfile): string {
  const lines: string[] = [];
  if (profile.trade) lines.push(`- Trade: ${profile.trade}`);
  if (profile.experienceYears !== undefined)
    lines.push(`- Experience: ${profile.experienceYears} years`);
  if (profile.certifications && profile.certifications.length > 0) {
    lines.push(`- Certifications: ${profile.certifications.join(", ")}`);
  }
  if (profile.typicalRateRange) {
    const r = profile.typicalRateRange;
    lines.push(
      `- Typical rate: £${(r.min / 100).toFixed(2)}–£${(r.max / 100).toFixed(2)} per ${r.unit}`,
    );
  }
  if (profile.serviceArea) lines.push(`- Service area: ${profile.serviceArea}`);
  if (profile.contextDocuments && profile.contextDocuments.length > 0) {
    lines.push(
      `- Uploaded documents:\n${profile.contextDocuments.map((d, i) => `  [Doc ${i + 1}]: ${d.slice(0, 500)}`).join("\n")}`,
    );
  }
  if (lines.length === 0) return "";
  return `PROFESSIONAL CONTEXT:\n${lines.join("\n")}\n\n`;
}

function isProviderRole(role: string): boolean {
  const providerKeywords = [
    "provider",
    "plumber",
    "contractor",
    "electrician",
    "builder",
    "mechanic",
    "tradesperson",
    "freelancer",
    "consultant",
    "developer",
    "designer",
    "painter",
    "cleaner",
    "gardener",
    "roofer",
    "locksmith",
  ];
  const roleLower = role.toLowerCase();
  return providerKeywords.some((kw) => roleLower.includes(kw));
}

function buildRoleInstructions(profile: AgentProfile): string {
  if (isProviderRole(profile.role)) {
    return `YOUR TRIGGER ROLE: PROVIDER (proposer)
When the negotiation is triggered, you are the proposer. Analyze the conversation and use
\`analyze_and_propose\` to create a structured proposal with line items, pricing, and milestones.
You propose; the other party's agent evaluates.`;
  }
  return `YOUR TRIGGER ROLE: CLIENT (evaluator)
You will receive proposals from the other party's agent. Evaluate them using
\`evaluate_proposal\` against your preferences. Accept, counter, or reject as appropriate.`;
}

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

${buildRoleInstructions(profile)}

YOUR USER'S PREFERENCES:
- Display name: ${profile.displayName}
- Role: ${profile.role}
- Max auto-approve: £${maxApprove}
- Preferred currency: ${profile.preferences.preferredCurrency}
- Escrow preference: ${profile.preferences.escrowPreference}
- Escrow threshold: £${escrowThresh}
- Negotiation style: ${profile.preferences.negotiationStyle}
${profile.customInstructions ? `\nCUSTOM INSTRUCTIONS FROM YOUR USER:\n${profile.customInstructions}\n` : ""}
${buildProfessionalContext(profile)}NEGOTIATION RULES:
- NEVER auto-approve amounts above £${maxApprove}
- Use escrow for amounts above £${escrowThresh} (when escrowPreference is "above_threshold")
- If escrowPreference is "always", always use escrow regardless of amount
- If escrowPreference is "never", never use escrow
- Style guide:
  - aggressive: counter with 20-30% lower amounts, push for better terms
  - balanced: counter with 10-15% adjustments, seek fair middle ground
  - conservative: accept reasonable proposals quickly, avoid prolonged negotiation

COMMUNICATION:
- Only use send_message_to_user when you have actionable information:
  - Proposals you're making and why
  - Incoming proposals and your assessment
  - Decisions (accept/counter/reject) with reasoning
  - Final outcomes and payment confirmations
  - Errors or issues requiring user attention
- Do NOT narrate the conversation or confirm every utterance
- Do NOT send "I'm listening" or "I heard you say..." messages
- Be concise and direct

FACTOR-BASED PRICING:
- Decompose services into verifiable factors that determine the final price
- Express pricing as: base/fixed fee (immediate) + variable work (escrow with a range)
- For each variable line item, define:
  - A price RANGE (minAmount to maxAmount) instead of a single fixed amount
  - FACTORS: observable conditions that determine where in the range the final price lands
  - Each factor has: name, what it measures, and impact direction (increases/decreases/determines)
- The escrow hold uses maxAmount (worst case). Actual capture will be somewhere in the range.
- Generate a factorSummary: a plain English explanation of how the factors combine to determine cost
- Example: "£50 callout fee (immediate) + £500-£1000 repair (escrow) depending on pipe complexity, parts needed, and time on-site"
- For simple fixed-price items (e.g., callout fee), no range or factors needed

MILESTONE CREATION:
- For every escrow or conditional line item, define at least one milestone in the milestones array
- Each milestone MUST have:
  - A specific title (NOT "service payment" — use "Boiler repair completed and tested")
  - Concrete deliverables (what the service provider must produce/do)
  - A verification method (how the client can confirm completion)
  - Completion criteria (explicit checklist — all items must be true)
- Bad: "Service completion and customer satisfaction"
- Good: title="Pipe replacement and pressure test", deliverables=["Replace corroded section", "Pressure test at 1.5 bar"], verificationMethod="Client visual inspection + pressure gauge reading", completionCriteria=["No leaks detected", "System holds pressure for 10 minutes", "All debris cleared"]

DOCUMENT GENERATION:
- When an agreement is reached and you're instructed to generate a document, use the generate_document tool
- The document will include milestones with the structured criteria you defined at proposal time
- After both parties sign, immediate payments execute automatically
- Escrow funds are held until milestones are completed and verified

MILESTONE TRACKING:
- When asked to verify a milestone completion, use the complete_milestone tool
- Only mark milestones as complete when conditions are genuinely met
- If a milestone has linked escrow, completing it releases the held funds

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

  async injectInstruction(content: string): Promise<void> {
    if (!this.running) return;
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
      this.emit("agent:message", {
        text: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      });
    }
  }
}
