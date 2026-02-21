import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NegotiationService } from "../src/services/negotiation.js";
import { SessionService } from "../src/services/session.js";
import { ProfileManager } from "../src/services/profile-manager.js";
import { PanelEmitter } from "../src/services/panel-emitter.js";
import { AudioService } from "../src/services/audio.js";
import { AudioRelayService } from "../src/services/audio-relay.js";
import { InProcessPeer } from "../src/services/in-process-peer.js";
import { EventEmitter } from "events";
import type { AgentProposal } from "../src/types.js";

function makeProposal(): AgentProposal {
  return {
    summary: "Test",
    lineItems: [{ description: "Item", amount: 1000, type: "immediate" }],
    totalAmount: 1000,
    currency: "gbp",
    conditions: [],
    expiresAt: Date.now() + 30000,
  };
}

function createMockWs(state = 1): any {
  const emitter = new EventEmitter();
  return {
    readyState: state,
    OPEN: 1,
    CLOSED: 3,
    send: vi.fn(),
    close: vi.fn(),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
  };
}

describe("Edge Cases & Stress Tests", () => {
  describe("NegotiationService edge cases", () => {
    let neg: NegotiationService;

    beforeEach(() => {
      vi.useFakeTimers();
      neg = new NegotiationService("room-1");
    });
    afterEach(() => {
      neg.destroy();
      vi.useRealTimers();
    });

    it("should handle message for nonexistent negotiation", () => {
      // Should not throw, just warn
      neg.handleAgentMessage({
        type: "agent_accept",
        negotiationId: "neg_nonexistent",
        fromAgent: "alice",
      });
    });

    it("should handle multiple rapid counters", () => {
      const n = neg.createNegotiation("alice", "bob", makeProposal());
      const updates: any[] = [];
      neg.on("negotiation:updated", (u) => updates.push(u));

      for (let i = 0; i < 4; i++) {
        neg.handleAgentMessage({
          type: "agent_counter",
          negotiationId: n.id,
          proposal: makeProposal(),
          reason: `Counter ${i}`,
          fromAgent: i % 2 === 0 ? "bob" : "alice",
        });
      }

      expect(updates).toHaveLength(4);
      expect(neg.getNegotiation(n.id)!.rounds).toHaveLength(5); // 1 initial + 4 counters
    });

    it("should not expire twice", () => {
      const n = neg.createNegotiation("alice", "bob", makeProposal());
      const expired: any[] = [];
      neg.on("negotiation:expired", (e) => expired.push(e));

      // Force both timeouts
      vi.advanceTimersByTime(30_000); // round timeout
      vi.advanceTimersByTime(90_000); // total timeout (should be already expired)

      expect(expired).toHaveLength(1);
    });

    it("should handle accept after counter", () => {
      const n = neg.createNegotiation("alice", "bob", makeProposal());
      neg.handleAgentMessage({
        type: "agent_counter",
        negotiationId: n.id,
        proposal: makeProposal(),
        reason: "Lower",
        fromAgent: "bob",
      });
      neg.handleAgentMessage({
        type: "agent_accept",
        negotiationId: n.id,
        fromAgent: "alice",
      });
      expect(neg.getNegotiation(n.id)!.status).toBe("accepted");
    });
  });

  describe("SessionService edge cases", () => {
    it("should handle adding 1000 transcripts", () => {
      const session = new SessionService();
      for (let i = 0; i < 1000; i++) {
        session.addTranscript({
          id: `t-${i}`,
          speaker: i % 2 === 0 ? "alice" : "bob",
          text: `Message ${i}`,
          timestamp: Date.now(),
          isFinal: true,
          source: "local",
        });
      }
      expect(session.getTranscripts()).toHaveLength(1000);
      const text = session.getTranscriptText();
      expect(text).toContain("Message 0");
      expect(text).toContain("Message 999");
    });

    it("should handle rapid status changes", () => {
      const session = new SessionService();
      const statuses: string[] = [];
      session.on("status_changed", (s) => statuses.push(s));

      session.setStatus("active");
      session.setStatus("negotiating");
      session.setStatus("signing");
      session.setStatus("completed");
      session.setStatus("ended");

      expect(statuses).toHaveLength(5);
      expect(session.getStatus()).toBe("ended");
    });
  });

  describe("ProfileManager edge cases", () => {
    it("should handle 100 concurrent profiles", () => {
      const pm = new ProfileManager();
      for (let i = 0; i < 100; i++) {
        pm.setProfile(`user-${i}`, {
          displayName: `User ${i}`,
          role: "participant",
          customInstructions: "",
          preferences: {
            maxAutoApproveAmount: i * 100,
            preferredCurrency: "gbp",
            escrowPreference: "above_threshold",
            escrowThreshold: 10000,
            negotiationStyle: "balanced",
          },
        });
      }
      expect(pm.getProfile("user-50")!.displayName).toBe("User 50");
      expect(pm.getProfile("user-50")!.preferences.maxAutoApproveAmount).toBe(
        5000,
      );
    });

    it("should handle profile overwrite", () => {
      const pm = new ProfileManager();
      pm.setProfile("alice", {
        displayName: "Alice V1",
        role: "homeowner",
        customInstructions: "",
        preferences: {
          maxAutoApproveAmount: 1000,
          preferredCurrency: "gbp",
          escrowPreference: "never",
          escrowThreshold: 0,
          negotiationStyle: "aggressive",
        },
      });
      pm.setProfile("alice", {
        displayName: "Alice V2",
        role: "plumber",
        customInstructions: "Updated",
        preferences: {
          maxAutoApproveAmount: 5000,
          preferredCurrency: "usd",
          escrowPreference: "always",
          escrowThreshold: 5000,
          negotiationStyle: "conservative",
        },
      });
      const p = pm.getProfile("alice")!;
      expect(p.displayName).toBe("Alice V2");
      expect(p.role).toBe("plumber");
      expect(p.preferences.negotiationStyle).toBe("conservative");
    });

    it("should handle unicode in displayName", () => {
      const pm = new ProfileManager();
      pm.setProfile("user-1", {
        displayName: "ナタリー 🎉",
        role: "participant",
        customInstructions: "",
        preferences: {
          maxAutoApproveAmount: 0,
          preferredCurrency: "jpy",
          escrowPreference: "never",
          escrowThreshold: 0,
          negotiationStyle: "balanced",
        },
      });
      expect(pm.getProfile("user-1")!.displayName).toBe("ナタリー 🎉");
    });

    it("should handle XSS attempt in customInstructions", () => {
      const pm = new ProfileManager();
      const xss = '<script>alert("xss")</script>';
      pm.setProfile("user-1", {
        displayName: "Attacker",
        role: "participant",
        customInstructions: xss,
        preferences: {
          maxAutoApproveAmount: 0,
          preferredCurrency: "gbp",
          escrowPreference: "never",
          escrowThreshold: 0,
          negotiationStyle: "balanced",
        },
      });
      // ProfileManager stores as-is — XSS prevention is the frontend's job
      expect(pm.getProfile("user-1")!.customInstructions).toBe(xss);
    });
  });

  describe("PanelEmitter edge cases", () => {
    it("should handle broadcast to empty room", () => {
      const pe = new PanelEmitter();
      // Should not throw
      pe.broadcast("empty-room", {
        panel: "status",
        roomId: "empty-room",
        users: [],
        sessionStatus: "discovering",
      });
    });

    it("should handle rapid socket replacement", () => {
      const pe = new PanelEmitter();
      const sockets: any[] = [];

      for (let i = 0; i < 10; i++) {
        const ws = createMockWs();
        sockets.push(ws);
        pe.registerSocket("alice", ws);
      }

      // All but last should be closed
      for (let i = 0; i < 9; i++) {
        expect(sockets[i].close).toHaveBeenCalledWith(4002, "replaced");
      }
      expect(sockets[9].close).not.toHaveBeenCalled();
    });

    it("should handle sendToUser with very large message", () => {
      const pe = new PanelEmitter();
      const ws = createMockWs();
      pe.registerSocket("alice", ws);

      const bigText = "x".repeat(100_000);
      pe.sendToUser("alice", {
        panel: "agent",
        userId: "alice",
        text: bigText,
        timestamp: Date.now(),
      });

      expect(ws.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.text.length).toBe(100_000);
    });
  });

  describe("AudioService edge cases", () => {
    it("should handle zero-length buffer", () => {
      vi.useFakeTimers();
      try {
        const audio = new AudioService();
        audio.setSampleRate(16000);
        audio.feedRawAudio(Buffer.alloc(0));
        vi.advanceTimersByTime(500);
        // Should not emit any chunks
        audio.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should handle very large buffer", () => {
      vi.useFakeTimers();
      try {
        const audio = new AudioService();
        const chunks: any[] = [];
        audio.on("chunk", (c) => chunks.push(c));
        audio.setSampleRate(16000);

        // 1MB of audio
        audio.feedRawAudio(Buffer.alloc(1_000_000));
        vi.advanceTimersByTime(250);

        // 1_000_000 / 8000 = 125 chunks
        expect(chunks).toHaveLength(125);
        audio.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should handle sample rate change mid-stream", () => {
      vi.useFakeTimers();
      try {
        const audio = new AudioService();
        const chunks: any[] = [];
        audio.on("chunk", (c) => chunks.push(c));

        audio.setSampleRate(16000);
        audio.feedRawAudio(Buffer.alloc(16000)); // 16000 bytes at 16kHz → chunkSize=8000 → 2 chunks

        // Flush the existing buffer at 16kHz chunk size before changing rate
        vi.advanceTimersByTime(250);
        expect(chunks).toHaveLength(2);

        audio.setSampleRate(48000); // New chunkSize = 48000 * 0.25 * 2 = 24000

        // Feed more audio at new rate
        audio.feedRawAudio(Buffer.alloc(48000)); // 48000 / 24000 = 2 chunks
        vi.advanceTimersByTime(250);

        expect(chunks).toHaveLength(4); // 2 from 16kHz + 2 from 48kHz

        audio.destroy();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("AudioRelayService edge cases", () => {
    it("should handle relay with 0 users", () => {
      const relay = new AudioRelayService();
      // Should not throw
      relay.relayAudio("nobody", Buffer.from("data"));
    });

    it("should handle relay with 1 user (sender only)", () => {
      const relay = new AudioRelayService();
      const ws = createMockWs();
      relay.registerUser("alice", ws);
      relay.relayAudio("alice", Buffer.from("data"));
      expect(ws.send).not.toHaveBeenCalled();
      relay.destroy();
    });

    it("should relay to many users efficiently", () => {
      const relay = new AudioRelayService();
      const sockets: any[] = [];
      for (let i = 0; i < 20; i++) {
        const ws = createMockWs();
        sockets.push(ws);
        relay.registerUser(`user-${i}`, ws);
      }

      relay.relayAudio("user-0", Buffer.from("audio"));
      // All except sender should receive
      expect(sockets[0].send).not.toHaveBeenCalled();
      for (let i = 1; i < 20; i++) {
        expect(sockets[i].send).toHaveBeenCalledOnce();
      }
      relay.destroy();
    });
  });

  describe("InProcessPeer edge cases", () => {
    it("should handle 1000 rapid messages without dropping", async () => {
      const [peerA, peerB] = InProcessPeer.createPair("alice", "bob");
      const received: any[] = [];
      peerB.on("message", (m) => received.push(m));

      for (let i = 0; i < 1000; i++) {
        peerA.send({
          type: "agent_accept",
          negotiationId: `neg_${i}`,
          fromAgent: "alice",
        });
      }

      // Drain all nextTick callbacks
      await new Promise<void>((resolve) => {
        function checkDone() {
          if (received.length >= 1000) {
            resolve();
          } else {
            process.nextTick(checkDone);
          }
        }
        process.nextTick(checkDone);
      });

      expect(received).toHaveLength(1000);
    });

    it("should isolate message mutations between peers", async () => {
      const [peerA, peerB] = InProcessPeer.createPair("alice", "bob");
      const received: any[] = [];
      peerB.on("message", (m) => received.push(m));

      const original: any = {
        type: "agent_reject",
        negotiationId: "neg_1",
        reason: "original",
        fromAgent: "alice",
      };

      peerA.send(original);
      original.reason = "mutated"; // Mutate after send

      await new Promise((r) => process.nextTick(r));
      expect(received[0].reason).toBe("original"); // Copy, not reference
    });
  });
});
