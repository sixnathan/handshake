import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildVerificationTools } from "../src/verification-tools.js";
import type { VerificationToolDependencies } from "../src/verification-tools.js";
import type {
  VerificationEvidence,
  Milestone,
  LineItem,
  MilestoneId,
  VerificationId,
} from "../src/types.js";

function makeDeps(
  overrides: Partial<VerificationToolDependencies> = {},
): VerificationToolDependencies {
  return {
    milestone: {
      id: "ms_test_0" as MilestoneId,
      documentId: "doc_test",
      lineItemIndex: 0,
      description: "Boiler repair completed",
      amount: 50000,
      condition: "Boiler fully operational and tested",
      status: "pending",
      escrowHoldId: "hold_test",
    },
    lineItem: {
      description: "Boiler repair",
      amount: 50000,
      type: "escrow",
      condition: "Boiler fully operational",
      minAmount: 30000,
      maxAmount: 80000,
      factors: [
        {
          name: "complexity",
          description: "How complex the repair is",
          impact: "increases",
        },
        {
          name: "parts_needed",
          description: "Whether new parts are needed",
          impact: "increases",
        },
      ],
    },
    verificationId: "ver_test_123" as VerificationId,
    monzo: null,
    phoneService: {
      isAvailable: vi.fn().mockReturnValue(false),
      verify: vi.fn().mockResolvedValue({
        success: true,
        confirmed: true,
        callId: "sim_123",
        transcript: "Simulated",
        details: "DEMO MODE: Simulated call",
      }),
    } as any,
    panelEmitter: {
      registerSocket: vi.fn(),
      unregisterSocket: vi.fn(),
      setRoom: vi.fn(),
      sendToUser: vi.fn(),
      broadcast: vi.fn(),
    },
    requestedBy: "user_alice",
    roomId: "room_1",
    phoneNumber: undefined,
    contactName: undefined,
    onEvidence: vi.fn(),
    onVerdict: vi.fn(),
    ...overrides,
  };
}

describe("Verification Tools", () => {
  let deps: VerificationToolDependencies;
  let tools: ReturnType<typeof buildVerificationTools>;

  beforeEach(() => {
    deps = makeDeps();
    tools = buildVerificationTools(deps);
  });

  function findTool(name: string) {
    return tools.find((t) => t.name === name)!;
  }

  describe("assess_condition", () => {
    it("should record factor assessment evidence", async () => {
      const tool = findTool("assess_condition");
      const result = await tool.handler({
        conditionName: "Pipe complexity",
        assessment: "met",
        details: "Simple repair, single pipe",
        impactOnPrice: "decreases",
      });

      expect(result).toContain("Pipe complexity");
      expect(result).toContain("met");
      expect(deps.onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "factor_assessment",
          description: "Pipe complexity",
          result: "confirmed",
        }),
      );
    });

    it("should map 'not_met' to 'denied' result", async () => {
      const tool = findTool("assess_condition");
      await tool.handler({
        conditionName: "Quality check",
        assessment: "not_met",
        details: "Work incomplete",
      });

      expect(deps.onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          result: "denied",
        }),
      );
    });

    it("should map 'partially_met' to 'inconclusive' result", async () => {
      const tool = findTool("assess_condition");
      await tool.handler({
        conditionName: "Parts installed",
        assessment: "partially_met",
        details: "Some parts installed",
      });

      expect(deps.onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          result: "inconclusive",
        }),
      );
    });
  });

  describe("phone_verify", () => {
    it("should skip when no phone number provided", async () => {
      const tool = findTool("phone_verify");
      const result = await tool.handler({
        questions: ["Was the work completed?"],
      });

      expect(result).toContain("No phone number provided");
      expect(deps.phoneService.verify).not.toHaveBeenCalled();
    });

    it("should call phone service when phone number is provided", async () => {
      deps = makeDeps({
        phoneNumber: "+447123456789",
        contactName: "John",
        phoneService: {
          isAvailable: vi.fn().mockReturnValue(false),
          verify: vi.fn().mockResolvedValue({
            success: true,
            confirmed: true,
            callId: "sim_456",
            transcript: "Test transcript",
            details: "DEMO MODE: confirmed",
          }),
        } as any,
      });
      tools = buildVerificationTools(deps);
      const tool = findTool("phone_verify");

      const result = await tool.handler({
        questions: ["Is the work done?"],
      });

      expect(result).toContain("CONFIRMED");
      expect(deps.phoneService.verify).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: "+447123456789",
          contactName: "John",
        }),
      );
      expect(deps.onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "phone_call",
          result: "confirmed",
        }),
      );
    });

    it("should require at least one question", async () => {
      deps = makeDeps({ phoneNumber: "+447000000000" });
      tools = buildVerificationTools(deps);
      const tool = findTool("phone_verify");

      const result = await tool.handler({ questions: [] });
      expect(result).toContain("at least one verification question");
    });
  });

  describe("record_self_attestation", () => {
    it("should record high confidence as confirmed", async () => {
      const tool = findTool("record_self_attestation");
      const result = await tool.handler({
        attestation: "I confirm the work has been completed",
        confidence: "high",
      });

      expect(result).toContain("high confidence");
      expect(deps.onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "self_attestation",
          result: "confirmed",
        }),
      );
    });

    it("should record low confidence as denied", async () => {
      const tool = findTool("record_self_attestation");
      await tool.handler({
        attestation: "I'm not sure if work is complete",
        confidence: "low",
      });

      expect(deps.onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          result: "denied",
        }),
      );
    });
  });

  describe("check_payment_history", () => {
    it("should return unavailable when monzo is null", async () => {
      const tool = findTool("check_payment_history");
      const result = await tool.handler({
        searchTerms: ["plumber"],
      });

      expect(result).toContain("Monzo not connected");
    });

    it("should search transactions and record evidence when monzo is connected", async () => {
      const mockMonzo = {
        setAccessToken: vi.fn(),
        isAuthenticated: vi.fn().mockReturnValue(true),
        getBalance: vi.fn(),
        getTransactions: vi.fn().mockResolvedValue([
          {
            id: "tx_1",
            amount: -5000,
            currency: "GBP",
            description: "Plumbing Parts Ltd",
            created: "2026-02-20T10:00:00Z",
            merchant: { name: "Plumbing Parts Ltd" },
            category: "shopping",
          },
        ]),
      };
      deps = makeDeps({ monzo: mockMonzo });
      tools = buildVerificationTools(deps);

      const tool = findTool("check_payment_history");
      const result = await tool.handler({
        searchTerms: ["plumbing"],
        days: 14,
      });

      expect(result).toContain("1 related transactions");
      expect(result).toContain("Plumbing Parts Ltd");
      expect(deps.onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "payment_history",
          result: "confirmed",
        }),
      );
    });

    it("should handle no matching transactions", async () => {
      const mockMonzo = {
        setAccessToken: vi.fn(),
        isAuthenticated: vi.fn().mockReturnValue(true),
        getBalance: vi.fn(),
        getTransactions: vi.fn().mockResolvedValue([
          {
            id: "tx_1",
            amount: -2000,
            currency: "GBP",
            description: "Coffee shop",
            created: "2026-02-20T10:00:00Z",
            merchant: { name: "Coffee shop" },
            category: "eating_out",
          },
        ]),
      };
      deps = makeDeps({ monzo: mockMonzo });
      tools = buildVerificationTools(deps);

      const tool = findTool("check_payment_history");
      const result = await tool.handler({
        searchTerms: ["boiler"],
      });

      expect(result).toContain("No transactions matching");
      expect(deps.onEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          result: "not_applicable",
        }),
      );
    });
  });

  describe("send_verification_update", () => {
    it("should send panel message to user", async () => {
      const tool = findTool("send_verification_update");
      const result = await tool.handler({
        step: "classifying",
        message: "Classifying milestone type...",
      });

      expect(result).toBe("Progress update sent.");
      expect(deps.panelEmitter.sendToUser).toHaveBeenCalledWith(
        "user_alice",
        expect.objectContaining({
          panel: "verification",
          step: "classifying",
          status: "in_progress",
          details: "Classifying milestone type...",
        }),
      );
    });
  });

  describe("submit_verdict", () => {
    it("should call onVerdict with passed status", async () => {
      const tool = findTool("submit_verdict");
      const result = await tool.handler({
        status: "passed",
        reasoning: "All conditions met",
        recommendedAmount: 45000,
      });

      expect(result).toContain("passed");
      expect(deps.onVerdict).toHaveBeenCalledWith({
        status: "passed",
        reasoning: "All conditions met",
        recommendedAmount: 45000,
        evidence: [],
      });
    });

    it("should reject amount below minAmount", async () => {
      const tool = findTool("submit_verdict");
      const result = await tool.handler({
        status: "passed",
        reasoning: "Done",
        recommendedAmount: 10000, // below minAmount of 30000
      });

      expect(result).toContain("below minAmount");
    });

    it("should reject amount above maxAmount", async () => {
      const tool = findTool("submit_verdict");
      const result = await tool.handler({
        status: "passed",
        reasoning: "Done",
        recommendedAmount: 100000, // above maxAmount of 80000
      });

      expect(result).toContain("exceeds maxAmount");
    });

    it("should accumulate evidence from previous tool calls", async () => {
      // Call assess_condition first
      const assessTool = findTool("assess_condition");
      await assessTool.handler({
        conditionName: "Test factor",
        assessment: "met",
        details: "Factor confirmed",
      });

      // Then submit verdict — should include the evidence
      const verdictTool = findTool("submit_verdict");
      await verdictTool.handler({
        status: "passed",
        reasoning: "All good",
        recommendedAmount: 50000,
      });

      expect(deps.onVerdict).toHaveBeenCalledWith(
        expect.objectContaining({
          evidence: expect.arrayContaining([
            expect.objectContaining({
              type: "factor_assessment",
              description: "Test factor",
            }),
          ]),
        }),
      );
    });

    it("should accept verdict without recommendedAmount for fixed-price items", async () => {
      deps = makeDeps({
        lineItem: {
          description: "Callout fee",
          amount: 5000,
          type: "immediate",
        },
      });
      tools = buildVerificationTools(deps);

      const tool = findTool("submit_verdict");
      const result = await tool.handler({
        status: "passed",
        reasoning: "Service completed",
      });

      expect(result).toContain("passed");
      expect(deps.onVerdict).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "passed",
          recommendedAmount: undefined,
        }),
      );
    });

    it("should handle disputed verdict", async () => {
      const tool = findTool("submit_verdict");
      await tool.handler({
        status: "disputed",
        reasoning: "Conflicting evidence",
      });

      expect(deps.onVerdict).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "disputed",
        }),
      );
    });
  });
});
