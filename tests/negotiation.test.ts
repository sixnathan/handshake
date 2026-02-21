import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NegotiationService } from "../src/services/negotiation.js";
import type { AgentProposal, Negotiation } from "../src/types.js";

function makeProposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
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
    totalAmount: 20000,
    currency: "gbp",
    conditions: ["Work completed within 7 days"],
    expiresAt: Date.now() + 30000,
    ...overrides,
  };
}

describe("NegotiationService Module", () => {
  let negotiation: NegotiationService;

  beforeEach(() => {
    vi.useFakeTimers();
    negotiation = new NegotiationService("room-1");
  });

  afterEach(() => {
    negotiation.destroy();
    vi.useRealTimers();
  });

  it("should create a negotiation with correct initial state", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    expect(neg.status).toBe("proposed");
    expect(neg.initiator).toBe("alice");
    expect(neg.responder).toBe("bob");
    expect(neg.rounds.length).toBe(1);
    expect(neg.rounds[0].action).toBe("propose");
    expect(neg.currentProposal.totalAmount).toBe(20000);
  });

  it("should generate unique IDs", () => {
    const neg1 = negotiation.createNegotiation("alice", "bob", makeProposal());
    negotiation.destroy(); // clear active
    negotiation = new NegotiationService("room-1");
    const neg2 = negotiation.createNegotiation("alice", "bob", makeProposal());
    expect(neg1.id).not.toBe(neg2.id);
  });

  it("should emit negotiation:started event", () => {
    const events: Negotiation[] = [];
    negotiation.on("negotiation:started", (n) => events.push(n));

    negotiation.createNegotiation("alice", "bob", makeProposal());
    expect(events.length).toBe(1);
    expect(events[0].status).toBe("proposed");
  });

  it("should throw when creating duplicate active negotiation", () => {
    negotiation.createNegotiation("alice", "bob", makeProposal());
    expect(() =>
      negotiation.createNegotiation("alice", "bob", makeProposal()),
    ).toThrow("Negotiation already in progress");
  });

  it("should handle accept message", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    const events: Negotiation[] = [];
    negotiation.on("negotiation:agreed", (n) => events.push(n));

    negotiation.handleAgentMessage({
      type: "agent_accept",
      negotiationId: neg.id,
      fromAgent: "bob",
    });

    expect(events.length).toBe(1);
    expect(events[0].status).toBe("accepted");
    expect(negotiation.getActiveNegotiation()).toBeUndefined();
  });

  it("should handle reject message", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    const events: Negotiation[] = [];
    negotiation.on("negotiation:rejected", (n) => events.push(n));

    negotiation.handleAgentMessage({
      type: "agent_reject",
      negotiationId: neg.id,
      reason: "Too expensive",
      fromAgent: "bob",
    });

    expect(events.length).toBe(1);
    expect(events[0].status).toBe("rejected");
  });

  it("should handle counter message", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    const events: Negotiation[] = [];
    negotiation.on("negotiation:updated", (n) => events.push(n));

    const counterProposal = makeProposal({
      summary: "Counter: Fix boiler",
      totalAmount: 15000,
    });

    negotiation.handleAgentMessage({
      type: "agent_counter",
      negotiationId: neg.id,
      proposal: counterProposal,
      reason: "Lower price",
      fromAgent: "bob",
    });

    expect(events.length).toBe(1);
    expect(events[0].status).toBe("countering");
    expect(events[0].rounds.length).toBe(2);
    expect(events[0].currentProposal.totalAmount).toBe(15000);
  });

  it("should expire on round limit exceeded", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    const expired: Negotiation[] = [];
    negotiation.on("negotiation:expired", (n) => expired.push(n));

    // Rounds 2-5 (4 counters, already have round 1 from creation)
    for (let i = 0; i < 4; i++) {
      negotiation.handleAgentMessage({
        type: "agent_counter",
        negotiationId: neg.id,
        proposal: makeProposal(),
        reason: `Counter ${i}`,
        fromAgent: i % 2 === 0 ? "bob" : "alice",
      });
    }

    // Round 6 should trigger expiry
    negotiation.handleAgentMessage({
      type: "agent_counter",
      negotiationId: neg.id,
      proposal: makeProposal(),
      reason: "One more",
      fromAgent: "bob",
    });

    expect(expired.length).toBe(1);
    expect(expired[0].status).toBe("expired");
  });

  it("should expire on round timeout (30s)", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    const expired: Negotiation[] = [];
    negotiation.on("negotiation:expired", (n) => expired.push(n));

    vi.advanceTimersByTime(30_000);
    expect(expired.length).toBe(1);
  });

  it("should expire on total timeout (2min)", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    const expired: Negotiation[] = [];
    negotiation.on("negotiation:expired", (n) => expired.push(n));

    // Keep resetting round timer with counters
    vi.advanceTimersByTime(25_000);
    negotiation.handleAgentMessage({
      type: "agent_counter",
      negotiationId: neg.id,
      proposal: makeProposal(),
      reason: "Counter 1",
      fromAgent: "bob",
    });

    // Total timeout at 120s
    vi.advanceTimersByTime(95_000);
    expect(expired.length).toBe(1);
  });

  it("should not expire already accepted negotiation", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    negotiation.handleAgentMessage({
      type: "agent_accept",
      negotiationId: neg.id,
      fromAgent: "bob",
    });

    const expired: Negotiation[] = [];
    negotiation.on("negotiation:expired", (n) => expired.push(n));
    vi.advanceTimersByTime(200_000);
    expect(expired.length).toBe(0);
  });

  it("should retrieve negotiation by ID", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    const found = negotiation.getNegotiation(neg.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(neg.id);
  });

  it("should return undefined for unknown negotiation ID", () => {
    expect(negotiation.getNegotiation("fake-id")).toBeUndefined();
  });

  it("should return active negotiation", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    expect(negotiation.getActiveNegotiation()?.id).toBe(neg.id);
  });

  it("should return undefined when no active negotiation", () => {
    expect(negotiation.getActiveNegotiation()).toBeUndefined();
  });

  it("should ignore messages for non-active negotiations", () => {
    const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
    negotiation.handleAgentMessage({
      type: "agent_accept",
      negotiationId: neg.id,
      fromAgent: "bob",
    });

    // This should be silently ignored
    negotiation.handleAgentMessage({
      type: "agent_counter",
      negotiationId: neg.id,
      proposal: makeProposal(),
      reason: "Too late",
      fromAgent: "alice",
    });

    const found = negotiation.getNegotiation(neg.id);
    expect(found!.status).toBe("accepted"); // unchanged
  });

  it("should clear timers on destroy", () => {
    negotiation.createNegotiation("alice", "bob", makeProposal());
    negotiation.destroy();

    const expired: Negotiation[] = [];
    negotiation.on("negotiation:expired", (n) => expired.push(n));
    vi.advanceTimersByTime(200_000);
    expect(expired.length).toBe(0);
  });
});
