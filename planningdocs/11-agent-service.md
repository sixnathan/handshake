# Prompt 11 — Agent Service

**Phase:** 3 (depends on LLM providers)
**Depends on:** 02-config-and-providers (LLM provider types)
**Blocks:** Phase 4 (orchestrators)

## Task

Create the AgentService — the LLM conversation loop that receives transcripts, batches them, calls the LLM with tools, and executes tool handlers recursively until the model stops.

---

## File: src/services/agent.ts

### Class: AgentService extends EventEmitter

**Constructor args:**
```ts
{ provider: ILLMProvider; model: string; maxTokens: number }
```

**Private state:**
```ts
private provider: ILLMProvider;
private model: string;
private maxTokens: number;
private messages: LLMMessage[] = [];
private systemPrompt: string = "";
private tools: ToolDefinition[] = [];
private running = false;
private transcriptBatch: TranscriptEntry[] = [];
private batchTimer: ReturnType<typeof setTimeout> | null = null;
private processing = false; // prevents concurrent LLM calls
```

---

### Methods

**`start(systemPrompt: string, tools: ToolDefinition[]): Promise<void>`**
- Store systemPrompt and tools
- Set running = true
- Log that agent is started

**`stop(): void`**
- Set running = false
- Clear batchTimer if any

**`pushTranscript(entry: TranscriptEntry): void`**
- If not running, return
- Add entry to `transcriptBatch`
- Reset the batch timer:
  - Clear existing timer if any
  - Set new timer for **2000ms** (2 seconds of silence)
  - When timer fires, call `flushTranscriptBatch()`

**`pushNegotiationEvent(event: { type: string; negotiation?: Negotiation; message?: string }): void`**
- If not running, return
- Format as user message:
  ```
  [Negotiation Event] ${event.type}
  ${event.negotiation ? JSON.stringify(event.negotiation, null, 2) : ""}
  ${event.message ?? ""}
  ```
- Add as user message to messages array
- Trigger `callClaudeLoop()` immediately (negotiation events are urgent)

---

### Private: flushTranscriptBatch()

```ts
private async flushTranscriptBatch(): Promise<void> {
  if (this.transcriptBatch.length === 0) return;

  // Take all entries and clear batch
  const batch = [...this.transcriptBatch];
  this.transcriptBatch = [];
  this.batchTimer = null;

  // Format as a single user message
  const lines = batch.map(e => `[Transcript] ${e.speaker}: ${e.text}`);
  const content = lines.join("\n");

  // Add to conversation
  this.messages.push({ role: "user", content });

  // Call LLM
  await this.callClaudeLoop();
}
```

---

### Private: callClaudeLoop()

This is the core recursive loop. It calls the LLM, checks for tool use, executes tools, and recurses.

```ts
private async callClaudeLoop(): Promise<void> {
  if (this.processing || !this.running) return;
  this.processing = true;

  try {
    // Map tool definitions to LLM format
    const llmTools = this.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const response = await this.provider.createMessage({
      model: this.model,
      maxTokens: this.maxTokens,
      system: this.systemPrompt,
      messages: this.messages,
      tools: llmTools.length > 0 ? llmTools : undefined,
    });

    // Add assistant response to history
    this.messages.push({ role: "assistant", content: response.content });

    // Process response blocks
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        this.emit("agent:response", block.text);
      }
    }

    // If the model wants to use tools, execute them
    if (response.stopReason === "tool_use") {
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

        // Emit tool call event
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

      // Add tool results as user message
      this.messages.push({ role: "user", content: toolResults });

      // Recurse: call again to let the model process tool results
      this.processing = false;
      await this.callClaudeLoop();
      return;
    }

    // stopReason is "end_turn" or "max_tokens" — we're done
  } catch (err) {
    console.error("[agent] LLM call failed:", err instanceof Error ? err.message : err);
  } finally {
    this.processing = false;
  }
}
```

---

### Key behaviors

1. **2-second batching**: Transcript entries accumulate for 2 seconds of silence before being flushed as a single message. This prevents sending every partial sentence individually.

2. **Recursive tool execution**: When the LLM returns `stopReason: "tool_use"`, all tool_use blocks are executed, results are added to conversation, and the loop recurses. This continues until the LLM returns "end_turn" or "max_tokens".

3. **Concurrency guard**: `processing` flag prevents concurrent LLM calls. If a new transcript arrives while processing, it goes into the batch and will be flushed on the next timer.

4. **Negotiation events are urgent**: They bypass the 2-second timer and trigger the LLM immediately.

5. **Tool handler errors are caught**: Errors are returned as tool results (not thrown), so the LLM can see what went wrong and adjust.

---

### Imports

```ts
import EventEmitter from "eventemitter3";
import type { ILLMProvider } from "../providers/provider.js";
import type { LLMMessage, LLMToolUseBlock, LLMToolResultBlock } from "../providers/types.js";
import type { TranscriptEntry, Negotiation } from "../types.js";
import type { ToolDefinition } from "../interfaces.js";
```

---

## Verification

- pushTranscript batches for 2 seconds, then flushes
- pushNegotiationEvent triggers LLM immediately
- callClaudeLoop recurses on tool_use, stops on end_turn
- Tool execution errors are caught and returned as results
- processing flag prevents concurrent LLM calls
- Emits "agent:response" for text and "agent:tool_call" for tools
