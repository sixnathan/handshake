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
});
