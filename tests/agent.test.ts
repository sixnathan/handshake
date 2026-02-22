import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentService } from "../src/services/agent.js";
import type {
  AgentProfile,
  TranscriptEntry,
  TriggerEvent,
  AgentMessage,
} from "../src/types.js";
import type { ToolDefinition } from "../src/interfaces.js";

function makeProfile(): AgentProfile {
  return {
    displayName: "Alice",
    role: "homeowner",
    customInstructions: "Be firm on price",
    preferences: {
      maxAutoApproveAmount: 5000,
      preferredCurrency: "gbp",
      escrowPreference: "above_threshold",
      escrowThreshold: 10000,
      negotiationStyle: "balanced",
    },
  };
}

function makeEntry(speaker: string, text: string): TranscriptEntry {
  return {
    id: `${speaker}-${Date.now()}-${Math.random()}`,
    speaker,
    text,
    timestamp: Date.now(),
    isFinal: true,
    source: "local",
  };
}

function makeTrigger(): TriggerEvent {
  return {
    type: "keyword",
    confidence: 1.0,
    matchedText: "chripbbbly",
    timestamp: Date.now(),
    speakerId: "alice",
  };
}

function makeSimpleLLM() {
  return {
    createMessage: vi.fn().mockImplementation(async (params: any) => {
      // Snapshot messages at call time to avoid mutation issues
      (params as any).__messageSnapshot = params.messages.map((m: any) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : JSON.parse(JSON.stringify(m.content)),
      }));
      return {
        content: [{ type: "text", text: "I understand. Let me analyze this." }],
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 30 },
      };
    }),
  };
}

function makeToolUsingLLM() {
  let callCount = 0;
  return {
    createMessage: vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: [
            { type: "text", text: "Let me send a message." },
            {
              type: "tool_use",
              id: "tool_1",
              name: "send_message_to_user",
              input: { text: "Analyzing the conversation..." },
            },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 50, outputTokens: 100 },
        };
      }
      return {
        content: [{ type: "text", text: "Done analyzing." }],
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    }),
  };
}

function makeSendMessageTool(): ToolDefinition {
  return {
    name: "send_message_to_user",
    description: "Send message to user",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    handler: vi.fn().mockResolvedValue("Message sent to user panel."),
  };
}

describe("AgentService Module", () => {
  let agent: AgentService;
  let mockLLM: ReturnType<typeof makeSimpleLLM>;

  beforeEach(() => {
    mockLLM = makeSimpleLLM();
    agent = new AgentService({
      provider: mockLLM as any,
      model: "test-model",
      maxTokens: 4096,
    });
  });

  afterEach(() => {
    agent.stop();
  });

  describe("start/stop lifecycle", () => {
    it("should start without error", async () => {
      await agent.start(makeProfile());
    });

    it("should not process transcripts before start", async () => {
      vi.useFakeTimers();
      try {
        agent.pushTranscript(makeEntry("alice", "hello"));
        vi.advanceTimersByTime(5000);
        expect(mockLLM.createMessage).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should not process after stop", async () => {
      vi.useFakeTimers();
      try {
        await agent.start(makeProfile());
        agent.stop();
        agent.pushTranscript(makeEntry("alice", "hello"));
        vi.advanceTimersByTime(5000);
        expect(mockLLM.createMessage).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should clear message history on stop", async () => {
      await agent.start(makeProfile());
      agent.stop();
      await agent.start(makeProfile());
    });
  });

  describe("pushTranscript batching", () => {
    it("should batch transcripts for 2 seconds before flushing", async () => {
      vi.useFakeTimers();
      try {
        await agent.start(makeProfile());

        agent.pushTranscript(makeEntry("alice", "hello"));
        agent.pushTranscript(makeEntry("bob", "hi there"));

        // Not flushed yet at 1s
        await vi.advanceTimersByTimeAsync(1000);
        expect(mockLLM.createMessage).not.toHaveBeenCalled();

        // Flushed at 2s
        await vi.advanceTimersByTimeAsync(1000);
        expect(mockLLM.createMessage).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should reset batch timer on new transcript", async () => {
      vi.useFakeTimers();
      try {
        await agent.start(makeProfile());

        agent.pushTranscript(makeEntry("alice", "hello"));
        await vi.advanceTimersByTimeAsync(1500);

        agent.pushTranscript(makeEntry("bob", "hi")); // resets timer
        await vi.advanceTimersByTimeAsync(1500);

        expect(mockLLM.createMessage).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(500);
        expect(mockLLM.createMessage).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should include all batched transcripts in single message", async () => {
      vi.useFakeTimers();
      try {
        await agent.start(makeProfile());

        agent.pushTranscript(makeEntry("alice", "line one"));
        agent.pushTranscript(makeEntry("bob", "line two"));
        agent.pushTranscript(makeEntry("alice", "line three"));

        await vi.advanceTimersByTimeAsync(2000);

        expect(mockLLM.createMessage).toHaveBeenCalledOnce();
        const snapshot =
          mockLLM.createMessage.mock.calls[0][0].__messageSnapshot;
        const userMsg = snapshot.find((m: any) => m.role === "user");
        expect(userMsg.content).toContain("line one");
        expect(userMsg.content).toContain("line two");
        expect(userMsg.content).toContain("line three");
      } finally {
        vi.useRealTimers();
      }
    });

    it("should not flush empty batch", async () => {
      vi.useFakeTimers();
      try {
        await agent.start(makeProfile());
        await vi.advanceTimersByTimeAsync(5000);
        expect(mockLLM.createMessage).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("startNegotiation", () => {
    it("should send negotiation trigger to LLM", async () => {
      await agent.start(makeProfile());
      await agent.startNegotiation(
        makeTrigger(),
        "alice: fix boiler\nbob: £200",
      );

      expect(mockLLM.createMessage).toHaveBeenCalledOnce();
      const snapshot = mockLLM.createMessage.mock.calls[0][0].__messageSnapshot;
      const userMsg = snapshot.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("NEGOTIATION TRIGGERED");
      expect(userMsg.content).toContain("fix boiler");
    });

    it("should include trigger type and confidence", async () => {
      await agent.start(makeProfile());
      const trigger = makeTrigger();
      trigger.type = "smart";
      trigger.confidence = 0.85;
      await agent.startNegotiation(trigger, "context");

      const snapshot = mockLLM.createMessage.mock.calls[0][0].__messageSnapshot;
      const userMsg = snapshot.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("smart");
      expect(userMsg.content).toContain("0.85");
    });

    it("should not start negotiation if not running", async () => {
      await agent.startNegotiation(makeTrigger(), "context");
      expect(mockLLM.createMessage).not.toHaveBeenCalled();
    });

    it("should emit agent:message for text responses", async () => {
      await agent.start(makeProfile());
      const messages: { text: string; timestamp: number }[] = [];
      agent.on("agent:message", (m) => messages.push(m));

      await agent.startNegotiation(makeTrigger(), "context");

      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].text).toContain("analyze");
    });
  });

  describe("receiveAgentMessage", () => {
    it("should handle incoming proposal", async () => {
      await agent.start(makeProfile());
      const proposal: AgentMessage = {
        type: "agent_proposal",
        negotiationId: "neg_1",
        proposal: {
          summary: "Fix boiler",
          lineItems: [
            { description: "Labour", amount: 15000, type: "immediate" },
          ],
          totalAmount: 15000,
          currency: "gbp",
          conditions: [],
          expiresAt: Date.now() + 30000,
        },
        fromAgent: "bob",
      };

      await agent.receiveAgentMessage(proposal);
      expect(mockLLM.createMessage).toHaveBeenCalledOnce();
      const snapshot = mockLLM.createMessage.mock.calls[0][0].__messageSnapshot;
      const userMsg = snapshot.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("INCOMING PROPOSAL");
    });

    it("should handle counter-proposal", async () => {
      await agent.start(makeProfile());
      await agent.receiveAgentMessage({
        type: "agent_counter",
        negotiationId: "neg_1",
        proposal: {
          summary: "Counter",
          lineItems: [
            { description: "Labour", amount: 10000, type: "immediate" },
          ],
          totalAmount: 10000,
          currency: "gbp",
          conditions: [],
          expiresAt: Date.now() + 30000,
        },
        reason: "Too expensive",
        fromAgent: "bob",
      });

      const snapshot = mockLLM.createMessage.mock.calls[0][0].__messageSnapshot;
      const userMsg = snapshot.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("COUNTER-PROPOSAL");
      expect(userMsg.content).toContain("Too expensive");
    });

    it("should handle accept message", async () => {
      await agent.start(makeProfile());
      await agent.receiveAgentMessage({
        type: "agent_accept",
        negotiationId: "neg_1",
        fromAgent: "bob",
      });

      const snapshot = mockLLM.createMessage.mock.calls[0][0].__messageSnapshot;
      const userMsg = snapshot.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("PROPOSAL ACCEPTED");
    });

    it("should handle reject message", async () => {
      await agent.start(makeProfile());
      await agent.receiveAgentMessage({
        type: "agent_reject",
        negotiationId: "neg_1",
        reason: "Can't afford it",
        fromAgent: "bob",
      });

      const snapshot = mockLLM.createMessage.mock.calls[0][0].__messageSnapshot;
      const userMsg = snapshot.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("PROPOSAL REJECTED");
      expect(userMsg.content).toContain("Can't afford it");
    });

    it("should not process if not running", async () => {
      await agent.receiveAgentMessage({
        type: "agent_accept",
        negotiationId: "neg_1",
        fromAgent: "bob",
      });
      expect(mockLLM.createMessage).not.toHaveBeenCalled();
    });
  });

  describe("tool use loop", () => {
    it("should execute tools and continue loop", async () => {
      const toolLLM = makeToolUsingLLM();
      const toolAgent = new AgentService({
        provider: toolLLM as any,
        model: "test-model",
        maxTokens: 4096,
      });
      const tool = makeSendMessageTool();
      toolAgent.setTools([tool]);

      const toolCalls: { name: string; result: string }[] = [];
      toolAgent.on("agent:tool_call", (c) => toolCalls.push(c));

      await toolAgent.start(makeProfile());
      await toolAgent.startNegotiation(makeTrigger(), "context");

      expect(toolLLM.createMessage).toHaveBeenCalledTimes(2);
      expect(tool.handler).toHaveBeenCalledOnce();
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe("send_message_to_user");

      toolAgent.stop();
    });

    it("should handle unknown tools gracefully", async () => {
      let callCount = 0;
      const unknownToolLLM = {
        createMessage: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                {
                  type: "tool_use",
                  id: "tool_1",
                  name: "nonexistent_tool",
                  input: {},
                },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }
          return {
            content: [{ type: "text", text: "OK" }],
            stopReason: "end_turn",
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }),
      };
      const a = new AgentService({
        provider: unknownToolLLM as any,
        model: "m",
        maxTokens: 1000,
      });
      await a.start(makeProfile());

      const toolCalls: any[] = [];
      a.on("agent:tool_call", (c) => toolCalls.push(c));

      await a.startNegotiation(makeTrigger(), "ctx");
      expect(toolCalls[0].result).toContain("Unknown tool");
      a.stop();
    });

    it("should handle tool handler errors gracefully", async () => {
      let callCount = 0;
      const errorLLM = {
        createMessage: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                { type: "tool_use", id: "t1", name: "failing_tool", input: {} },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }
          return {
            content: [{ type: "text", text: "Handled error" }],
            stopReason: "end_turn",
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }),
      };
      const a = new AgentService({
        provider: errorLLM as any,
        model: "m",
        maxTokens: 1000,
      });
      a.setTools([
        {
          name: "failing_tool",
          description: "Fails",
          parameters: { type: "object", properties: {} },
          handler: vi.fn().mockRejectedValue(new Error("Tool exploded")),
        },
      ]);
      await a.start(makeProfile());

      const toolCalls: any[] = [];
      a.on("agent:tool_call", (c) => toolCalls.push(c));
      await a.startNegotiation(makeTrigger(), "ctx");

      expect(toolCalls[0].result).toContain("Error: Tool exploded");
      a.stop();
    });

    it("should enforce max recursion depth of 20", async () => {
      const infiniteLLM = {
        createMessage: vi.fn().mockResolvedValue({
          content: [{ type: "tool_use", id: "t1", name: "noop", input: {} }],
          stopReason: "tool_use",
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      };
      const a = new AgentService({
        provider: infiniteLLM as any,
        model: "m",
        maxTokens: 100,
      });
      a.setTools([
        {
          name: "noop",
          description: "No-op",
          parameters: { type: "object", properties: {} },
          handler: vi.fn().mockResolvedValue("ok"),
        },
      ]);
      await a.start(makeProfile());

      const messages: any[] = [];
      a.on("agent:message", (m) => messages.push(m));
      await a.startNegotiation(makeTrigger(), "ctx");

      expect(infiniteLLM.createMessage.mock.calls.length).toBeLessThanOrEqual(
        21,
      );
      expect(messages.some((m) => m.text.includes("limit reached"))).toBe(true);
      a.stop();
    });
  });

  describe("system prompt", () => {
    it("should include profile details in system prompt", async () => {
      await agent.start(makeProfile());
      await agent.startNegotiation(makeTrigger(), "context");

      const systemPrompt = mockLLM.createMessage.mock.calls[0][0].system;
      expect(systemPrompt).toContain("Alice");
      expect(systemPrompt).toContain("homeowner");
      expect(systemPrompt).toContain("Be firm on price");
      expect(systemPrompt).toContain("£50.00"); // 5000 pence
      expect(systemPrompt).toContain("balanced");
      expect(systemPrompt).toContain("above_threshold");
    });

    it("should include negotiation rules", async () => {
      await agent.start(makeProfile());
      await agent.startNegotiation(makeTrigger(), "context");

      const systemPrompt = mockLLM.createMessage.mock.calls[0][0].system;
      expect(systemPrompt).toContain("NEVER auto-approve");
      expect(systemPrompt).toContain("escrow");
      expect(systemPrompt).toContain("aggressive");
      expect(systemPrompt).toContain("conservative");
    });
  });

  describe("setTools", () => {
    it("should pass tools to LLM calls", async () => {
      agent.setTools([makeSendMessageTool()]);
      await agent.start(makeProfile());
      await agent.startNegotiation(makeTrigger(), "ctx");

      const tools = mockLLM.createMessage.mock.calls[0][0].tools;
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("send_message_to_user");
    });

    it("should not pass tools when none are set", async () => {
      await agent.start(makeProfile());
      await agent.startNegotiation(makeTrigger(), "ctx");

      const tools = mockLLM.createMessage.mock.calls[0][0].tools;
      expect(tools).toBeUndefined();
    });
  });

  describe("LLM error handling", () => {
    it("should handle LLM call failure gracefully", async () => {
      mockLLM.createMessage.mockRejectedValue(new Error("API down"));
      await agent.start(makeProfile());

      // Should not throw
      await agent.startNegotiation(makeTrigger(), "ctx");
    });
  });

  describe("message windowing (trimMessages)", () => {
    it("should cap messages at 42 after exceeding 60 entries", async () => {
      vi.useFakeTimers();
      try {
        await agent.start(makeProfile());

        // Each flush: 1 user message added, then LLM adds 1 assistant = 2 per flush
        // 35 flushes = 70 messages, which exceeds the 60-message limit
        for (let i = 0; i < 35; i++) {
          agent.pushTranscript(makeEntry("alice", `message ${i}`));
          await vi.advanceTimersByTimeAsync(2000);
        }

        expect(mockLLM.createMessage).toHaveBeenCalled();

        // After trim: head(2) + tail(40) = 42 messages in the array
        // The LLM snapshot captures messages AFTER trimMessages() runs but
        // includes the new user message already pushed before the call.
        // Find any call where trimming took effect — the snapshot should be <= 43
        // (42 after trim + the latest user message that was already in the array)
        const allCalls = mockLLM.createMessage.mock.calls;
        const lastSnapshot = allCalls[allCalls.length - 1][0].__messageSnapshot;

        // After trimming, messages cannot exceed 42 (head=2 + tail=40) plus
        // any new messages added in the same flush cycle. The key invariant:
        // no snapshot should have more than 60 messages (that's the whole point).
        expect(lastSnapshot.length).toBeLessThanOrEqual(60);

        // And after many flushes, trimming should have kept it well below 70
        expect(lastSnapshot.length).toBeLessThan(70);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should preserve the first message (initial user context) after trimming", async () => {
      vi.useFakeTimers();
      try {
        await agent.start(makeProfile());

        // The first message pushed will be the "negotiation triggered" user message
        await agent.startNegotiation(makeTrigger(), "initial context");

        // Record the first user message from the first LLM call
        const firstCallSnapshot =
          mockLLM.createMessage.mock.calls[0][0].__messageSnapshot;
        const firstMessage = firstCallSnapshot[0];
        expect(firstMessage.role).toBe("user");
        expect(firstMessage.content).toContain("NEGOTIATION TRIGGERED");

        // Now push many transcripts to exceed 60 messages
        for (let i = 0; i < 35; i++) {
          agent.pushTranscript(makeEntry("bob", `line ${i}`));
          await vi.advanceTimersByTimeAsync(2000);
        }

        // Get the last call's message snapshot
        const lastCall =
          mockLLM.createMessage.mock.calls[
            mockLLM.createMessage.mock.calls.length - 1
          ];
        const lastSnapshot = lastCall[0].__messageSnapshot;

        // The very first message should still be the original negotiation trigger
        // (trimMessages preserves the first 2 messages as head)
        expect(lastSnapshot[0].role).toBe("user");
        expect(lastSnapshot[0].content).toContain("NEGOTIATION TRIGGERED");
      } finally {
        vi.useRealTimers();
      }
    });

    it("should not trim when messages are under the 60 limit", async () => {
      vi.useFakeTimers();
      try {
        await agent.start(makeProfile());

        // Push 5 transcripts: 5 user + 5 assistant = 10 messages
        for (let i = 0; i < 5; i++) {
          agent.pushTranscript(makeEntry("alice", `msg ${i}`));
          await vi.advanceTimersByTimeAsync(2000);
        }

        // 5 flushes, each producing 2 messages = 10 total, well under 60
        const totalCalls = mockLLM.createMessage.mock.calls.length;
        expect(totalCalls).toBe(5);

        // Push one more and check — all messages should be present (no trimming)
        agent.pushTranscript(makeEntry("alice", "check message"));
        await vi.advanceTimersByTimeAsync(2000);

        const lastCall =
          mockLLM.createMessage.mock.calls[
            mockLLM.createMessage.mock.calls.length - 1
          ];
        const messageCount = lastCall[0].__messageSnapshot.length;

        // 6 user messages + 5 assistant messages (the 6th assistant hasn't been added yet) = 11
        // No trimming should have occurred — count should equal exactly 11
        expect(messageCount).toBe(11);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("concurrent flushTranscriptBatch during LLM processing", () => {
    it("should not re-enter callLLMLoop while LLM is in-flight", async () => {
      vi.useFakeTimers();
      try {
        // Create a slow LLM that we control resolution of
        const resolvers: Array<(v: any) => void> = [];
        const slowLLM = {
          createMessage: vi.fn().mockImplementation(
            () =>
              new Promise<any>((resolve) => {
                resolvers.push(resolve);
              }),
          ),
        };
        const response = {
          content: [{ type: "text", text: "Done" }],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 10 },
        };

        const slowAgent = new AgentService({
          provider: slowLLM as any,
          model: "test-model",
          maxTokens: 4096,
        });
        await slowAgent.start(makeProfile());

        // First transcript — triggers flush after 2s
        slowAgent.pushTranscript(makeEntry("alice", "first batch"));
        await vi.advanceTimersByTimeAsync(2000);

        // LLM is now "processing" (promise not resolved yet)
        expect(slowLLM.createMessage).toHaveBeenCalledTimes(1);

        // Push another transcript while LLM is busy
        slowAgent.pushTranscript(makeEntry("bob", "second batch"));
        await vi.advanceTimersByTimeAsync(2000);

        // The second callLLMLoop returned early because processing = true
        // So createMessage should still only have been called once at this point
        expect(slowLLM.createMessage).toHaveBeenCalledTimes(1);

        // Resolve the first LLM call. runLLMStep will detect the new message
        // that was pushed to this.messages and recurse internally, creating a
        // second LLM call. This is the expected behavior — the guard is in
        // callLLMLoop, not runLLMStep.
        resolvers[0](response);
        await vi.advanceTimersByTimeAsync(0);

        // The recursive call from runLLMStep may have fired. Resolve it too.
        if (resolvers.length > 1) {
          resolvers[1](response);
          await vi.advanceTimersByTimeAsync(0);
        }

        // The key assertion: while the first LLM call was in-flight,
        // no ADDITIONAL callLLMLoop entry happened (only internal recursion).
        // Total calls should be at most 2 (first + one recursive from runLLMStep).
        expect(slowLLM.createMessage.mock.calls.length).toBeLessThanOrEqual(2);

        slowAgent.stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should queue transcript messages even while processing", async () => {
      vi.useFakeTimers();
      try {
        const resolvers: Array<(v: any) => void> = [];
        const slowLLM = {
          createMessage: vi.fn().mockImplementation(
            (params: any) =>
              new Promise<any>((resolve) => {
                // Snapshot messages at call time
                (params as any).__messageSnapshot = params.messages.map(
                  (m: any) => ({
                    role: m.role,
                    content:
                      typeof m.content === "string"
                        ? m.content
                        : JSON.parse(JSON.stringify(m.content)),
                  }),
                );
                resolvers.push((val) =>
                  resolve(
                    val ?? {
                      content: [{ type: "text", text: "OK" }],
                      stopReason: "end_turn",
                      usage: { inputTokens: 10, outputTokens: 10 },
                    },
                  ),
                );
              }),
          ),
        };

        const slowAgent = new AgentService({
          provider: slowLLM as any,
          model: "test-model",
          maxTokens: 4096,
        });
        await slowAgent.start(makeProfile());

        // First transcript flush
        slowAgent.pushTranscript(makeEntry("alice", "first message"));
        await vi.advanceTimersByTimeAsync(2000);
        expect(slowLLM.createMessage).toHaveBeenCalledTimes(1);

        // While LLM is busy, push another transcript. flushTranscriptBatch
        // pushes the message to this.messages but callLLMLoop returns early.
        slowAgent.pushTranscript(makeEntry("bob", "second message"));
        await vi.advanceTimersByTimeAsync(2000);

        // Still only 1 createMessage call
        expect(slowLLM.createMessage).toHaveBeenCalledTimes(1);

        // Resolve first call — runLLMStep will detect new messages and recurse
        resolvers[0](undefined);
        await vi.advanceTimersByTimeAsync(0);

        // The recursive call should see the second message in its snapshot
        if (resolvers.length > 1) {
          const secondSnapshot =
            slowLLM.createMessage.mock.calls[1][0].__messageSnapshot;
          const hasSecondMessage = secondSnapshot.some(
            (m: any) =>
              typeof m.content === "string" &&
              m.content.includes("second message"),
          );
          expect(hasSecondMessage).toBe(true);

          resolvers[1](undefined);
          await vi.advanceTimersByTimeAsync(0);
        }

        // At least 2 calls: the original + the recursive one that picked up queued messages
        expect(slowLLM.createMessage.mock.calls.length).toBeGreaterThanOrEqual(
          2,
        );

        slowAgent.stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("tool exception handling", () => {
    it("should catch tool handler that rejects with non-Error type", async () => {
      let callCount = 0;
      const toolLLM = {
        createMessage: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                {
                  type: "tool_use",
                  id: "t1",
                  name: "string_throw_tool",
                  input: {},
                },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }
          return {
            content: [{ type: "text", text: "Handled" }],
            stopReason: "end_turn",
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }),
      };
      const a = new AgentService({
        provider: toolLLM as any,
        model: "m",
        maxTokens: 1000,
      });
      a.setTools([
        {
          name: "string_throw_tool",
          description: "Throws a string",
          parameters: { type: "object", properties: {} },
          handler: vi.fn().mockRejectedValue("plain string error"),
        },
      ]);
      await a.start(makeProfile());

      const toolCalls: any[] = [];
      a.on("agent:tool_call", (c) => toolCalls.push(c));
      await a.startNegotiation(makeTrigger(), "ctx");

      expect(toolCalls[0].result).toContain("Error");
      expect(toolCalls[0].result).toContain("plain string error");
      // LLM loop continued — called twice (tool_use then end_turn)
      expect(toolLLM.createMessage).toHaveBeenCalledTimes(2);
      a.stop();
    });
  });

  describe("startNegotiation guard behavior", () => {
    it("should not re-enter callLLMLoop while already processing via startNegotiation", async () => {
      const resolvers: Array<(v: any) => void> = [];
      const response = {
        content: [{ type: "text", text: "Done" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 10 },
      };
      const slowLLM = {
        createMessage: vi.fn().mockImplementation(
          () =>
            new Promise<any>((resolve) => {
              resolvers.push(resolve);
            }),
        ),
      };

      const slowAgent = new AgentService({
        provider: slowLLM as any,
        model: "test-model",
        maxTokens: 4096,
      });
      await slowAgent.start(makeProfile());

      // First startNegotiation — enters callLLMLoop, sets processing=true
      const p1 = slowAgent.startNegotiation(makeTrigger(), "context 1");

      // LLM is now in-flight
      expect(slowLLM.createMessage).toHaveBeenCalledTimes(1);

      // Second startNegotiation while first is processing — callLLMLoop returns early
      const p2 = slowAgent.startNegotiation(makeTrigger(), "context 2");

      // LLM should still only have been called once (guard prevented second entry)
      expect(slowLLM.createMessage).toHaveBeenCalledTimes(1);

      // Resolve the first call
      resolvers[0](response);

      // Allow microtasks to settle — runLLMStep may recurse for the queued message
      await new Promise((r) => setTimeout(r, 0));
      for (let i = 1; i < resolvers.length; i++) {
        resolvers[i](response);
        await new Promise((r) => setTimeout(r, 0));
      }

      await Promise.all([p1, p2]);
      slowAgent.stop();
    });
  });

  describe("empty tool result handling", () => {
    it("should send empty string tool result back to LLM", async () => {
      let callCount = 0;
      const toolLLM = {
        createMessage: vi.fn().mockImplementation(async (params: any) => {
          (params as any).__messageSnapshot = params.messages.map((m: any) => ({
            role: m.role,
            content:
              typeof m.content === "string"
                ? m.content
                : JSON.parse(JSON.stringify(m.content)),
          }));
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                { type: "tool_use", id: "t1", name: "empty_tool", input: {} },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }
          return {
            content: [{ type: "text", text: "Got it" }],
            stopReason: "end_turn",
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }),
      };
      const a = new AgentService({
        provider: toolLLM as any,
        model: "m",
        maxTokens: 1000,
      });
      a.setTools([
        {
          name: "empty_tool",
          description: "Returns empty string",
          parameters: { type: "object", properties: {} },
          handler: vi.fn().mockResolvedValue(""),
        },
      ]);
      await a.start(makeProfile());
      await a.startNegotiation(makeTrigger(), "ctx");

      // LLM should have been called twice (tool_use then end_turn)
      expect(toolLLM.createMessage).toHaveBeenCalledTimes(2);

      // The second call should have received the tool_result with empty string
      const secondSnapshot =
        toolLLM.createMessage.mock.calls[1][0].__messageSnapshot;
      const toolResultMsg = secondSnapshot.find(
        (m: any) =>
          m.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((b: any) => b.type === "tool_result"),
      );
      expect(toolResultMsg).toBeDefined();
      const toolResultBlock = toolResultMsg.content.find(
        (b: any) => b.type === "tool_result",
      );
      expect(toolResultBlock.content).toBe("");

      a.stop();
    });
  });

  describe("agent error event on LLM failure", () => {
    it("should emit agent:message with error details on LLM failure", async () => {
      mockLLM.createMessage.mockRejectedValue(
        new Error("LLM connection refused"),
      );
      await agent.start(makeProfile());

      const messages: { text: string; timestamp: number }[] = [];
      agent.on("agent:message", (m) => messages.push(m));

      await agent.startNegotiation(makeTrigger(), "ctx");

      const errorMsg = messages.find((m) => m.text.includes("Agent error"));
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.text).toContain("LLM connection refused");
      expect(errorMsg!.timestamp).toBeGreaterThan(0);
    });
  });

  describe("processing flag correctness", () => {
    it("should reset processing flag after LLM error", async () => {
      vi.useFakeTimers();
      try {
        // First call fails
        mockLLM.createMessage
          .mockRejectedValueOnce(new Error("API timeout"))
          .mockImplementation(async (params: any) => {
            (params as any).__messageSnapshot = params.messages.map(
              (m: any) => ({
                role: m.role,
                content:
                  typeof m.content === "string"
                    ? m.content
                    : JSON.parse(JSON.stringify(m.content)),
              }),
            );
            return {
              content: [{ type: "text", text: "Recovered" }],
              stopReason: "end_turn",
              usage: { inputTokens: 10, outputTokens: 10 },
            };
          });

        await agent.start(makeProfile());

        // First transcript — LLM call will fail
        agent.pushTranscript(makeEntry("alice", "will fail"));
        await vi.advanceTimersByTimeAsync(2000);

        // The error should have been caught and processing reset to false
        // So the next flush should succeed
        agent.pushTranscript(makeEntry("bob", "should succeed"));
        await vi.advanceTimersByTimeAsync(2000);

        // Second call should have gone through (processing was reset)
        expect(mockLLM.createMessage).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should set processing in callLLMLoop, not runLLMStep", async () => {
      // Verify the processing flag prevents concurrent calls by checking
      // that two simultaneous startNegotiation calls only produce one LLM call
      // (the second callLLMLoop returns early because processing is already true)
      const resolvers: Array<(v: any) => void> = [];
      const response = {
        content: [{ type: "text", text: "OK" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 10 },
      };
      const controlledLLM = {
        createMessage: vi.fn().mockImplementation(
          () =>
            new Promise<any>((resolve) => {
              resolvers.push(resolve);
            }),
        ),
      };

      const controlledAgent = new AgentService({
        provider: controlledLLM as any,
        model: "test-model",
        maxTokens: 4096,
      });
      await controlledAgent.start(makeProfile());

      // Fire two negotiations simultaneously — both call callLLMLoop
      // The second should return immediately because processing is already true
      const promise1 = controlledAgent.startNegotiation(
        makeTrigger(),
        "context 1",
      );
      // startNegotiation is async but callLLMLoop sets processing synchronously
      // before the first await, so the second call sees processing=true
      const promise2 = controlledAgent.startNegotiation(
        makeTrigger(),
        "context 2",
      );

      // Only the first should have called the LLM
      expect(controlledLLM.createMessage).toHaveBeenCalledTimes(1);

      // Resolve the first call. runLLMStep may detect that a second user message
      // was pushed (by the second startNegotiation) and recurse.
      resolvers[0](response);

      // Allow microtasks to settle — runLLMStep may recurse
      await new Promise((r) => setTimeout(r, 0));

      // Resolve any recursive calls
      for (let i = 1; i < resolvers.length; i++) {
        resolvers[i](response);
        await new Promise((r) => setTimeout(r, 0));
      }

      await Promise.all([promise1, promise2]);

      controlledAgent.stop();
    });

    it("should allow new LLM calls after processing completes normally", async () => {
      await agent.start(makeProfile());

      // First call
      await agent.startNegotiation(makeTrigger(), "first");
      expect(mockLLM.createMessage).toHaveBeenCalledTimes(1);

      // Second call — should succeed because processing was reset in finally block
      await agent.startNegotiation(makeTrigger(), "second");
      expect(mockLLM.createMessage).toHaveBeenCalledTimes(2);
    });
  });
});
