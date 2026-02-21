import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTools } from "../src/tools.js";
import type { ToolDependencies } from "../src/tools.js";
import type { ToolDefinition } from "../src/interfaces.js";

function makeDeps(overrides: Partial<ToolDependencies> = {}): ToolDependencies {
  return {
    payment: {
      executePayment: vi
        .fn()
        .mockResolvedValue({ success: true, paymentIntentId: "pi_123" }),
      createEscrowHold: vi.fn().mockResolvedValue({
        holdId: "hold_123",
        amount: 5000,
        currency: "gbp",
        status: "held",
        paymentIntentId: "pi_hold",
        recipientAccountId: "acct_bob",
        createdAt: Date.now(),
      }),
      captureEscrow: vi
        .fn()
        .mockResolvedValue({ success: true, paymentIntentId: "hold_123" }),
      releaseEscrow: vi
        .fn()
        .mockResolvedValue({ success: true, paymentIntentId: "hold_123" }),
    },
    monzo: {
      setAccessToken: vi.fn(),
      isAuthenticated: vi.fn().mockReturnValue(true),
      getBalance: vi.fn().mockResolvedValue({
        balance: 150000,
        total_balance: 150000,
        currency: "GBP",
        spend_today: -5000,
      }),
      getTransactions: vi.fn().mockResolvedValue([]),
    },
    negotiation: {
      createNegotiation: vi
        .fn()
        .mockReturnValue({ id: "neg_123", status: "proposed" }),
      handleAgentMessage: vi.fn(),
      getNegotiation: vi.fn(),
      getActiveNegotiation: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      removeAllListeners: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      listeners: vi.fn().mockReturnValue([]),
      listenerCount: vi.fn().mockReturnValue(0),
      eventNames: vi.fn().mockReturnValue([]),
    } as any,
    panelEmitter: {
      registerSocket: vi.fn(),
      unregisterSocket: vi.fn(),
      setRoom: vi.fn(),
      sendToUser: vi.fn(),
      broadcast: vi.fn(),
    },
    userId: "alice",
    otherUserId: "bob",
    displayName: "Alice",
    recipientAccountId: "acct_bob",
    roomId: "room-1",
    ...overrides,
  };
}

describe("Tools Module", () => {
  let tools: ToolDefinition[];
  let deps: ToolDependencies;

  beforeEach(() => {
    deps = makeDeps();
    tools = buildTools(deps);
  });

  it("should build 8 tools", () => {
    expect(tools.length).toBe(8);
  });

  it("should include all expected tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain("analyze_and_propose");
    expect(names).toContain("evaluate_proposal");
    expect(names).toContain("execute_payment");
    expect(names).toContain("create_escrow_hold");
    expect(names).toContain("capture_escrow");
    expect(names).toContain("release_escrow");
    expect(names).toContain("check_balance");
    expect(names).toContain("send_message_to_user");
  });

  describe("analyze_and_propose", () => {
    it("should create a negotiation with line items", async () => {
      const tool = tools.find((t) => t.name === "analyze_and_propose")!;
      const result = await tool.handler({
        summary: "Fix boiler",
        lineItems: [
          { description: "Labour", amount: 15000, type: "immediate" },
          {
            description: "Parts",
            amount: 5000,
            type: "escrow",
            condition: "On completion",
          },
        ],
        currency: "gbp",
        conditions: ["Within 7 days"],
      });

      expect(deps.negotiation.createNegotiation).toHaveBeenCalledOnce();
      expect(result).toContain("Proposal created");
      expect(result).toContain("£200.00"); // 20000 pence
    });

    it("should handle errors gracefully", async () => {
      (deps.negotiation.createNegotiation as any).mockImplementation(() => {
        throw new Error("Already in progress");
      });
      const tool = tools.find((t) => t.name === "analyze_and_propose")!;
      const result = await tool.handler({
        summary: "Test",
        lineItems: [{ description: "X", amount: 100, type: "immediate" }],
        currency: "gbp",
      });
      expect(result).toContain("Error");
    });
  });

  describe("evaluate_proposal", () => {
    it("should accept a proposal", async () => {
      const tool = tools.find((t) => t.name === "evaluate_proposal")!;
      const result = await tool.handler({
        negotiationId: "neg_1",
        decision: "accept",
      });

      expect(deps.negotiation.handleAgentMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent_accept" }),
      );
      expect(result).toContain("accepted");
    });

    it("should reject a proposal with reason", async () => {
      const tool = tools.find((t) => t.name === "evaluate_proposal")!;
      const result = await tool.handler({
        negotiationId: "neg_1",
        decision: "reject",
        reason: "Too expensive",
      });

      expect(deps.negotiation.handleAgentMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent_reject",
          reason: "Too expensive",
        }),
      );
      expect(result).toContain("rejected");
    });

    it("should counter with a new proposal", async () => {
      const tool = tools.find((t) => t.name === "evaluate_proposal")!;
      const result = await tool.handler({
        negotiationId: "neg_1",
        decision: "counter",
        reason: "Lower price",
        counterProposal: {
          summary: "Counter offer",
          lineItems: [
            { description: "Labour", amount: 10000, type: "immediate" },
          ],
          currency: "gbp",
          conditions: [],
        },
      });

      expect(deps.negotiation.handleAgentMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent_counter" }),
      );
      expect(result).toContain("Counter-proposal sent");
    });

    it("should error when countering without counterProposal", async () => {
      const tool = tools.find((t) => t.name === "evaluate_proposal")!;
      const result = await tool.handler({
        negotiationId: "neg_1",
        decision: "counter",
      });
      expect(result).toContain("Error");
    });
  });

  describe("execute_payment", () => {
    it("should execute a payment", async () => {
      const tool = tools.find((t) => t.name === "execute_payment")!;
      const result = await tool.handler({
        amount: 15000,
        currency: "gbp",
        description: "Boiler repair",
      });

      expect(deps.payment.executePayment).toHaveBeenCalledWith({
        amount: 15000,
        currency: "gbp",
        description: "Boiler repair",
        recipientAccountId: "acct_bob",
      });
      expect(result).toContain("Payment successful");
    });

    it("should report failed payment", async () => {
      (deps.payment.executePayment as any).mockResolvedValue({
        success: false,
        error: "Insufficient funds",
      });
      const tool = tools.find((t) => t.name === "execute_payment")!;
      const result = await tool.handler({
        amount: 15000,
        currency: "gbp",
        description: "Test",
      });
      expect(result).toContain("Payment failed");
    });
  });

  describe("create_escrow_hold", () => {
    it("should create an escrow hold", async () => {
      const tool = tools.find((t) => t.name === "create_escrow_hold")!;
      const result = await tool.handler({
        amount: 5000,
        currency: "gbp",
        description: "Parts deposit",
      });
      expect(result).toContain("Escrow hold created");
      expect(result).toContain("£50.00");
    });
  });

  describe("capture_escrow", () => {
    it("should capture escrow (full)", async () => {
      const tool = tools.find((t) => t.name === "capture_escrow")!;
      const result = await tool.handler({ holdId: "hold_123" });
      expect(result).toContain("Escrow captured");
      expect(result).toContain("full amount");
    });

    it("should capture escrow (partial)", async () => {
      const tool = tools.find((t) => t.name === "capture_escrow")!;
      const result = await tool.handler({ holdId: "hold_123", amount: 3000 });
      expect(result).toContain("£30.00");
    });
  });

  describe("release_escrow", () => {
    it("should release escrow", async () => {
      const tool = tools.find((t) => t.name === "release_escrow")!;
      const result = await tool.handler({ holdId: "hold_123" });
      expect(result).toContain("Escrow released");
    });
  });

  describe("check_balance", () => {
    it("should return balance when Monzo connected", async () => {
      const tool = tools.find((t) => t.name === "check_balance")!;
      const result = await tool.handler({});
      expect(result).toContain("Balance: £1500.00");
      expect(result).toContain("Spend today: £50.00");
    });

    it("should return unavailable when Monzo not connected", async () => {
      deps = makeDeps({ monzo: null });
      tools = buildTools(deps);
      const tool = tools.find((t) => t.name === "check_balance")!;
      const result = await tool.handler({});
      expect(result).toContain("Monzo not connected");
    });
  });

  describe("send_message_to_user", () => {
    it("should send message to panel", async () => {
      const tool = tools.find((t) => t.name === "send_message_to_user")!;
      const result = await tool.handler({ text: "Processing your request" });
      expect(deps.panelEmitter.sendToUser).toHaveBeenCalledWith(
        "alice",
        expect.objectContaining({
          panel: "agent",
          text: "Processing your request",
        }),
      );
      expect(result).toContain("Message sent");
    });
  });
});
