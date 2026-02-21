import { describe, it, expect } from "vitest";
import type {
  AgentProfile,
  AgentPreferences,
  AudioChunk,
  TranscriptEntry,
  TriggerEvent,
  KeywordState,
  DetectedTerm,
  LineItem,
  AgentProposal,
  Negotiation,
  NegotiationRound,
  NegotiationStatus,
  LegalDocument,
  DocumentParty,
  DocumentSignature,
  DocumentStatus,
  AgentMessage,
  PanelMessage,
  ClientMessage,
  PaymentRequest,
  PaymentResult,
  EscrowHold,
  MonzoBalance,
  MonzoTransaction,
  SessionStatus,
  AppConfig,
} from "../src/types.js";

describe("Type System Verification", () => {
  describe("Core ID types", () => {
    it("should accept string values for all ID types", () => {
      const userId: string = "user-123";
      const negId: string = "neg_abc";
      const roomId: string = "room-test";
      const docId: string = "doc_xyz";
      expect(userId).toBeTruthy();
      expect(negId).toBeTruthy();
      expect(roomId).toBeTruthy();
      expect(docId).toBeTruthy();
    });
  });

  describe("AgentProfile", () => {
    it("should construct a valid profile", () => {
      const profile: AgentProfile = {
        displayName: "Alice",
        role: "plumber",
        customInstructions: "Be careful",
        preferences: {
          maxAutoApproveAmount: 5000,
          preferredCurrency: "gbp",
          escrowPreference: "above_threshold",
          escrowThreshold: 10000,
          negotiationStyle: "balanced",
        },
      };
      expect(profile.displayName).toBe("Alice");
      expect(profile.preferences.negotiationStyle).toBe("balanced");
    });

    it("should accept optional stripe and monzo fields", () => {
      const profile: AgentProfile = {
        displayName: "Bob",
        role: "homeowner",
        customInstructions: "",
        preferences: {
          maxAutoApproveAmount: 0,
          preferredCurrency: "gbp",
          escrowPreference: "never",
          escrowThreshold: 0,
          negotiationStyle: "aggressive",
        },
        stripeAccountId: "acct_123",
        monzoAccessToken: "token-abc",
      };
      expect(profile.stripeAccountId).toBe("acct_123");
      expect(profile.monzoAccessToken).toBe("token-abc");
    });
  });

  describe("AgentMessage discriminated union", () => {
    it("should type-narrow agent_proposal", () => {
      const msg: AgentMessage = {
        type: "agent_proposal",
        negotiationId: "neg_1",
        proposal: {
          summary: "Fix boiler",
          lineItems: [],
          totalAmount: 15000,
          currency: "gbp",
          conditions: [],
          expiresAt: Date.now(),
        },
        fromAgent: "alice",
      };
      if (msg.type === "agent_proposal") {
        expect(msg.proposal.summary).toBe("Fix boiler");
      }
    });

    it("should type-narrow agent_counter", () => {
      const msg: AgentMessage = {
        type: "agent_counter",
        negotiationId: "neg_1",
        proposal: {
          summary: "Counter",
          lineItems: [],
          totalAmount: 10000,
          currency: "gbp",
          conditions: [],
          expiresAt: Date.now(),
        },
        reason: "Too expensive",
        fromAgent: "bob",
      };
      if (msg.type === "agent_counter") {
        expect(msg.reason).toBe("Too expensive");
      }
    });

    it("should type-narrow agent_accept", () => {
      const msg: AgentMessage = {
        type: "agent_accept",
        negotiationId: "neg_1",
        fromAgent: "alice",
      };
      expect(msg.type).toBe("agent_accept");
    });

    it("should type-narrow agent_reject", () => {
      const msg: AgentMessage = {
        type: "agent_reject",
        negotiationId: "neg_1",
        reason: "No deal",
        fromAgent: "bob",
      };
      if (msg.type === "agent_reject") {
        expect(msg.reason).toBe("No deal");
      }
    });
  });

  describe("PanelMessage discriminated union", () => {
    it("should construct transcript panel message", () => {
      const msg: PanelMessage = {
        panel: "transcript",
        entry: {
          id: "e1",
          speaker: "alice",
          text: "hello",
          timestamp: Date.now(),
          isFinal: true,
          source: "local",
        },
      };
      expect(msg.panel).toBe("transcript");
    });

    it("should construct agent panel message", () => {
      const msg: PanelMessage = {
        panel: "agent",
        userId: "alice",
        text: "Analyzing...",
        timestamp: Date.now(),
      };
      expect(msg.panel).toBe("agent");
    });

    it("should construct negotiation panel message", () => {
      const msg: PanelMessage = {
        panel: "negotiation",
        negotiation: {
          id: "neg_1",
          roomId: "room_1",
          status: "proposed",
          initiator: "alice",
          responder: "bob",
          currentProposal: {
            summary: "Test",
            lineItems: [],
            totalAmount: 0,
            currency: "gbp",
            conditions: [],
            expiresAt: Date.now(),
          },
          rounds: [],
          maxRounds: 5,
          roundTimeoutMs: 30000,
          totalTimeoutMs: 120000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
      expect(msg.panel).toBe("negotiation");
    });

    it("should construct execution panel message", () => {
      const msg: PanelMessage = {
        panel: "execution",
        negotiationId: "neg_1",
        step: "payment_labour",
        status: "done",
        details: "Payment: £150.00",
      };
      expect(msg.panel).toBe("execution");
    });

    it("should construct status panel message", () => {
      const msg: PanelMessage = {
        panel: "status",
        roomId: "room_1",
        users: ["alice", "bob"],
        sessionStatus: "active",
      };
      expect(msg.panel).toBe("status");
    });

    it("should construct error panel message", () => {
      const msg: PanelMessage = {
        panel: "error",
        message: "Something went wrong",
      };
      expect(msg.panel).toBe("error");
    });

    it("should construct document panel message", () => {
      const msg: PanelMessage = {
        panel: "document",
        document: {
          id: "doc_1",
          title: "Agreement",
          content: "# Doc",
          negotiationId: "neg_1",
          parties: [],
          terms: {
            summary: "Test",
            lineItems: [],
            totalAmount: 0,
            currency: "gbp",
            conditions: [],
            expiresAt: Date.now(),
          },
          signatures: [],
          status: "draft",
          createdAt: Date.now(),
        },
      };
      expect(msg.panel).toBe("document");
    });
  });

  describe("ClientMessage discriminated union", () => {
    it("should construct set_profile message", () => {
      const msg: ClientMessage = {
        type: "set_profile",
        profile: {
          displayName: "Test",
          role: "tester",
          customInstructions: "",
          preferences: {
            maxAutoApproveAmount: 0,
            preferredCurrency: "gbp",
            escrowPreference: "never",
            escrowThreshold: 0,
            negotiationStyle: "balanced",
          },
        },
      };
      expect(msg.type).toBe("set_profile");
    });

    it("should construct sign_document message", () => {
      const msg: ClientMessage = { type: "sign_document", documentId: "doc_1" };
      expect(msg.type).toBe("sign_document");
    });

    it("should construct set_trigger_keyword message", () => {
      const msg: ClientMessage = {
        type: "set_trigger_keyword",
        keyword: "deal",
      };
      expect(msg.type).toBe("set_trigger_keyword");
    });

    it("should construct join_room message", () => {
      const msg: ClientMessage = { type: "join_room", roomId: "room-abc" };
      expect(msg.type).toBe("join_room");
    });
  });

  describe("NegotiationStatus exhaustive coverage", () => {
    it("should cover all 8 statuses", () => {
      const statuses: NegotiationStatus[] = [
        "proposed",
        "countering",
        "accepted",
        "rejected",
        "expired",
        "executing",
        "completed",
        "failed",
      ];
      expect(statuses).toHaveLength(8);
    });
  });

  describe("LineItem types", () => {
    it("should cover all 3 payment types", () => {
      const items: LineItem[] = [
        { description: "Labour", amount: 15000, type: "immediate" },
        {
          description: "Parts",
          amount: 5000,
          type: "escrow",
          condition: "On completion",
        },
        {
          description: "Bonus",
          amount: 2000,
          type: "conditional",
          condition: "If satisfied",
        },
      ];
      expect(items).toHaveLength(3);
      expect(items[0].condition).toBeUndefined();
      expect(items[1].condition).toBe("On completion");
    });
  });

  describe("SessionStatus exhaustive coverage", () => {
    it("should cover all 6 statuses", () => {
      const statuses: SessionStatus[] = [
        "discovering",
        "active",
        "negotiating",
        "signing",
        "completed",
        "ended",
      ];
      expect(statuses).toHaveLength(6);
    });
  });

  describe("EscrowHold statuses", () => {
    it("should cover all 3 hold statuses", () => {
      const holds: EscrowHold["status"][] = ["held", "captured", "released"];
      expect(holds).toHaveLength(3);
    });
  });

  describe("DocumentStatus exhaustive coverage", () => {
    it("should cover all 3 statuses", () => {
      const statuses: DocumentStatus[] = [
        "draft",
        "pending_signatures",
        "fully_signed",
      ];
      expect(statuses).toHaveLength(3);
    });
  });
});
