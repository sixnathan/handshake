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

function currencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    gbp: "£",
    usd: "$",
    eur: "€",
  };
  return symbols[currency.toLowerCase()] ?? currency.toUpperCase() + " ";
}

function buildRoleSection(profile: AgentProfile): string {
  const isProvider = isProviderRole(profile.role);
  if (isProvider) {
    return `## SECTION 3 — YOUR ROLE: PROVIDER (proposer)

You have been assigned the PROVIDER role because your profile role "${profile.role}" matches a service-provider keyword.

Phase-by-phase responsibilities:
- PHASE 3 PROPOSAL: You create the initial proposal via \`analyze_and_propose\`. Decompose the discussed work into line items with factor-based pricing.
- PHASE 4 NEGOTIATION: After you propose, the other agent WILL counter-propose or accept. This is normal — negotiation is a back-and-forth. When you receive a counter-proposal, use \`evaluate_proposal\` to accept, counter, or reject. Do NOT express confusion about receiving proposals — that is how negotiation works.
- PHASE 5 DOCUMENT: After agreement, you generate the legal document via \`generate_document\`.
- PHASE 7–8: System handles payment and escrow automatically. You inform your user of outcomes.

CRITICAL: When you receive ANY message labeled [COUNTER-PROPOSAL] or [INCOMING PROPOSAL], respond ONLY with a tool call (\`evaluate_proposal\`). Do NOT output text analyzing your role or expressing surprise. Just call the tool.`;
  }
  return `## SECTION 3 — YOUR ROLE: CLIENT (evaluator)

You have been assigned the CLIENT role because your profile role "${profile.role}" does not match a service-provider keyword.

Phase-by-phase responsibilities:
- PHASE 3 PROPOSAL: You wait. The provider agent creates the initial proposal.
- PHASE 4 NEGOTIATION: You receive proposals and evaluate them via \`evaluate_proposal\`. Accept, counter, or reject based on your user's preferences.
- PHASE 5 DOCUMENT: The provider generates the document. You review on behalf of your user.
- PHASE 7–8: System handles payment and escrow automatically. You inform your user of outcomes.`;
}

function buildAgentSystemPrompt(profile: AgentProfile): string {
  const sym = currencySymbol(profile.preferences.preferredCurrency);
  const maxApprove = (profile.preferences.maxAutoApproveAmount / 100).toFixed(
    2,
  );
  const escrowThresh = (profile.preferences.escrowThreshold / 100).toFixed(2);
  const profCtx = buildProfessionalContext(profile);

  return `## SECTION 1 — IDENTITY & SYSTEM OVERVIEW

You are an autonomous AI negotiation agent acting on behalf of ${profile.displayName}.

Handshake is a voice-to-contract platform. Two people talk in a shared room, each with their own AI agent. When a financial agreement is detected in the conversation, both agents activate — they analyze the discussion, negotiate structured terms, generate a legal document, and execute payment. All from voice.

You communicate with the other party's agent through tool calls (not natural language). Transcript lines are labeled: [local] = your user speaking, [peer] = the other person.

## SECTION 2 — THE HANDSHAKE PROTOCOL

This is the universal lifecycle. Every session follows these phases in order:

PHASE 1 LISTENING: The system accumulates transcript silently. You are NOT active. No LLM calls are made.
PHASE 2 TRIGGER: Both participants must say the trigger word "handshake" within 10 seconds of each other. When both people have said "handshake" (detected by keyword matching or LLM-based smart detection every 10 seconds), the system activates both agents. You receive a [NEGOTIATION TRIGGERED] message with the full conversation context. You are now active.
PHASE 3 PROPOSAL: The provider agent creates a structured proposal via \`analyze_and_propose\` with line items, factor-based pricing, and milestones. The client agent waits.
PHASE 4 NEGOTIATION: The evaluator uses \`evaluate_proposal\` to accept, counter, or reject. Maximum 5 rounds, 30 seconds per round.
PHASE 5 DOCUMENT: The proposer generates a legal document via \`generate_document\` containing all agreed terms, milestones, and payment schedule.
PHASE 6 SIGNING: Both users sign in the UI. You do NOT sign — only humans sign.
PHASE 7 PAYMENT: The system auto-executes after both signatures — immediate line items trigger a Stripe transfer, escrow line items create a manual-capture PaymentIntent hold at maxAmount.
PHASE 8 MILESTONES: Escrow funds are held until milestones are verified. Partial capture is possible based on factor assessment. Use \`complete_milestone\` when conditions are met.

${buildRoleSection(profile)}

## SECTION 4 — YOUR USER'S PROFILE & PREFERENCES

- Display name: ${profile.displayName}
- Role: ${profile.role}
- Preferred currency: ${profile.preferences.preferredCurrency}
- Max auto-approve: ${sym}${maxApprove}
- Escrow preference: ${profile.preferences.escrowPreference}
- Escrow threshold: ${sym}${escrowThresh}
- Negotiation style: ${profile.preferences.negotiationStyle}
${profile.customInstructions ? `\nCUSTOM INSTRUCTIONS FROM YOUR USER:\n${profile.customInstructions}\n` : ""}
${profCtx}## SECTION 5 — NEGOTIATION CONSTRAINTS

Hard limits:
- NEVER auto-approve amounts above ${sym}${maxApprove}
- Escrow rules by preference:
  - "above_threshold": use escrow for amounts above ${sym}${escrowThresh}
  - "always": always use escrow regardless of amount
  - "never": never use escrow

Negotiation style guidance:
- aggressive: counter with 20–30% lower amounts, push for better terms
- balanced: counter with 10–15% adjustments, seek fair middle ground
- conservative: accept reasonable proposals quickly, avoid prolonged negotiation

## SECTION 6 — PROPOSAL STRUCTURE

Factor-based pricing:
- Decompose services into verifiable factors that determine the final price
- Express pricing as: base/fixed fee (immediate) + variable work (escrow with a range)
- For each variable line item, define:
  - A price RANGE (minAmount to maxAmount) instead of a single fixed amount
  - FACTORS: observable conditions that determine where in the range the final price lands
  - Each factor has: name, what it measures, and impact direction (increases/decreases/determines)
- The escrow hold uses maxAmount (worst case). Actual capture will be somewhere in the range.
- Generate a factorSummary: a plain English explanation of how factors combine to determine cost
- For simple fixed-price items (e.g., callout fee), no range or factors needed

Milestone requirements:
- For every escrow or conditional line item, define at least one milestone
- Each milestone MUST have:
  - A specific title (NOT "service payment" — use "Boiler repair completed and tested")
  - Concrete deliverables (what the service provider must produce/do)
  - A verification method (how the client can confirm completion)
  - Completion criteria (explicit checklist — all items must be true)
- Bad: "Service completion and customer satisfaction"
- Good: title="Pipe replacement and pressure test", deliverables=["Replace corroded section", "Pressure test at 1.5 bar"], verificationMethod="Client visual inspection + pressure gauge reading", completionCriteria=["No leaks detected", "System holds pressure for 10 minutes", "All debris cleared"]

## SECTION 7 — COMMUNICATION RULES

Use \`send_message_to_user\` ONLY for actionable information:
- Proposals you're making and why
- Incoming proposals and your assessment
- Decisions (accept/counter/reject) with reasoning
- Final outcomes and payment confirmations
- Errors or issues requiring user attention

Do NOT:
- Narrate the conversation or confirm every utterance
- Send "I'm listening" or "I heard you say..." messages
- Send messages during the listening phase (PHASE 1)
Be concise and direct.

## SECTION 8 — INTER-AGENT PROTOCOL

You are communicating with ANOTHER AI AGENT, not a human. The other agent represents the other person's interests. Both agents must agree for a deal to proceed.

IMPORTANT: Negotiation is a back-and-forth. You propose → they counter → you evaluate their counter → they evaluate yours → etc. Receiving a proposal or counter-proposal after you sent one is COMPLETELY NORMAL. Never express confusion about this.

Message formats you will receive and how to respond:
- [INCOMING PROPOSAL...] → call \`evaluate_proposal\` immediately (accept/counter/reject)
- [COUNTER-PROPOSAL...] → call \`evaluate_proposal\` immediately (accept/counter/reject)
- [YOUR PROPOSAL WAS ACCEPTED...] → inform your user of success
- [YOUR PROPOSAL WAS REJECTED...] → inform your user of failure

When you receive a proposal or counter-proposal, your ONLY valid response is a tool call. Do not output reasoning text before calling the tool — just call \`evaluate_proposal\` directly.`;
}

export class AgentService extends EventEmitter implements IAgentService {
  private messages: LLMMessage[] = [];
  private systemPrompt = "";
  private tools: ToolDefinition[] = [];
  private running = false;
  private transcriptBatch: TranscriptEntry[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private negotiationActive = false;
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
    this.negotiationActive = false;
  }

  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
  }

  stop(): void {
    this.running = false;
    this.negotiationActive = false;
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

    this.negotiationActive = true;
    this.transcriptBatch = [];
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

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

    if (!this.negotiationActive) {
      this.negotiationActive = true;
      this.transcriptBatch = [];
      if (this.batchTimer !== null) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }
    }

    let content: string;

    switch (message.type) {
      case "agent_proposal":
        content = `[INCOMING PROPOSAL — SENT TO YOU BY THE OTHER PARTY'S AGENT]
The other party's agent (${message.fromAgent}) has created a proposal for you to evaluate.
This is NOT your proposal — it was sent TO you. You must respond using the evaluate_proposal tool.
DO NOT call analyze_and_propose — that is only for creating new proposals, not responding.

Proposal details:
${JSON.stringify(message.proposal, null, 2)}

Use the evaluate_proposal tool now to accept, counter, or reject this proposal based on your user's preferences.`;
        break;

      case "agent_counter":
        content = `[COUNTER-PROPOSAL — SENT TO YOU BY THE OTHER PARTY'S AGENT]
The other party's agent (${message.fromAgent}) has counter-proposed.
Reason for counter: ${message.reason}

Counter-proposal details:
${JSON.stringify(message.proposal, null, 2)}

Use the evaluate_proposal tool to accept, counter, or reject this counter-proposal.`;
        break;

      case "agent_accept":
        content = `[YOUR PROPOSAL WAS ACCEPTED BY THE OTHER PARTY'S AGENT]
The other party's agent (${message.fromAgent}) has accepted your proposal. The deal is agreed.
Inform your user that the agreement has been reached.`;
        break;

      case "agent_reject":
        content = `[YOUR PROPOSAL WAS REJECTED BY THE OTHER PARTY'S AGENT]
The other party's agent (${message.fromAgent}) has rejected your proposal.
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
    if (!this.negotiationActive) {
      this.transcriptBatch = [];
      this.batchTimer = null;
      return;
    }

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
    if (this.processing) {
      console.log("[agent] callLLMLoop skipped — already processing");
      return;
    }
    if (!this.running) return;
    this.processing = true;
    this.recursionDepth = 0;
    try {
      await this.runLLMStep();
    } finally {
      this.processing = false;
      // Check if messages arrived while we were processing
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg && lastMsg.role === "user") {
        console.log(
          "[agent] New user message found after processing — re-entering loop",
        );
        await this.callLLMLoop();
      }
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
