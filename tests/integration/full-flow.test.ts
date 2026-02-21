import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InProcessPeer } from "../../src/services/in-process-peer.js";
import { NegotiationService } from "../../src/services/negotiation.js";
import { SessionService } from "../../src/services/session.js";
import { AudioService } from "../../src/services/audio.js";
import { ProfileManager } from "../../src/services/profile-manager.js";
import { DocumentService } from "../../src/services/document.js";
import type {
  AgentProposal,
  AgentMessage,
  Negotiation,
  LegalDocument,
} from "../../src/types.js";

function makeProposal(total = 20000): AgentProposal {
  return {
    summary: "Boiler repair agreement",
    lineItems: [
      {
        description: "Labour",
        amount: total * 0.75,
        type: "immediate" as const,
      },
      {
        description: "Parts",
        amount: total * 0.25,
        type: "escrow" as const,
        condition: "On completion",
      },
    ],
    totalAmount: total,
    currency: "gbp",
    conditions: ["Work within 7 days"],
    expiresAt: Date.now() + 30000,
  };
}

describe("Multi-Service Integration Flows", () => {
  describe("Peer + Negotiation: Full negotiation flow", () => {
    let peerA: InProcessPeer;
    let peerB: InProcessPeer;
    let negotiation: NegotiationService;

    beforeEach(() => {
      [peerA, peerB] = InProcessPeer.createPair("alice", "bob");
      negotiation = new NegotiationService("room-1");
    });

    afterEach(() => {
      negotiation.destroy();
    });

    it("should complete propose → accept flow end-to-end", async () => {
      const events: Negotiation[] = [];
      negotiation.on("negotiation:agreed", (n) => events.push(n));

      // Wire peers to negotiation
      peerA.on("message", (msg: AgentMessage) =>
        negotiation.handleAgentMessage(msg),
      );
      peerB.on("message", (msg: AgentMessage) =>
        negotiation.handleAgentMessage(msg),
      );

      // Alice proposes via negotiation service
      const neg = negotiation.createNegotiation("alice", "bob", makeProposal());

      // Bob accepts via peer message
      peerB.send({
        type: "agent_accept",
        negotiationId: neg.id,
        fromAgent: "bob",
      });

      // Wait for process.nextTick delivery
      await new Promise<void>((r) => setTimeout(r, 50));
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe("accepted");
    });

    it("should complete propose → counter → accept flow", async () => {
      const updates: Negotiation[] = [];
      const agreed: Negotiation[] = [];
      negotiation.on("negotiation:updated", (n) => updates.push(n));
      negotiation.on("negotiation:agreed", (n) => agreed.push(n));

      peerA.on("message", (msg: AgentMessage) =>
        negotiation.handleAgentMessage(msg),
      );
      peerB.on("message", (msg: AgentMessage) =>
        negotiation.handleAgentMessage(msg),
      );

      const neg = negotiation.createNegotiation(
        "alice",
        "bob",
        makeProposal(20000),
      );

      // Bob counters
      peerB.send({
        type: "agent_counter",
        negotiationId: neg.id,
        proposal: makeProposal(15000),
        reason: "Too expensive",
        fromAgent: "bob",
      });
      await new Promise<void>((r) => setTimeout(r, 50));

      expect(updates).toHaveLength(1);
      expect(updates[0].status).toBe("countering");

      // Alice accepts the counter
      peerA.send({
        type: "agent_accept",
        negotiationId: neg.id,
        fromAgent: "alice",
      });
      await new Promise<void>((r) => setTimeout(r, 50));

      expect(agreed).toHaveLength(1);
      expect(agreed[0].currentProposal.totalAmount).toBe(15000);
    });

    it("should complete propose → reject flow", async () => {
      const rejected: Negotiation[] = [];
      negotiation.on("negotiation:rejected", (n) => rejected.push(n));

      peerA.on("message", (msg: AgentMessage) =>
        negotiation.handleAgentMessage(msg),
      );
      peerB.on("message", (msg: AgentMessage) =>
        negotiation.handleAgentMessage(msg),
      );

      const neg = negotiation.createNegotiation("alice", "bob", makeProposal());

      peerB.send({
        type: "agent_reject",
        negotiationId: neg.id,
        reason: "Not interested",
        fromAgent: "bob",
      });
      await new Promise<void>((r) => setTimeout(r, 50));

      expect(rejected).toHaveLength(1);
      expect(rejected[0].status).toBe("rejected");
    });
  });

  describe("Session + Audio: Transcript pipeline", () => {
    it("should pipe audio chunks through session recording", () => {
      vi.useFakeTimers();
      try {
        const audio = new AudioService();
        const session = new SessionService();

        audio.setSampleRate(16000);

        let chunkCount = 0;
        audio.on("chunk", () => {
          chunkCount++;
          session.addTranscript({
            id: `t-${chunkCount}`,
            speaker: "alice",
            text: `Chunk ${chunkCount}`,
            timestamp: Date.now(),
            isFinal: true,
            source: "local",
          });
        });

        // Feed 3 chunks worth
        audio.feedRawAudio(Buffer.alloc(24000));
        vi.advanceTimersByTime(250);

        expect(chunkCount).toBe(3);
        expect(session.getTranscripts()).toHaveLength(3);
        expect(session.getTranscriptText()).toContain("Chunk 1");
        expect(session.getTranscriptText()).toContain("Chunk 3");

        audio.destroy();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Negotiation + Document: Agreement pipeline", () => {
    it("should generate document from agreed negotiation", async () => {
      const negotiation = new NegotiationService("room-1");
      const mockLLM = {
        createMessage: vi.fn().mockResolvedValue({
          content: [
            { type: "text", text: "# Agreement\n\nBoiler repair for £200" },
          ],
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      };
      const docService = new DocumentService({
        llmProvider: mockLLM as any,
        llmModel: "m",
      });

      const agreed: Negotiation[] = [];
      negotiation.on("negotiation:agreed", (n) => agreed.push(n));

      const neg = negotiation.createNegotiation("alice", "bob", makeProposal());
      negotiation.handleAgentMessage({
        type: "agent_accept",
        negotiationId: neg.id,
        fromAgent: "bob",
      });

      expect(agreed).toHaveLength(1);

      // Generate document from agreed negotiation
      const doc = await docService.generateDocument(
        agreed[0],
        agreed[0].currentProposal,
        [
          { userId: "alice", name: "Alice", role: "homeowner" },
          { userId: "bob", name: "Bob", role: "plumber" },
        ],
        "conversation context",
      );

      expect(doc.status).toBe("pending_signatures");
      expect(doc.content).toContain("Agreement");

      // Sign
      const completed: LegalDocument[] = [];
      docService.on("document:completed", (d) => completed.push(d));

      docService.signDocument(doc.id, "alice");
      docService.signDocument(doc.id, "bob");

      expect(completed).toHaveLength(1);
      expect(completed[0].status).toBe("fully_signed");

      negotiation.destroy();
    });
  });

  describe("Profile + Session: Profile-aware session management", () => {
    it("should use profile defaults and validate across services", () => {
      const pm = new ProfileManager();
      const session = new SessionService();

      // Set profile
      pm.setProfile("alice", {
        displayName: "Alice",
        role: "homeowner",
        customInstructions: "",
        preferences: {
          maxAutoApproveAmount: 5000,
          preferredCurrency: "gbp",
          escrowPreference: "above_threshold",
          escrowThreshold: 10000,
          negotiationStyle: "balanced",
        },
      });

      // Get profile and verify
      const profile = pm.getProfile("alice")!;
      expect(profile.displayName).toBe("Alice");

      // Use in session context
      session.setStatus("active");
      session.addTranscript({
        id: "t1",
        speaker: "alice",
        text: "Hello",
        timestamp: Date.now(),
        isFinal: true,
        source: "local",
      });

      expect(session.getTranscriptText()).toContain("alice: Hello");

      // Cleanup
      pm.removeProfile("alice");
      session.reset();
      expect(pm.getProfile("alice")).toBeUndefined();
      expect(session.getStatus()).toBe("discovering");
    });
  });

  describe("Bidirectional peer message ordering", () => {
    it("should maintain message ordering in rapid exchanges", async () => {
      const [peerA, peerB] = InProcessPeer.createPair("alice", "bob");
      const received: AgentMessage[] = [];
      peerB.on("message", (msg) => received.push(msg));

      // Rapid fire 10 messages
      for (let i = 0; i < 10; i++) {
        peerA.send({
          type: "agent_accept",
          negotiationId: `neg_${i}`,
          fromAgent: "alice",
        });
      }

      // Wait for all to be delivered
      await new Promise((r) => setTimeout(r, 50));
      expect(received).toHaveLength(10);

      // Verify ordering
      for (let i = 0; i < 10; i++) {
        expect(received[i].negotiationId).toBe(`neg_${i}`);
      }
    });
  });
});
