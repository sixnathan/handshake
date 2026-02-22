import { describe, it, expect, vi, beforeEach } from "vitest";
import { VerificationService } from "../src/services/verification.js";
import type {
  LegalDocument,
  Milestone,
  LineItem,
  MilestoneId,
  DocumentId,
  NegotiationId,
  VerificationResult,
} from "../src/types.js";
import type { ILLMProvider } from "../src/providers/provider.js";
import type { LLMResponse, LLMContentBlock } from "../src/providers/types.js";

function makeDocument(): LegalDocument {
  return {
    id: "doc_test" as DocumentId,
    title: "Service Agreement",
    content: "# Agreement\nBoiler repair service",
    negotiationId: "neg_test" as NegotiationId,
    parties: [
      { userId: "alice", name: "Alice", role: "Customer" },
      { userId: "bob", name: "Bob", role: "Plumber" },
    ],
    terms: {
      summary: "Boiler repair",
      lineItems: [
        {
          description: "Boiler repair",
          amount: 50000,
          type: "escrow",
          condition: "Boiler operational",
          minAmount: 30000,
          maxAmount: 80000,
          factors: [
            {
              name: "complexity",
              description: "Repair complexity",
              impact: "increases",
            },
          ],
        },
      ],
      totalAmount: 50000,
      currency: "gbp",
      conditions: [],
      expiresAt: Date.now() + 60000,
    },
    signatures: [
      { userId: "alice", signedAt: Date.now() },
      { userId: "bob", signedAt: Date.now() },
    ],
    status: "fully_signed",
    milestones: [
      {
        id: "ms_test_0" as MilestoneId,
        documentId: "doc_test" as DocumentId,
        lineItemIndex: 0,
        description: "Boiler repair completed",
        amount: 50000,
        condition: "Boiler fully operational",
        status: "pending",
        escrowHoldId: "hold_test",
      },
    ],
    createdAt: Date.now(),
  };
}

function makeMockProvider(responses: LLMResponse[]): ILLMProvider {
  let callIndex = 0;
  return {
    createMessage: vi.fn().mockImplementation(async () => {
      const response = responses[callIndex];
      callIndex++;
      return (
        response ?? {
          content: [{ type: "text", text: "Done" }],
          stopReason: "end_turn",
          usage: { input: 100, output: 50 },
        }
      );
    }),
  };
}

// Create a provider that calls tools in sequence to simulate the verification protocol
function makeVerificationProvider(): ILLMProvider {
  const responses: LLMResponse[] = [
    // Step 1: send_verification_update (classify)
    {
      content: [
        { type: "text", text: "Let me classify this milestone." },
        {
          type: "tool_use",
          id: "tu_1",
          name: "send_verification_update",
          input: {
            step: "classifying",
            message: "Service completion milestone",
          },
        },
      ],
      stopReason: "tool_use",
      usage: { input: 100, output: 50 },
    },
    // Step 2: assess_condition
    {
      content: [
        {
          type: "tool_use",
          id: "tu_2",
          name: "assess_condition",
          input: {
            conditionName: "Boiler operational",
            assessment: "met",
            details: "Work appears complete",
            impactOnPrice: "neutral",
          },
        },
      ],
      stopReason: "tool_use",
      usage: { input: 200, output: 60 },
    },
    // Step 3: record_self_attestation
    {
      content: [
        {
          type: "tool_use",
          id: "tu_3",
          name: "record_self_attestation",
          input: {
            attestation: "Verifier confirms completion",
            confidence: "high",
          },
        },
      ],
      stopReason: "tool_use",
      usage: { input: 300, output: 50 },
    },
    // Step 4: send_verification_update (evaluate)
    {
      content: [
        {
          type: "tool_use",
          id: "tu_4",
          name: "send_verification_update",
          input: {
            step: "evaluating",
            message: "All evidence supports completion",
          },
        },
      ],
      stopReason: "tool_use",
      usage: { input: 400, output: 50 },
    },
    // Step 5: submit_verdict
    {
      content: [
        {
          type: "tool_use",
          id: "tu_5",
          name: "submit_verdict",
          input: {
            status: "passed",
            reasoning: "Boiler repair verified as complete",
            recommendedAmount: 45000,
          },
        },
      ],
      stopReason: "tool_use",
      usage: { input: 500, output: 50 },
    },
    // Final response after verdict
    {
      content: [{ type: "text", text: "Verification complete." }],
      stopReason: "end_turn",
      usage: { input: 600, output: 20 },
    },
  ];

  return makeMockProvider(responses);
}

describe("VerificationService", () => {
  let mockPayment: any;
  let mockPanelEmitter: any;
  let mockPhoneService: any;

  beforeEach(() => {
    mockPayment = {
      executePayment: vi.fn(),
      createEscrowHold: vi.fn(),
      captureEscrow: vi
        .fn()
        .mockResolvedValue({ success: true, paymentIntentId: "hold_test" }),
      releaseEscrow: vi
        .fn()
        .mockResolvedValue({ success: true, paymentIntentId: "hold_test" }),
    };

    mockPanelEmitter = {
      registerSocket: vi.fn(),
      unregisterSocket: vi.fn(),
      setRoom: vi.fn(),
      sendToUser: vi.fn(),
      broadcast: vi.fn(),
    };

    mockPhoneService = {
      isAvailable: vi.fn().mockReturnValue(false),
      verify: vi.fn().mockResolvedValue({
        success: true,
        confirmed: true,
        callId: "sim_123",
        transcript: "Simulated",
        details: "DEMO MODE",
      }),
    };
  });

  it("should run full verification protocol and return passed result", async () => {
    const provider = makeVerificationProvider();
    const service = new VerificationService(
      { provider, model: "test-model", maxTokens: 4096 },
      mockPayment,
      null,
      mockPhoneService,
      mockPanelEmitter,
      "room_test",
    );

    const doc = makeDocument();
    const milestone = doc.milestones![0];
    const lineItem = doc.terms.lineItems[0];

    const result = await service.verifyMilestone(
      doc,
      milestone,
      lineItem,
      "alice",
    );

    expect(result.status).toBe("passed");
    expect(result.reasoning).toContain("Boiler repair verified");
    expect(result.recommendedAmount).toBe(45000);
    expect(result.capturedAmount).toBe(45000);
    expect(result.evidence.length).toBeGreaterThanOrEqual(2);

    // Should have captured escrow
    expect(mockPayment.captureEscrow).toHaveBeenCalledWith("hold_test", 45000);
  });

  it("should emit verification events", async () => {
    const provider = makeVerificationProvider();
    const service = new VerificationService(
      { provider, model: "test-model", maxTokens: 4096 },
      mockPayment,
      null,
      mockPhoneService,
      mockPanelEmitter,
      "room_test",
    );

    const events: string[] = [];
    service.on("verification:started", () => events.push("started"));
    service.on("verification:update", () => events.push("update"));
    service.on("verification:completed", () => events.push("completed"));

    const doc = makeDocument();
    await service.verifyMilestone(
      doc,
      doc.milestones![0],
      doc.terms.lineItems[0],
      "alice",
    );

    expect(events).toContain("started");
    expect(events).toContain("completed");
  });

  it("should send panel messages during verification", async () => {
    const provider = makeVerificationProvider();
    const service = new VerificationService(
      { provider, model: "test-model", maxTokens: 4096 },
      mockPayment,
      null,
      mockPhoneService,
      mockPanelEmitter,
      "room_test",
    );

    const doc = makeDocument();
    await service.verifyMilestone(
      doc,
      doc.milestones![0],
      doc.terms.lineItems[0],
      "alice",
    );

    // Should have sent verification panel messages
    const verifyCalls = mockPanelEmitter.sendToUser.mock.calls.filter(
      (call: any[]) => call[1]?.panel === "verification",
    );
    expect(verifyCalls.length).toBeGreaterThanOrEqual(2); // started + completed at minimum
  });

  it("should release escrow on failed verdict", async () => {
    const failProvider = makeMockProvider([
      {
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "record_self_attestation",
            input: { attestation: "Work not done", confidence: "low" },
          },
        ],
        stopReason: "tool_use",
        usage: { input: 100, output: 50 },
      },
      {
        content: [
          {
            type: "tool_use",
            id: "tu_2",
            name: "submit_verdict",
            input: { status: "failed", reasoning: "Work not completed" },
          },
        ],
        stopReason: "tool_use",
        usage: { input: 200, output: 50 },
      },
      {
        content: [{ type: "text", text: "Done" }],
        stopReason: "end_turn",
        usage: { input: 300, output: 20 },
      },
    ]);

    const service = new VerificationService(
      { provider: failProvider, model: "test-model", maxTokens: 4096 },
      mockPayment,
      null,
      mockPhoneService,
      mockPanelEmitter,
      "room_test",
    );

    const doc = makeDocument();
    const result = await service.verifyMilestone(
      doc,
      doc.milestones![0],
      doc.terms.lineItems[0],
      "alice",
    );

    expect(result.status).toBe("failed");
    expect(mockPayment.releaseEscrow).toHaveBeenCalledWith("hold_test");
    expect(mockPayment.captureEscrow).not.toHaveBeenCalled();
  });

  it("should not touch escrow on disputed verdict", async () => {
    const disputeProvider = makeMockProvider([
      {
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "submit_verdict",
            input: { status: "disputed", reasoning: "Evidence is conflicting" },
          },
        ],
        stopReason: "tool_use",
        usage: { input: 100, output: 50 },
      },
      {
        content: [{ type: "text", text: "Done" }],
        stopReason: "end_turn",
        usage: { input: 200, output: 20 },
      },
    ]);

    const service = new VerificationService(
      { provider: disputeProvider, model: "test-model", maxTokens: 4096 },
      mockPayment,
      null,
      mockPhoneService,
      mockPanelEmitter,
      "room_test",
    );

    const doc = makeDocument();
    const result = await service.verifyMilestone(
      doc,
      doc.milestones![0],
      doc.terms.lineItems[0],
      "alice",
    );

    expect(result.status).toBe("disputed");
    expect(mockPayment.captureEscrow).not.toHaveBeenCalled();
    expect(mockPayment.releaseEscrow).not.toHaveBeenCalled();
  });

  it("should handle no escrowHoldId gracefully", async () => {
    const provider = makeMockProvider([
      {
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "submit_verdict",
            input: { status: "passed", reasoning: "Complete" },
          },
        ],
        stopReason: "tool_use",
        usage: { input: 100, output: 50 },
      },
      {
        content: [{ type: "text", text: "Done" }],
        stopReason: "end_turn",
        usage: { input: 200, output: 20 },
      },
    ]);

    const service = new VerificationService(
      { provider, model: "test-model", maxTokens: 4096 },
      mockPayment,
      null,
      mockPhoneService,
      mockPanelEmitter,
      "room_test",
    );

    const doc = makeDocument();
    const milestoneNoEscrow = {
      ...doc.milestones![0],
      escrowHoldId: undefined,
    };

    const result = await service.verifyMilestone(
      doc,
      milestoneNoEscrow,
      doc.terms.lineItems[0],
      "alice",
    );

    expect(result.status).toBe("passed");
    expect(mockPayment.captureEscrow).not.toHaveBeenCalled();
  });

  it("should handle escrow capture failure", async () => {
    mockPayment.captureEscrow.mockResolvedValue({
      success: false,
      error: "Card declined",
    });

    const provider = makeMockProvider([
      {
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "submit_verdict",
            input: {
              status: "passed",
              reasoning: "All good",
              recommendedAmount: 45000,
            },
          },
        ],
        stopReason: "tool_use",
        usage: { input: 100, output: 50 },
      },
      {
        content: [{ type: "text", text: "Done" }],
        stopReason: "end_turn",
        usage: { input: 200, output: 20 },
      },
    ]);

    const service = new VerificationService(
      { provider, model: "test-model", maxTokens: 4096 },
      mockPayment,
      null,
      mockPhoneService,
      mockPanelEmitter,
      "room_test",
    );

    const doc = makeDocument();
    const result = await service.verifyMilestone(
      doc,
      doc.milestones![0],
      doc.terms.lineItems[0],
      "alice",
    );

    // Should fall back to disputed on capture failure
    expect(result.status).toBe("disputed");
    expect(result.reasoning).toContain("Card declined");
  });

  it("should return disputed on LLM error", async () => {
    const errorProvider: ILLMProvider = {
      createMessage: vi
        .fn()
        .mockRejectedValue(new Error("LLM API unavailable")),
    };

    const service = new VerificationService(
      { provider: errorProvider, model: "test-model", maxTokens: 4096 },
      mockPayment,
      null,
      mockPhoneService,
      mockPanelEmitter,
      "room_test",
    );

    const doc = makeDocument();
    const result = await service.verifyMilestone(
      doc,
      doc.milestones![0],
      doc.terms.lineItems[0],
      "alice",
    );

    expect(result.status).toBe("disputed");
    expect(result.reasoning).toContain("Verification error");
  });

  it("should store and retrieve results", async () => {
    const provider = makeMockProvider([
      {
        content: [
          {
            type: "tool_use",
            id: "tu_1",
            name: "submit_verdict",
            input: { status: "passed", reasoning: "Done" },
          },
        ],
        stopReason: "tool_use",
        usage: { input: 100, output: 50 },
      },
      {
        content: [{ type: "text", text: "Done" }],
        stopReason: "end_turn",
        usage: { input: 200, output: 20 },
      },
    ]);

    const service = new VerificationService(
      { provider, model: "test-model", maxTokens: 4096 },
      mockPayment,
      null,
      mockPhoneService,
      mockPanelEmitter,
      "room_test",
    );

    const doc = makeDocument();
    const result = await service.verifyMilestone(
      doc,
      { ...doc.milestones![0], escrowHoldId: undefined },
      doc.terms.lineItems[0],
      "alice",
    );

    const stored = service.getResult(result.id);
    expect(stored).toBeDefined();
    expect(stored!.milestoneId).toBe(result.milestoneId);
    expect(stored!.status).toBe("passed");
  });

  it("should return undefined for unknown verification id", () => {
    const provider = makeMockProvider([]);
    const service = new VerificationService(
      { provider, model: "test-model", maxTokens: 4096 },
      mockPayment,
      null,
      mockPhoneService,
      mockPanelEmitter,
      "room_test",
    );

    expect(service.getResult("nonexistent")).toBeUndefined();
  });
});
