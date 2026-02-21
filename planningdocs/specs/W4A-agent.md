# W4A — AgentService

**File to create:** `src/services/agent.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts`, `src/providers/` (all already exist)
**Depended on by:** RoomManager (starts agents), NegotiationService (receives proposals)

---

## Purpose

Per-user LLM agent that receives batched transcripts, calls the LLM with tools, and handles agent-to-agent negotiation. Each user in a room gets their own AgentService instance configured with their profile.

Major rewrite from original: now handles `startNegotiation` (analyzes transcript and proposes) and `receiveAgentMessage` (evaluates incoming proposals).

---

## Imports

```ts
import { EventEmitter } from "eventemitter3";
import type { ILLMProvider } from "../providers/provider.js";
import type { LLMMessage, LLMToolUseBlock, LLMToolResultBlock } from "../providers/types.js";
import type { TranscriptEntry, AgentProfile, AgentProposal, AgentMessage, TriggerEvent } from "../types.js";
import type { IAgentService, ToolDefinition } from "../interfaces.js";
```

---

## Class: AgentService

```ts
export class AgentService extends EventEmitter implements IAgentService
```

### Constructor

```ts
constructor(private readonly config: {
  provider: ILLMProvider;
  model: string;
  maxTokens: number;
})
```

### Private State

```ts
private messages: LLMMessage[] = [];
private systemPrompt = "";
private tools: ToolDefinition[] = [];
private running = false;
private transcriptBatch: TranscriptEntry[] = [];
private batchTimer: ReturnType<typeof setTimeout> | null = null;
private processing = false;
```

### Methods

**`start(profile: AgentProfile): Promise<void>`**
1. Build system prompt from profile (see `buildAgentSystemPrompt` below)
2. Store as `this.systemPrompt`
3. `this.running = true`
4. Note: tools are set separately by RoomManager after start via `setTools()`

**`setTools(tools: ToolDefinition[]): void`**
- `this.tools = tools`

**`stop(): void`**
1. `this.running = false`
2. Clear batch timer if any
3. `this.messages = []`

**`pushTranscript(entry: TranscriptEntry): void`**
1. If `!this.running`, return
2. Push to `this.transcriptBatch`
3. Reset batch timer:
   - Clear existing
   - Set new: `setTimeout(() => this.flushTranscriptBatch(), 2000)`

**`startNegotiation(trigger: TriggerEvent, conversationContext: string): Promise<void>`**
1. If `!this.running`, return
2. Build user message:
   ```
   [NEGOTIATION TRIGGERED]
   Trigger type: ${trigger.type}
   Matched: ${trigger.matchedText}
   Confidence: ${trigger.confidence}

   Analyze the conversation below and use the analyze_and_propose tool to extract agreement terms and build a structured proposal.

   === Conversation ===
   ${conversationContext}
   ```
3. Push as user message to `this.messages`
4. Call `this.callLLMLoop()`

**`receiveAgentMessage(message: AgentMessage): Promise<void>`**
1. If `!this.running`, return
2. Build user message based on message type:
   - `agent_proposal`:
     ```
     [INCOMING PROPOSAL from ${message.fromAgent}]
     ${JSON.stringify(message.proposal, null, 2)}

     Use the evaluate_proposal tool to assess this proposal against your preferences and decide to accept, counter, or reject.
     ```
   - `agent_counter`:
     ```
     [COUNTER-PROPOSAL from ${message.fromAgent}]
     Reason: ${message.reason}
     ${JSON.stringify(message.proposal, null, 2)}

     Use the evaluate_proposal tool to assess this counter-proposal.
     ```
   - `agent_accept`:
     ```
     [PROPOSAL ACCEPTED by ${message.fromAgent}]
     The other party's agent has accepted your proposal. Inform your user.
     ```
   - `agent_reject`:
     ```
     [PROPOSAL REJECTED by ${message.fromAgent}]
     Reason: ${message.reason}
     Inform your user that the negotiation was not successful.
     ```
3. Push as user message to `this.messages`
4. Call `this.callLLMLoop()`

### Private Methods

**`private async flushTranscriptBatch(): Promise<void>`**
1. If batch is empty, return
2. Take snapshot and clear: `const batch = [...this.transcriptBatch]; this.transcriptBatch = []; this.batchTimer = null;`
3. Format as single user message:
   ```ts
   const content = batch.map(e => `[${e.source}] ${e.speaker}: ${e.text}`).join("\n");
   ```
4. Push: `this.messages.push({ role: "user", content })`
5. Call `this.callLLMLoop()`

**`private async callLLMLoop(): Promise<void>`**
1. If `this.processing || !this.running`, return
2. `this.processing = true`
3. Try:
   - Map tools to LLM format:
     ```ts
     const llmTools = this.tools.map(t => ({
       name: t.name,
       description: t.description,
       input_schema: t.parameters,
     }));
     ```
   - Call LLM:
     ```ts
     const response = await this.config.provider.createMessage({
       model: this.config.model,
       maxTokens: this.config.maxTokens,
       system: this.systemPrompt,
       messages: this.messages,
       tools: llmTools.length > 0 ? llmTools : undefined,
     });
     ```
   - Add assistant response to history: `this.messages.push({ role: "assistant", content: response.content })`
   - Process text blocks — emit `"agent:message"`:
     ```ts
     for (const block of response.content) {
       if (block.type === "text" && block.text.trim()) {
         this.emit("agent:message", { text: block.text, timestamp: Date.now() });
       }
     }
     ```
   - If `response.stopReason === "tool_use"`:
     - Execute all tool_use blocks (see tool execution below)
     - Add tool results as user message
     - `this.processing = false`
     - Recurse: `await this.callLLMLoop()`
     - Return
4. Catch: `console.error("[agent] LLM call failed:", err)`
5. Finally: `this.processing = false`

**Tool execution within `callLLMLoop`:**
```ts
const toolUseBlocks = response.content.filter(
  (b): b is LLMToolUseBlock => b.type === "tool_use"
);

const toolResults: LLMToolResultBlock[] = [];

for (const toolUse of toolUseBlocks) {
  const tool = this.tools.find(t => t.name === toolUse.name);
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

  this.emit("agent:tool_call", { name: toolUse.name, input: toolUse.input, result });

  toolResults.push({
    type: "tool_result",
    tool_use_id: toolUse.id,
    content: result,
  });
}

this.messages.push({ role: "user", content: toolResults });
```

### buildAgentSystemPrompt (private or module-level)

```ts
function buildAgentSystemPrompt(profile: AgentProfile): string {
  return `You are a negotiation agent for ${profile.displayName} (role: ${profile.role}).

YOUR USER'S PREFERENCES:
- Maximum auto-approve amount: £${(profile.preferences.maxAutoApproveAmount / 100).toFixed(2)}
- Preferred currency: ${profile.preferences.preferredCurrency}
- Escrow preference: ${profile.preferences.escrowPreference}
- Escrow threshold: £${(profile.preferences.escrowThreshold / 100).toFixed(2)}
- Negotiation style: ${profile.preferences.negotiationStyle}

${profile.customInstructions ? `CUSTOM INSTRUCTIONS FROM YOUR USER:\n${profile.customInstructions}\n` : ""}

YOUR RESPONSIBILITIES:
1. Listen to the conversation and understand context
2. When a negotiation is triggered, analyze the conversation and propose fair terms
3. When receiving proposals, evaluate them against your user's preferences
4. Negotiate on behalf of your user (accept, counter, or reject)
5. Use send_message_to_user to keep your user informed of what you're doing

NEGOTIATION RULES:
- NEVER auto-approve amounts above your user's maxAutoApproveAmount
- For amounts above the escrow threshold (when escrowPreference is "above_threshold"), always use escrow
- If escrowPreference is "always", always use escrow regardless of amount
- If escrowPreference is "never", never use escrow
- Your negotiation style affects how aggressively you counter-propose:
  - aggressive: counter with 20-30% lower amounts, push for better terms
  - balanced: counter with 10-15% adjustments, seek fair middle ground
  - conservative: accept reasonable proposals quickly, avoid prolonged negotiation

COMMUNICATION:
- Use send_message_to_user to inform your user about:
  - What you detected in the conversation
  - What you're proposing and why
  - Incoming proposals and your assessment
  - Final outcomes
- Be concise but informative`;
}
```

---

## Events Emitted

| Event | Payload | When |
|-------|---------|------|
| `"agent:message"` | `{ text: string, timestamp: number }` | LLM produces text response |
| `"agent:tool_call"` | `{ name: string, input: Record<string, unknown>, result: string }` | Tool executed |
| `"agent:proposal"` | (emitted by tool handler, not directly by AgentService) | — |
| `"agent:counter"` | (emitted by tool handler) | — |
| `"agent:accept"` | (emitted by tool handler) | — |
| `"agent:reject"` | (emitted by tool handler) | — |

Note: The agent negotiation events (`proposal`, `counter`, `accept`, `reject`) are emitted by the **tool handlers** in `tools.ts`, not by the AgentService itself. The AgentService just runs the LLM loop and executes tools.

---

## Edge Cases

- `startNegotiation` called while processing: queued as user message, processed after current loop
- Multiple rapid transcripts: batched for 2s, sent as one message
- Tool handler throws: error returned to LLM as tool result (not swallowed)
- LLM returns empty text: not emitted

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `IAgentService` interface
- 2-second transcript batching
- Recursive tool execution loop
- Concurrency guard prevents parallel LLM calls
- System prompt built from AgentProfile
- Handles all 4 AgentMessage types
