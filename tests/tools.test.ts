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
    peer: {
      send: vi.fn(),
      getOtherUserId: vi.fn().mockReturnValue("bob"),
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
    document: {
      generateDocument: vi.fn().mockResolvedValue({
        id: "doc_1",
        title: "Agreement",
        content: "# Agreement",
        negotiationId: "neg_123",
        parties: [],
        terms: {} as any,
        signatures: [],
        status: "pending_signatures",
        createdAt: Date.now(),
      }),
      signDocument: vi.fn(),
      isFullySigned: vi.fn().mockReturnValue(false),
      getDocument: vi.fn(),
      updateMilestones: vi.fn(),
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
    session: {
      getStatus: vi.fn().mockReturnValue("active"),
      setStatus: vi.fn(),
      addTranscript: vi.fn(),
      getTranscripts: vi.fn().mockReturnValue([]),
      getTranscriptText: vi.fn().mockReturnValue(""),
      getRecentTranscriptText: vi.fn().mockReturnValue(""),
      reset: vi.fn(),
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
    userId: "alice",
    otherUserId: "bob",
    displayName: "Alice",
    otherDisplayName: "Bob",
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

  it("should build 11 tools", () => {
    expect(tools.length).toBe(11);
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
    expect(names).toContain("check_transactions");
    expect(names).toContain("send_message_to_user");
    expect(names).toContain("generate_document");
    expect(names).toContain("complete_milestone");
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

  describe("check_transactions", () => {
    it("should return transactions when Monzo connected", async () => {
      (deps.monzo!.getTransactions as any).mockResolvedValue([
        {
          id: "tx_1",
          amount: -4500,
          currency: "GBP",
          description: "Coffee Shop",
          created: "2026-02-21T10:30:00Z",
          merchant: { name: "Costa Coffee" },
          category: "eating_out",
        },
        {
          id: "tx_2",
          amount: 100000,
          currency: "GBP",
          description: "Salary",
          created: "2026-02-20T09:00:00Z",
          merchant: null,
          category: "income",
        },
      ]);
      const tool = tools.find((t) => t.name === "check_transactions")!;
      const result = await tool.handler({ days: 7 });
      expect(deps.monzo!.getTransactions).toHaveBeenCalledWith(7);
      expect(result).toContain("Costa Coffee");
      expect(result).toContain("Salary");
      expect(result).toContain("Net:");
    });

    it("should return unavailable when Monzo not connected", async () => {
      deps = makeDeps({ monzo: null });
      tools = buildTools(deps);
      const tool = tools.find((t) => t.name === "check_transactions")!;
      const result = await tool.handler({});
      expect(result).toContain("Monzo not connected");
    });

    it("should handle empty transaction list", async () => {
      const tool = tools.find((t) => t.name === "check_transactions")!;
      const result = await tool.handler({ days: 30 });
      expect(result).toContain("No transactions found");
    });

    it("should clamp days to 1-90 range", async () => {
      (deps.monzo!.getTransactions as any).mockResolvedValue([]);
      const tool = tools.find((t) => t.name === "check_transactions")!;

      await tool.handler({ days: 200 });
      expect(deps.monzo!.getTransactions).toHaveBeenCalledWith(90);

      await tool.handler({ days: -5 });
      expect(deps.monzo!.getTransactions).toHaveBeenCalledWith(1);
    });

    it("should default days to 30 when not provided", async () => {
      (deps.monzo!.getTransactions as any).mockResolvedValue([]);
      const tool = tools.find((t) => t.name === "check_transactions")!;
      await tool.handler({});
      expect(deps.monzo!.getTransactions).toHaveBeenCalledWith(30);
    });

    it("should handle Monzo API error gracefully", async () => {
      (deps.monzo!.getTransactions as any).mockRejectedValue(
        new Error("API rate limited"),
      );
      const tool = tools.find((t) => t.name === "check_transactions")!;
      const result = await tool.handler({ days: 7 });
      expect(result).toContain("Failed to fetch transactions");
      expect(result).toContain("API rate limited");
    });

    it("should show max 20 transactions even with more results", async () => {
      const manyTx = Array.from({ length: 30 }, (_, i) => ({
        id: `tx_${i}`,
        amount: -(i + 1) * 100,
        currency: "GBP",
        description: `Transaction ${i}`,
        created: "2026-02-21T10:00:00Z",
        merchant: { name: `Merchant ${i}` },
        category: "general",
      }));
      (deps.monzo!.getTransactions as any).mockResolvedValue(manyTx);
      const tool = tools.find((t) => t.name === "check_transactions")!;
      const result = await tool.handler({ days: 30 });
      expect(result).toContain("30 transactions, showing first 20");
      // Should not contain Merchant 20 (0-indexed, so 21st item)
      expect(result).not.toContain("Merchant 20");
    });

    it("should use description as fallback when merchant is null", async () => {
      (deps.monzo!.getTransactions as any).mockResolvedValue([
        {
          id: "tx_1",
          amount: 50000,
          currency: "GBP",
          description: "Bank Transfer",
          created: "2026-02-21T10:00:00Z",
          merchant: null,
          category: "transfers",
        },
      ]);
      const tool = tools.find((t) => t.name === "check_transactions")!;
      const result = await tool.handler({});
      expect(result).toContain("Bank Transfer");
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

    it("should handle send errors gracefully", async () => {
      (deps.panelEmitter.sendToUser as any).mockImplementation(() => {
        throw new Error("Socket closed");
      });
      const tool = tools.find((t) => t.name === "send_message_to_user")!;
      const result = await tool.handler({ text: "Test" });
      expect(result).toContain("Error sending message");
    });
  });

  describe("analyze_and_propose edge cases", () => {
    it("should send proposal to peer", async () => {
      const tool = tools.find((t) => t.name === "analyze_and_propose")!;
      await tool.handler({
        summary: "Fix boiler",
        lineItems: [
          { description: "Labour", amount: 15000, type: "immediate" },
        ],
        currency: "gbp",
      });
      expect(deps.peer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent_proposal",
          negotiationId: "neg_123",
        }),
      );
    });

    it("should handle empty conditions array", async () => {
      const tool = tools.find((t) => t.name === "analyze_and_propose")!;
      const result = await tool.handler({
        summary: "Simple job",
        lineItems: [{ description: "Work", amount: 5000, type: "immediate" }],
        currency: "gbp",
      });
      expect(result).toContain("Proposal created");
    });
  });

  describe("evaluate_proposal edge cases", () => {
    it("should handle invalid decision", async () => {
      const tool = tools.find((t) => t.name === "evaluate_proposal")!;
      const result = await tool.handler({
        negotiationId: "neg_1",
        decision: "invalid_decision",
      });
      expect(result).toContain("Error");
      expect(result).toContain("invalid_decision");
    });

    it("should handle negotiation service errors", async () => {
      (deps.negotiation.handleAgentMessage as any).mockImplementation(() => {
        throw new Error("Negotiation expired");
      });
      const tool = tools.find((t) => t.name === "evaluate_proposal")!;
      const result = await tool.handler({
        negotiationId: "neg_1",
        decision: "accept",
      });
      expect(result).toContain("Error evaluating proposal");
    });
  });

  describe("escrow error paths", () => {
    it("should handle escrow hold creation failure", async () => {
      (deps.payment.createEscrowHold as any).mockRejectedValue(
        new Error("Card declined"),
      );
      const tool = tools.find((t) => t.name === "create_escrow_hold")!;
      const result = await tool.handler({
        amount: 5000,
        currency: "gbp",
        description: "Test",
      });
      expect(result).toContain("Error creating escrow hold");
    });

    it("should handle capture escrow failure", async () => {
      (deps.payment.captureEscrow as any).mockResolvedValue({
        success: false,
        error: "Hold expired",
      });
      const tool = tools.find((t) => t.name === "capture_escrow")!;
      const result = await tool.handler({ holdId: "hold_expired" });
      expect(result).toContain("Escrow capture failed");
    });

    it("should handle release escrow failure", async () => {
      (deps.payment.releaseEscrow as any).mockResolvedValue({
        success: false,
        error: "Already captured",
      });
      const tool = tools.find((t) => t.name === "release_escrow")!;
      const result = await tool.handler({ holdId: "hold_captured" });
      expect(result).toContain("Escrow release failed");
    });

    it("should handle capture escrow exception", async () => {
      (deps.payment.captureEscrow as any).mockRejectedValue(
        new Error("Network error"),
      );
      const tool = tools.find((t) => t.name === "capture_escrow")!;
      const result = await tool.handler({ holdId: "hold_123" });
      expect(result).toContain("Error capturing escrow");
    });

    it("should handle release escrow exception", async () => {
      (deps.payment.releaseEscrow as any).mockRejectedValue(
        new Error("Network error"),
      );
      const tool = tools.find((t) => t.name === "release_escrow")!;
      const result = await tool.handler({ holdId: "hold_123" });
      expect(result).toContain("Error releasing escrow");
    });
  });

  describe("check_balance error path", () => {
    it("should handle Monzo API error gracefully", async () => {
      (deps.monzo!.getBalance as any).mockRejectedValue(
        new Error("Token expired"),
      );
      const tool = tools.find((t) => t.name === "check_balance")!;
      const result = await tool.handler({});
      expect(result).toContain("Failed to check balance");
      expect(result).toContain("Token expired");
    });
  });

  describe("payment exception path", () => {
    it("should handle payment exception gracefully", async () => {
      (deps.payment.executePayment as any).mockRejectedValue(
        new Error("Stripe down"),
      );
      const tool = tools.find((t) => t.name === "execute_payment")!;
      const result = await tool.handler({
        amount: 1000,
        currency: "gbp",
        description: "Test",
      });
      expect(result).toContain("Error executing payment");
      expect(result).toContain("Stripe down");
    });
  });

  describe("complete_milestone", () => {
    it("should inform user to verify instead of capturing escrow", async () => {
      const docWithMilestones = {
        id: "doc_1",
        title: "Agreement",
        content: "# Agreement",
        negotiationId: "neg_123",
        parties: [],
        terms: {} as any,
        signatures: [],
        status: "fully_signed",
        createdAt: Date.now(),
        milestones: [
          {
            id: "ms_1",
            documentId: "doc_1",
            lineItemIndex: 0,
            description: "Complete repair",
            amount: 5000,
            condition: "Repair finished",
            status: "pending",
            escrowHoldId: "hold_123",
          },
        ],
      };
      (deps.document.getDocument as any).mockReturnValue(docWithMilestones);

      const tool = tools.find((t) => t.name === "complete_milestone")!;
      const result = await tool.handler({
        milestoneId: "ms_1",
        documentId: "doc_1",
      });

      expect(deps.payment.captureEscrow).not.toHaveBeenCalled();
      expect(deps.document.updateMilestones).not.toHaveBeenCalled();
      expect(deps.panelEmitter.broadcast).toHaveBeenCalledWith(
        deps.roomId,
        expect.objectContaining({
          panel: "agent",
          text: expect.stringContaining("ready for completion"),
        }),
      );
      expect(result).toContain("pending bilateral confirmation");
    });
  });

  describe("generate_document", () => {
    it("should generate a document from an accepted negotiation", async () => {
      const acceptedNeg = {
        id: "neg_123",
        roomId: "room-1",
        status: "accepted",
        initiator: "alice",
        responder: "bob",
        currentProposal: {
          summary: "Fix boiler",
          lineItems: [
            { description: "Labour", amount: 15000, type: "immediate" },
          ],
          totalAmount: 15000,
          currency: "gbp",
          conditions: [],
          expiresAt: Date.now() + 30000,
        },
        rounds: [],
        maxRounds: 5,
        roundTimeoutMs: 30000,
        totalTimeoutMs: 120000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      (deps.negotiation.getNegotiation as any).mockReturnValue(acceptedNeg);
      (deps.document.getDocument as any).mockReturnValue({
        ...((deps.document.generateDocument as any).mock?.results?.[0]
          ?.value ?? {
          id: "doc_1",
          title: "Agreement",
          content: "# Agreement",
          negotiationId: "neg_123",
          parties: [],
          terms: {} as any,
          signatures: [],
          status: "pending_signatures",
          createdAt: Date.now(),
        }),
      });

      const tool = tools.find((t) => t.name === "generate_document")!;
      const result = await tool.handler({ negotiationId: "neg_123" });

      expect(deps.negotiation.getNegotiation).toHaveBeenCalledWith("neg_123");
      expect(deps.document.generateDocument).toHaveBeenCalledWith(
        acceptedNeg,
        acceptedNeg.currentProposal,
        expect.arrayContaining([
          expect.objectContaining({ userId: "alice" }),
          expect.objectContaining({ userId: "bob" }),
        ]),
        expect.any(String),
      );
      expect(result).toContain("Document generated");
    });
  });

  describe("Stripe account validation", () => {
    it("should reject execute_payment when recipientAccountId is empty", async () => {
      deps = makeDeps({ recipientAccountId: "" });
      tools = buildTools(deps);
      const tool = tools.find((t) => t.name === "execute_payment")!;
      const result = await tool.handler({
        amount: 15000,
        currency: "gbp",
        description: "Test",
      });
      expect(result).toContain("Recipient has no Stripe account connected");
      expect(deps.payment.executePayment).not.toHaveBeenCalled();
    });

    it("should reject create_escrow_hold when recipientAccountId is empty", async () => {
      deps = makeDeps({ recipientAccountId: "" });
      tools = buildTools(deps);
      const tool = tools.find((t) => t.name === "create_escrow_hold")!;
      const result = await tool.handler({
        amount: 5000,
        currency: "gbp",
        description: "Test",
      });
      expect(result).toContain("Recipient has no Stripe account connected");
      expect(deps.payment.createEscrowHold).not.toHaveBeenCalled();
    });

    it("should allow execute_payment when recipientAccountId is set", async () => {
      const tool = tools.find((t) => t.name === "execute_payment")!;
      const result = await tool.handler({
        amount: 15000,
        currency: "gbp",
        description: "Test",
      });
      expect(result).toContain("Payment successful");
      expect(deps.payment.executePayment).toHaveBeenCalled();
    });

    it("should allow create_escrow_hold when recipientAccountId is set", async () => {
      const tool = tools.find((t) => t.name === "create_escrow_hold")!;
      const result = await tool.handler({
        amount: 5000,
        currency: "gbp",
        description: "Test",
      });
      expect(result).toContain("Escrow hold created");
      expect(deps.payment.createEscrowHold).toHaveBeenCalled();
    });
  });

  describe("analyze_and_propose with mixed line item types", () => {
    it("should handle immediate, escrow, and conditional line items together", async () => {
      const tool = tools.find((t) => t.name === "analyze_and_propose")!;
      const result = await tool.handler({
        summary: "Full plumbing job",
        lineItems: [
          { description: "Callout fee", amount: 5000, type: "immediate" },
          {
            description: "Pipe repair",
            amount: 15000,
            type: "escrow",
            condition: "On completion of repair",
          },
          {
            description: "Satisfaction bonus",
            amount: 3000,
            type: "conditional",
            condition: "If customer is satisfied",
          },
        ],
        currency: "gbp",
        conditions: ["Work within 48 hours"],
      });

      expect(deps.negotiation.createNegotiation).toHaveBeenCalledWith(
        "alice",
        "bob",
        expect.objectContaining({
          lineItems: expect.arrayContaining([
            expect.objectContaining({
              type: "immediate",
              amount: 5000,
            }),
            expect.objectContaining({
              type: "escrow",
              amount: 15000,
              condition: "On completion of repair",
            }),
            expect.objectContaining({
              type: "conditional",
              amount: 3000,
              condition: "If customer is satisfied",
            }),
          ]),
          totalAmount: 23000,
        }),
      );
      expect(result).toContain("Proposal created");
      expect(result).toContain("£230.00"); // 23000 pence
    });
  });
});
