import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentService } from "../src/services/document.js";
import type {
  Negotiation,
  AgentProposal,
  DocumentParty,
  LegalDocument,
} from "../src/types.js";

function makeMockLLM(responseText = "# Agreement\n\nThis is a test document.") {
  return {
    createMessage: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: responseText }],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 200 },
    }),
  };
}

function makeProposal(): AgentProposal {
  return {
    summary: "Boiler repair agreement",
    lineItems: [
      { description: "Labour", amount: 15000, type: "immediate" as const },
      {
        description: "Parts",
        amount: 5000,
        type: "escrow" as const,
        condition: "On completion",
      },
    ],
    totalAmount: 20000,
    currency: "gbp",
    conditions: ["Work completed within 7 days"],
    expiresAt: Date.now() + 30000,
  };
}

function makeNegotiation(): Negotiation {
  return {
    id: "neg_test_1",
    roomId: "room-1",
    status: "accepted",
    initiator: "alice",
    responder: "bob",
    currentProposal: makeProposal(),
    rounds: [
      {
        round: 1,
        fromAgent: "alice",
        proposal: makeProposal(),
        action: "propose",
        timestamp: Date.now(),
      },
    ],
    maxRounds: 5,
    roundTimeoutMs: 30000,
    totalTimeoutMs: 120000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeParties(): DocumentParty[] {
  return [
    { userId: "alice", name: "Alice Smith", role: "homeowner" },
    { userId: "bob", name: "Bob Jones", role: "plumber" },
  ];
}

describe("DocumentService Module", () => {
  let doc: DocumentService;
  let mockLLM: ReturnType<typeof makeMockLLM>;

  beforeEach(() => {
    mockLLM = makeMockLLM();
    doc = new DocumentService({
      llmProvider: mockLLM as any,
      llmModel: "test-model",
    });
  });

  describe("generateDocument", () => {
    it("should generate a document with correct structure", async () => {
      const result = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "alice: fix my boiler\nbob: sure, £200",
      );

      expect(result.id).toMatch(/^doc_/);
      expect(result.title).toContain("Boiler repair agreement");
      expect(result.content).toBe("# Agreement\n\nThis is a test document.");
      expect(result.negotiationId).toBe("neg_test_1");
      expect(result.parties).toHaveLength(2);
      expect(result.signatures).toHaveLength(0);
      expect(result.status).toBe("pending_signatures");
    });

    it("should call LLM with document generation prompt", async () => {
      await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "context",
      );
      expect(mockLLM.createMessage).toHaveBeenCalledOnce();
      const call = mockLLM.createMessage.mock.calls[0][0];
      expect(call.system).toContain("legal document generator");
      expect(call.messages[0].content).toContain("PARTIES");
      expect(call.messages[0].content).toContain("Alice Smith");
      expect(call.messages[0].content).toContain("Bob Jones");
      expect(call.messages[0].content).toContain("£200.00"); // totalAmount 20000 / 100
      expect(call.messages[0].content).toContain("Labour");
    });

    it("should emit document:generated event", async () => {
      const events: LegalDocument[] = [];
      doc.on("document:generated", (d) => events.push(d));

      await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "context",
      );

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe("pending_signatures");
    });

    it("should handle LLM returning no text block", async () => {
      mockLLM.createMessage.mockResolvedValue({
        content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
        stopReason: "tool_use",
        usage: { inputTokens: 0, outputTokens: 0 },
      });

      const result = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "context",
      );
      expect(result.content).toBe("Error: Failed to generate document");
    });

    it("should generate unique document IDs", async () => {
      const d1 = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "c",
      );
      const d2 = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "c",
      );
      expect(d1.id).not.toBe(d2.id);
    });

    it("should truncate conversation context to 2000 chars", async () => {
      const longContext = "x".repeat(5000);
      await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        longContext,
      );
      const msgContent =
        mockLLM.createMessage.mock.calls[0][0].messages[0].content;
      // Should slice to last 2000
      expect(msgContent.length).toBeLessThan(5000);
    });

    it("should include line item conditions in LLM request", async () => {
      await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      const msgContent =
        mockLLM.createMessage.mock.calls[0][0].messages[0].content;
      expect(msgContent).toContain("On completion");
      expect(msgContent).toContain("escrow");
    });

    it("should handle proposals with no conditions", async () => {
      const proposal = makeProposal();
      proposal.conditions = [];
      await doc.generateDocument(
        makeNegotiation(),
        proposal,
        makeParties(),
        "ctx",
      );
      const msgContent =
        mockLLM.createMessage.mock.calls[0][0].messages[0].content;
      expect(msgContent).toContain("None");
    });
  });

  describe("signDocument", () => {
    it("should record a signature", async () => {
      const document = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      doc.signDocument(document.id, "alice");
      const updated = doc.getDocument(document.id)!;
      expect(updated.signatures).toHaveLength(1);
      expect(updated.signatures[0].userId).toBe("alice");
      expect(updated.signatures[0].signedAt).toBeTypeOf("number");
    });

    it("should emit document:signed event", async () => {
      const document = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      const events: { documentId: string; userId: string }[] = [];
      doc.on("document:signed", (e) => events.push(e));

      doc.signDocument(document.id, "alice");
      expect(events).toHaveLength(1);
      expect(events[0].documentId).toBe(document.id);
      expect(events[0].userId).toBe("alice");
    });

    it("should mark fully_signed when all parties sign", async () => {
      const document = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      const completedEvents: LegalDocument[] = [];
      doc.on("document:completed", (d) => completedEvents.push(d));

      doc.signDocument(document.id, "alice");
      expect(doc.getDocument(document.id)!.status).toBe("pending_signatures");

      doc.signDocument(document.id, "bob");
      expect(doc.getDocument(document.id)!.status).toBe("fully_signed");
      expect(completedEvents).toHaveLength(1);
    });

    it("should silently ignore duplicate signatures", async () => {
      const document = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      doc.signDocument(document.id, "alice");
      doc.signDocument(document.id, "alice"); // duplicate
      expect(doc.getDocument(document.id)!.signatures).toHaveLength(1);
    });

    it("should throw for non-existent document", () => {
      expect(() => doc.signDocument("fake-id", "alice")).toThrow(
        "Document not found",
      );
    });

    it("should throw for non-party signer", async () => {
      const document = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      expect(() => doc.signDocument(document.id, "carol")).toThrow(
        "not a party",
      );
    });

    it("should throw when signing already fully signed document", async () => {
      const document = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      doc.signDocument(document.id, "alice");
      doc.signDocument(document.id, "bob");
      expect(() => doc.signDocument(document.id, "alice")).toThrow(
        "already fully signed",
      );
    });

    it("should preserve immutability — signatures are new arrays", async () => {
      const document = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      const before = doc.getDocument(document.id)!;
      doc.signDocument(document.id, "alice");
      const after = doc.getDocument(document.id)!;
      expect(before.signatures).not.toBe(after.signatures);
    });
  });

  describe("isFullySigned", () => {
    it("should return false for pending document", async () => {
      const document = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      expect(doc.isFullySigned(document.id)).toBe(false);
    });

    it("should return true after all parties sign", async () => {
      const document = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      doc.signDocument(document.id, "alice");
      doc.signDocument(document.id, "bob");
      expect(doc.isFullySigned(document.id)).toBe(true);
    });

    it("should return false for non-existent document", () => {
      expect(doc.isFullySigned("fake")).toBe(false);
    });
  });

  describe("getDocument", () => {
    it("should return undefined for unknown ID", () => {
      expect(doc.getDocument("nonexistent")).toBeUndefined();
    });

    it("should return the document after generation", async () => {
      const generated = await doc.generateDocument(
        makeNegotiation(),
        makeProposal(),
        makeParties(),
        "ctx",
      );
      const found = doc.getDocument(generated.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(generated.id);
    });
  });
});

describe("DocumentService — LLM edge cases", () => {
  let doc: DocumentService;
  let mockLLM: ReturnType<typeof makeMockLLM>;

  beforeEach(() => {
    mockLLM = makeMockLLM("");
    doc = new DocumentService({
      llmProvider: mockLLM as any,
      llmModel: "test-model",
    });
  });

  it("should create document with empty content when LLM returns empty string", async () => {
    const result = await doc.generateDocument(
      makeNegotiation(),
      makeProposal(),
      makeParties(),
      "context",
    );

    expect(result.content).toBe("");
    expect(result.id).toMatch(/^doc_/);
    expect(result.status).toBe("pending_signatures");
  });
});

describe("DocumentService — milestone extraction", () => {
  let doc: DocumentService;
  let mockLLM: ReturnType<typeof makeMockLLM>;

  beforeEach(() => {
    mockLLM = makeMockLLM();
    doc = new DocumentService({
      llmProvider: mockLLM as any,
      llmModel: "test-model",
    });
  });

  it("should create milestone for escrow item and skip immediate item", () => {
    const proposal = makeProposal();
    // lineItems[0] = immediate (Labour), lineItems[1] = escrow (Parts)
    const milestones = (doc as any).generateMilestones("doc_test_1", proposal);

    expect(milestones).toHaveLength(1);
    expect(milestones[0].lineItemIndex).toBe(1);
    expect(milestones[0].documentId).toBe("doc_test_1");
    expect(milestones[0].description).toBe("Parts");
    expect(milestones[0].amount).toBe(5000);
    expect(milestones[0].status).toBe("pending");
    expect(milestones[0].id).toMatch(/^ms_/);
  });
});

describe("DocumentService — updateMilestones", () => {
  let doc: DocumentService;
  let mockLLM: ReturnType<typeof makeMockLLM>;

  beforeEach(() => {
    mockLLM = makeMockLLM();
    doc = new DocumentService({
      llmProvider: mockLLM as any,
      llmModel: "test-model",
    });
  });

  it("should throw for non-existent document", () => {
    expect(() => doc.updateMilestones("fake_id", [])).toThrow(
      "Document not found",
    );
  });
});

describe("DocumentService — getDocument for non-existent ID", () => {
  let doc: DocumentService;

  beforeEach(() => {
    const mockLLM = makeMockLLM();
    doc = new DocumentService({
      llmProvider: mockLLM as any,
      llmModel: "test-model",
    });
  });

  it("should return undefined for non-existent ID", () => {
    expect(doc.getDocument("nonexistent")).toBeUndefined();
  });
});

describe("DocumentService — factor-based line items", () => {
  let doc: DocumentService;
  let mockLLM: ReturnType<typeof makeMockLLM>;

  beforeEach(() => {
    mockLLM = makeMockLLM();
    doc = new DocumentService({
      llmProvider: mockLLM as any,
      llmModel: "test-model",
    });
  });

  it("should include factor details in LLM prompt for range-priced items", async () => {
    const proposal: AgentProposal = {
      summary: "Plumbing repair",
      lineItems: [
        {
          description: "Pipe repair",
          amount: 30000,
          type: "escrow" as const,
          minAmount: 20000,
          maxAmount: 40000,
          factors: [
            {
              name: "Complexity",
              description: "How complex the pipe work is",
              impact: "increases" as const,
            },
            {
              name: "Parts",
              description: "Standard vs specialist parts",
              impact: "determines" as const,
            },
          ],
        },
      ],
      totalAmount: 30000,
      currency: "gbp",
      conditions: ["Work within 3 days"],
      expiresAt: Date.now() + 60000,
      factorSummary: "The final cost depends on complexity and parts required.",
    };

    await doc.generateDocument(
      makeNegotiation(),
      proposal,
      makeParties(),
      "ctx",
    );

    const msgContent =
      mockLLM.createMessage.mock.calls[0][0].messages[0].content;
    expect(msgContent).toContain("Complexity");
    expect(msgContent).toContain("increases");
    expect(msgContent).toContain("Parts");
    expect(msgContent).toContain("determines");
    expect(msgContent).toContain("How complex the pipe work is");
    expect(msgContent).toContain("Standard vs specialist parts");
    expect(msgContent).toContain("£200.00"); // minAmount 20000 / 100
    expect(msgContent).toContain("£400.00"); // maxAmount 40000 / 100
    expect(msgContent).toContain("FACTOR SUMMARY");
    expect(msgContent).toContain(
      "The final cost depends on complexity and parts required.",
    );
  });
});
