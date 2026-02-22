import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppConfig, AgentProfile } from "../src/types.js";

// ── Mock all service modules ──────────────────────────

// Each mock constructor returns a mock instance with the methods RoomManager calls.
// We track instances so tests can inspect what was called on which service.
// IMPORTANT: vitest v4 requires `function` (not arrow functions) for constructors.

const mockAudioInstances: Array<Record<string, any>> = [];
vi.mock("../src/services/audio.js", () => ({
  AudioService: vi.fn(function (this: any) {
    this.setSampleRate = vi.fn();
    this.feedRawAudio = vi.fn();
    this.destroy = vi.fn();
    this.on = vi.fn();
    this.off = vi.fn();
    this.once = vi.fn();
    this.emit = vi.fn();
    this.removeAllListeners = vi.fn();
    mockAudioInstances.push(this);
  }),
}));

const mockAudioRelayInstances: Array<Record<string, any>> = [];
vi.mock("../src/services/audio-relay.js", () => ({
  AudioRelayService: vi.fn(function (this: any) {
    this.registerUser = vi.fn();
    this.unregisterUser = vi.fn();
    this.relayAudio = vi.fn();
    this.destroy = vi.fn();
    mockAudioRelayInstances.push(this);
  }),
}));

const mockTranscriptionInstances: Array<Record<string, any>> = [];
vi.mock("../src/services/transcription.js", () => ({
  TranscriptionService: vi.fn(function (this: any) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.feedAudio = vi.fn();
    this.on = vi.fn();
    this.off = vi.fn();
    this.once = vi.fn();
    this.emit = vi.fn();
    this.removeAllListeners = vi.fn();
    mockTranscriptionInstances.push(this);
  }),
}));

const mockTriggerDetectorInstances: Array<Record<string, any>> = [];
vi.mock("../src/services/trigger-detector.js", () => ({
  TriggerDetector: vi.fn(function (this: any) {
    this.feedTranscript = vi.fn();
    this.setKeyword = vi.fn();
    this.reset = vi.fn();
    this.destroy = vi.fn();
    this.on = vi.fn();
    this.off = vi.fn();
    this.once = vi.fn();
    this.emit = vi.fn();
    this.removeAllListeners = vi.fn();
    mockTriggerDetectorInstances.push(this);
  }),
}));

const mockSessionInstances: Array<Record<string, any>> = [];
vi.mock("../src/services/session.js", () => ({
  SessionService: vi.fn(function (this: any) {
    this.setStatus = vi.fn();
    this.getStatus = vi.fn().mockReturnValue("discovering");
    this.addTranscript = vi.fn();
    this.getTranscripts = vi.fn().mockReturnValue([]);
    this.getTranscriptText = vi.fn().mockReturnValue("");
    this.getRecentTranscriptText = vi.fn().mockReturnValue("");
    this.reset = vi.fn();
    this.on = vi.fn();
    this.off = vi.fn();
    this.once = vi.fn();
    this.emit = vi.fn();
    this.removeAllListeners = vi.fn();
    mockSessionInstances.push(this);
  }),
}));

const mockAgentInstances: Array<Record<string, any>> = [];
vi.mock("../src/services/agent.js", () => ({
  AgentService: vi.fn(function (this: any) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn();
    this.setTools = vi.fn();
    this.pushTranscript = vi.fn();
    this.startNegotiation = vi.fn().mockResolvedValue(undefined);
    this.receiveAgentMessage = vi.fn().mockResolvedValue(undefined);
    this.injectInstruction = vi.fn().mockResolvedValue(undefined);
    this.on = vi.fn();
    this.off = vi.fn();
    this.once = vi.fn();
    this.emit = vi.fn();
    this.removeAllListeners = vi.fn();
    mockAgentInstances.push(this);
  }),
}));

const mockNegotiationInstances: Array<Record<string, any>> = [];
vi.mock("../src/services/negotiation.js", () => ({
  NegotiationService: vi.fn(function (this: any) {
    this.createNegotiation = vi.fn();
    this.handleAgentMessage = vi.fn();
    this.getNegotiation = vi.fn();
    this.getActiveNegotiation = vi.fn().mockReturnValue(undefined);
    this.destroy = vi.fn();
    this.on = vi.fn();
    this.off = vi.fn();
    this.once = vi.fn();
    this.emit = vi.fn();
    this.removeAllListeners = vi.fn();
    mockNegotiationInstances.push(this);
  }),
}));

const mockDocumentInstances: Array<Record<string, any>> = [];
vi.mock("../src/services/document.js", () => ({
  DocumentService: vi.fn(function (this: any) {
    this.generateDocument = vi.fn().mockResolvedValue({
      id: "doc_1",
      title: "Agreement",
      content: "# Agreement",
      negotiationId: "neg_1",
      parties: [],
      terms: {} as any,
      signatures: [],
      status: "pending_signatures",
      createdAt: Date.now(),
    });
    this.signDocument = vi.fn();
    this.isFullySigned = vi.fn().mockReturnValue(false);
    this.getDocument = vi.fn();
    this.updateMilestones = vi.fn();
    this.on = vi.fn();
    this.off = vi.fn();
    this.once = vi.fn();
    this.emit = vi.fn();
    this.removeAllListeners = vi.fn();
    mockDocumentInstances.push(this);
  }),
}));

const mockPaymentInstances: Array<Record<string, any>> = [];
vi.mock("../src/services/payment.js", () => ({
  PaymentService: vi.fn(function (this: any) {
    this.executePayment = vi
      .fn()
      .mockResolvedValue({ success: true, paymentIntentId: "pi_123" });
    this.createEscrowHold = vi.fn().mockResolvedValue({
      holdId: "hold_1",
      amount: 5000,
      currency: "gbp",
      status: "held",
      paymentIntentId: "pi_hold",
      recipientAccountId: "acct_bob",
      createdAt: Date.now(),
    });
    this.captureEscrow = vi
      .fn()
      .mockResolvedValue({ success: true, paymentIntentId: "hold_1" });
    this.releaseEscrow = vi
      .fn()
      .mockResolvedValue({ success: true, paymentIntentId: "hold_1" });
    mockPaymentInstances.push(this);
  }),
}));

const mockMonzoInstances: Array<Record<string, any>> = [];
vi.mock("../src/services/monzo.js", () => ({
  MonzoService: vi.fn(function (this: any) {
    this.setAccessToken = vi.fn();
    this.isAuthenticated = vi.fn().mockReturnValue(true);
    this.getBalance = vi.fn().mockResolvedValue({
      balance: 100000,
      total_balance: 100000,
      currency: "GBP",
      spend_today: -2000,
    });
    this.getTransactions = vi.fn().mockResolvedValue([]);
    mockMonzoInstances.push(this);
  }),
}));

// InProcessPeer needs the static createPair method
const mockPeerInstances: Array<Record<string, any>> = [];
function makeMockPeer(myUserId: string, otherUserId: string) {
  const peer: Record<string, any> = {
    send: vi.fn(),
    getOtherUserId: vi.fn().mockReturnValue(otherUserId),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
    _myUserId: myUserId,
    _otherUserId: otherUserId,
  };
  mockPeerInstances.push(peer);
  return peer;
}

vi.mock("../src/services/in-process-peer.js", () => ({
  InProcessPeer: {
    createPair: vi
      .fn()
      .mockImplementation((userIdA: string, userIdB: string) => {
        const peerA = makeMockPeer(userIdA, userIdB);
        const peerB = makeMockPeer(userIdB, userIdA);
        return [peerA, peerB];
      }),
  },
}));

vi.mock("../src/providers/index.js", () => ({
  createLLMProvider: vi.fn().mockReturnValue({
    createMessage: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "mock response" }],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  }),
}));

vi.mock("../src/tools.js", () => ({
  buildTools: vi.fn().mockReturnValue([]),
}));

// ── Import RoomManager AFTER all mocks ────────────────

import { RoomManager } from "../src/services/room-manager.js";
import { InProcessPeer } from "../src/services/in-process-peer.js";
import { buildTools } from "../src/tools.js";

// ── Helpers ──────────────────────────────────────────

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    elevenlabs: {
      apiKey: "test-el-key",
      region: "us",
      language: "en",
    },
    stripe: {
      secretKey: "sk_test_123",
      platformAccountId: "acct_platform",
    },
    llm: {
      provider: "openrouter",
      apiKey: "test-llm-key",
      model: "test-model",
    },
    trigger: {
      keyword: "handshake",
      smartDetectionEnabled: false,
    },
    monzo: {},
    port: 3000,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    displayName: "Alice",
    role: "plumber",
    customInstructions: "",
    preferences: {
      maxAutoApproveAmount: 5000,
      preferredCurrency: "gbp",
      escrowPreference: "above_threshold",
      escrowThreshold: 10000,
      negotiationStyle: "balanced",
    },
    ...overrides,
  };
}

function makeMockPanelEmitter() {
  return {
    registerSocket: vi.fn(),
    unregisterSocket: vi.fn(),
    setRoom: vi.fn(),
    sendToUser: vi.fn(),
    broadcast: vi.fn(),
  };
}

function makeMockProfileManager() {
  const profiles = new Map<string, AgentProfile>();
  return {
    setProfile: vi.fn((userId: string, profile: AgentProfile) => {
      profiles.set(userId, profile);
    }),
    getProfile: vi.fn((userId: string) => profiles.get(userId)),
    getDefaultProfile: vi.fn((userId: string) =>
      makeProfile({ displayName: userId, role: "participant" }),
    ),
    removeProfile: vi.fn((userId: string) => profiles.delete(userId)),
    _profiles: profiles,
  };
}

function makeMockWebSocket() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    readyState: 1,
    OPEN: 1,
  } as any;
}

function clearAllInstanceTrackers(): void {
  mockAudioInstances.length = 0;
  mockAudioRelayInstances.length = 0;
  mockTranscriptionInstances.length = 0;
  mockTriggerDetectorInstances.length = 0;
  mockSessionInstances.length = 0;
  mockAgentInstances.length = 0;
  mockNegotiationInstances.length = 0;
  mockDocumentInstances.length = 0;
  mockPaymentInstances.length = 0;
  mockMonzoInstances.length = 0;
  mockPeerInstances.length = 0;
}

function makeNegotiationFixture(overrides: Record<string, any> = {}) {
  return {
    id: "neg_1",
    roomId: "room-1",
    status: "accepted" as const,
    initiator: "alice",
    responder: "bob",
    currentProposal: {
      summary: "Test",
      lineItems: [
        { description: "Labour", amount: 10000, type: "immediate" as const },
      ],
      totalAmount: 10000,
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
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────

describe("RoomManager", () => {
  let config: AppConfig;
  let panelEmitter: ReturnType<typeof makeMockPanelEmitter>;
  let profileManager: ReturnType<typeof makeMockProfileManager>;
  let rm: RoomManager;

  beforeEach(() => {
    vi.clearAllMocks();
    clearAllInstanceTrackers();
    config = makeConfig();
    panelEmitter = makeMockPanelEmitter();
    profileManager = makeMockProfileManager();
    rm = new RoomManager(config, panelEmitter as any, profileManager as any);
  });

  afterEach(() => {
    rm.destroy();
  });

  // ── 1. joinRoom creates slot, re-join updates profile ──

  describe("joinRoom", () => {
    it("should create a user slot when joining a room", () => {
      const profile = makeProfile();
      rm.joinRoom("room-1", "alice", profile);

      const users = rm.getRoomUsers("room-1");
      expect(users).toEqual(["alice"]);
      expect(profileManager.setProfile).toHaveBeenCalledWith("alice", profile);
    });

    it("should create AudioService and set sample rate to 16000", () => {
      rm.joinRoom("room-1", "alice", makeProfile());

      expect(mockAudioInstances.length).toBe(1);
      expect(mockAudioInstances[0].setSampleRate).toHaveBeenCalledWith(16000);
    });

    it("should create TranscriptionService with elevenlabs config", () => {
      rm.joinRoom("room-1", "alice", makeProfile());

      expect(mockTranscriptionInstances.length).toBe(1);
    });

    it("should create SessionService and set status to discovering", () => {
      rm.joinRoom("room-1", "alice", makeProfile());

      expect(mockSessionInstances.length).toBe(1);
      expect(mockSessionInstances[0].setStatus).toHaveBeenCalledWith(
        "discovering",
      );
    });

    it("should broadcast status update after joining", () => {
      rm.joinRoom("room-1", "alice", makeProfile());

      expect(panelEmitter.broadcast).toHaveBeenCalledWith("room-1", {
        panel: "status",
        roomId: "room-1",
        users: ["alice"],
        sessionStatus: "discovering",
      });
    });

    it("should be a no-op when the same user re-joins the same room", () => {
      const profile = makeProfile();
      rm.joinRoom("room-1", "alice", profile);

      panelEmitter.broadcast.mockClear();

      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice v2" }));

      const users = rm.getRoomUsers("room-1");
      expect(users).toEqual(["alice"]);
      // Profile should still be updated even on re-join
      expect(profileManager.setProfile).toHaveBeenCalledTimes(2);
      // Only 1 AudioService should have been created (not 2)
      expect(mockAudioInstances.length).toBe(1);
    });
  });

  // ── 2. pairUsers wires services correctly ──

  describe("pairUsers", () => {
    it("should pair users when second user joins a room", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const users = rm.getRoomUsers("room-1");
      expect(users).toContain("alice");
      expect(users).toContain("bob");
      expect(users.length).toBe(2);
    });

    it("should create InProcessPeer pair when pairing", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      expect(InProcessPeer.createPair).toHaveBeenCalledWith("alice", "bob");
    });

    it("should create NegotiationService when pairing", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      expect(mockNegotiationInstances.length).toBe(1);
    });

    it("should create DocumentService when pairing", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      expect(mockDocumentInstances.length).toBe(1);
    });

    it("should set session status to active for both users", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      expect(mockSessionInstances[0].setStatus).toHaveBeenCalledWith("active");
      expect(mockSessionInstances[1].setStatus).toHaveBeenCalledWith("active");
    });

    it("should call buildTools and setTools for each agent", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      expect(buildTools).toHaveBeenCalledTimes(2);
      expect(mockAgentInstances[0].setTools).toHaveBeenCalled();
      expect(mockAgentInstances[1].setTools).toHaveBeenCalled();
    });

    it("should start both agents with their respective profiles", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      expect(mockAgentInstances[0].start).toHaveBeenCalled();
      expect(mockAgentInstances[1].start).toHaveBeenCalled();
    });

    it("should wire agent message events to panel emitter", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      for (const agentInstance of mockAgentInstances) {
        const onCalls = agentInstance.on.mock.calls.map((c: any[]) => c[0]);
        expect(onCalls).toContain("agent:message");
        expect(onCalls).toContain("agent:tool_call");
      }
    });

    it("should broadcast active status after pairing", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      expect(panelEmitter.broadcast).toHaveBeenCalledWith("room-1", {
        panel: "status",
        roomId: "room-1",
        users: expect.arrayContaining(["alice", "bob"]),
        sessionStatus: "active",
      });
    });

    it("should wire negotiation events (started, updated, agreed, rejected, expired)", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const negInstance = mockNegotiationInstances[0];
      const registeredEvents = negInstance.on.mock.calls.map(
        (c: any[]) => c[0],
      );

      expect(registeredEvents).toContain("negotiation:started");
      expect(registeredEvents).toContain("negotiation:updated");
      expect(registeredEvents).toContain("negotiation:agreed");
      expect(registeredEvents).toContain("negotiation:rejected");
      expect(registeredEvents).toContain("negotiation:expired");
    });

    it("should wire peer message routing so peerA messages go to negotiation and agentB", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      expect(mockPeerInstances.length).toBe(2);
      const peerA = mockPeerInstances[0];
      const peerB = mockPeerInstances[1];

      const peerAEvents = peerA.on.mock.calls.map((c: any[]) => c[0]);
      const peerBEvents = peerB.on.mock.calls.map((c: any[]) => c[0]);

      expect(peerAEvents).toContain("message");
      expect(peerBEvents).toContain("message");
    });
  });

  // ── 3. leaveRoom cleans up slots ──

  describe("leaveRoom", () => {
    it("should remove user from room", () => {
      rm.joinRoom("room-1", "alice", makeProfile());
      rm.leaveRoom("room-1", "alice");

      expect(rm.getRoomUsers("room-1")).toEqual([]);
    });

    it("should call cleanup on all slot services", () => {
      rm.joinRoom("room-1", "alice", makeProfile());
      rm.leaveRoom("room-1", "alice");

      expect(mockAgentInstances[0].stop).toHaveBeenCalled();
      expect(mockTriggerDetectorInstances[0].destroy).toHaveBeenCalled();
      expect(mockTranscriptionInstances[0].stop).toHaveBeenCalled();
      expect(mockAudioInstances[0].destroy).toHaveBeenCalled();
      expect(mockSessionInstances[0].reset).toHaveBeenCalled();
      expect(panelEmitter.unregisterSocket).toHaveBeenCalledWith("alice");
    });

    it("should destroy audioRelay and negotiation when last user leaves", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const audioRelay = mockAudioRelayInstances[0];

      rm.leaveRoom("room-1", "alice");
      rm.leaveRoom("room-1", "bob");

      expect(audioRelay.destroy).toHaveBeenCalled();
      expect(rm.getRoomUsers("room-1")).toEqual([]);
    });

    it("should be a no-op for a non-existent room", () => {
      rm.leaveRoom("non-existent", "alice");
    });

    it("should set room.paired to false after a user leaves", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      rm.leaveRoom("room-1", "alice");

      const prevPeerCount = mockPeerInstances.length;
      rm.joinRoom("room-1", "charlie", makeProfile({ displayName: "Charlie" }));

      // Should re-pair with new peer instances
      expect(mockPeerInstances.length).toBeGreaterThan(prevPeerCount);
    });
  });

  // ── 4. Room full rejection ──

  describe("room full rejection", () => {
    it("should throw when a third user tries to join a full room", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      expect(() =>
        rm.joinRoom(
          "room-1",
          "charlie",
          makeProfile({ displayName: "Charlie" }),
        ),
      ).toThrow("Room is full");
    });

    it("should allow 2 users in the same room", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      expect(rm.getRoomUsers("room-1").length).toBe(2);
    });
  });

  // ── 5. Max rooms rejection ──

  describe("max rooms rejection", () => {
    it("should throw when exceeding 50 rooms", () => {
      for (let i = 0; i < 50; i++) {
        rm.joinRoom(
          `room-${i}`,
          `user-${i}`,
          makeProfile({ displayName: `User ${i}` }),
        );
      }

      expect(() =>
        rm.joinRoom(
          "room-50",
          "extra-user",
          makeProfile({ displayName: "Extra" }),
        ),
      ).toThrow("Maximum rooms reached");
    });

    it("should allow exactly 50 rooms", () => {
      for (let i = 0; i < 50; i++) {
        rm.joinRoom(
          `room-${i}`,
          `user-${i}`,
          makeProfile({ displayName: `User ${i}` }),
        );
      }

      expect(rm.getRoomUsers("room-0")).toEqual(["user-0"]);
      expect(rm.getRoomUsers("room-49")).toEqual(["user-49"]);
    });
  });

  // ── 6. registerAudioSocket before/after joinRoom ──

  describe("registerAudioSocket", () => {
    it("should close socket with 4003 if room does not exist after polling timeout", () => {
      vi.useFakeTimers();
      const ws = makeMockWebSocket();
      rm.registerAudioSocket("non-existent", "alice", ws);

      // Should not close immediately — polling for room
      expect(ws.close).not.toHaveBeenCalled();

      // Advance past the 5s polling timeout
      vi.advanceTimersByTime(5000);

      expect(ws.close).toHaveBeenCalledWith(4003, "Room not found");
      vi.useRealTimers();
    });

    it("should wire audio socket when room+slot appear during polling", () => {
      vi.useFakeTimers();
      const ws = makeMockWebSocket();

      // Register audio socket BEFORE any room exists
      rm.registerAudioSocket("room-1", "alice", ws);
      expect(ws.close).not.toHaveBeenCalled();

      // Alice joins — creates room AND slot
      rm.joinRoom("room-1", "alice", makeProfile());

      // Advance one poll interval
      vi.advanceTimersByTime(200);

      // Should have wired up instead of closing
      expect(ws.close).not.toHaveBeenCalled();
      const audioRelay = mockAudioRelayInstances[0];
      expect(audioRelay.registerUser).toHaveBeenCalledWith("alice", ws);
      vi.useRealTimers();
    });

    it("should close socket with 4004 if user is not in room after polling timeout", () => {
      vi.useFakeTimers();
      rm.joinRoom("room-1", "alice", makeProfile());
      const ws = makeMockWebSocket();

      rm.registerAudioSocket("room-1", "bob", ws);

      // Should not close immediately — polling for slot
      expect(ws.close).not.toHaveBeenCalled();

      // Advance past the 5s polling timeout (25 * 200ms)
      vi.advanceTimersByTime(5000);

      expect(ws.close).toHaveBeenCalledWith(4004, "User not in room");
      vi.useRealTimers();
    });

    it("should wire audio socket when slot appears during polling", () => {
      vi.useFakeTimers();
      rm.joinRoom("room-1", "alice", makeProfile());
      const ws = makeMockWebSocket();

      // Register audio socket for bob BEFORE bob joins the room
      rm.registerAudioSocket("room-1", "bob", ws);
      expect(ws.close).not.toHaveBeenCalled();

      // Bob joins room — creates the slot
      rm.joinRoom("room-1", "bob", makeProfile());

      // Advance one poll interval
      vi.advanceTimersByTime(200);

      // Should have wired up instead of closing
      expect(ws.close).not.toHaveBeenCalled();
      const audioRelay = mockAudioRelayInstances[0];
      expect(audioRelay.registerUser).toHaveBeenCalledWith("bob", ws);
      vi.useRealTimers();
    });

    it("should register audio socket and start transcription", () => {
      rm.joinRoom("room-1", "alice", makeProfile());
      const ws = makeMockWebSocket();

      rm.registerAudioSocket("room-1", "alice", ws);

      const audioRelay = mockAudioRelayInstances[0];
      expect(audioRelay.registerUser).toHaveBeenCalledWith("alice", ws);
      expect(mockTranscriptionInstances[0].start).toHaveBeenCalled();
    });

    it("should wire ws message event to feed audio and relay", () => {
      rm.joinRoom("room-1", "alice", makeProfile());
      const ws = makeMockWebSocket();

      rm.registerAudioSocket("room-1", "alice", ws);

      const messageHandler = ws.on.mock.calls.find(
        (c: any[]) => c[0] === "message",
      );
      expect(messageHandler).toBeDefined();
    });

    it("should wire ws close event to unregister from relay", () => {
      rm.joinRoom("room-1", "alice", makeProfile());
      const ws = makeMockWebSocket();

      rm.registerAudioSocket("room-1", "alice", ws);

      const closeHandler = ws.on.mock.calls.find(
        (c: any[]) => c[0] === "close",
      );
      expect(closeHandler).toBeDefined();
    });

    it("should send error to panel when transcription start fails", async () => {
      rm.joinRoom("room-1", "alice", makeProfile());

      // Override the transcription start to reject
      const transcription = mockTranscriptionInstances[0];
      transcription.start.mockRejectedValueOnce(
        new Error("ElevenLabs connection failed"),
      );

      const ws = makeMockWebSocket();
      rm.registerAudioSocket("room-1", "alice", ws);

      // Allow the rejected promise to propagate
      await vi.waitFor(() => {
        expect(panelEmitter.sendToUser).toHaveBeenCalledWith("alice", {
          panel: "error",
          message: "Transcription failed: ElevenLabs connection failed",
        });
      });
    });
  });

  // ── 7. handleClientMessage dispatching ──

  describe("handleClientMessage", () => {
    it("should dispatch set_profile to profileManager", () => {
      const profile = makeProfile({ displayName: "Updated Alice" });
      rm.handleClientMessage("alice", { type: "set_profile", profile });

      expect(profileManager.setProfile).toHaveBeenCalledWith("alice", profile);
    });

    it("should dispatch sign_document to DocumentService", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      rm.handleClientMessage("alice", {
        type: "sign_document",
        documentId: "doc_1",
      });

      expect(mockDocumentInstances[0].signDocument).toHaveBeenCalledWith(
        "doc_1",
        "alice",
      );
    });

    it("should dispatch set_trigger_keyword to TriggerDetector", () => {
      rm.joinRoom("room-1", "alice", makeProfile());

      rm.handleClientMessage("alice", {
        type: "set_trigger_keyword",
        keyword: "deal",
      });

      expect(mockTriggerDetectorInstances[0].setKeyword).toHaveBeenCalledWith(
        "deal",
      );
    });

    it("should dispatch join_room to joinRoom with existing or default profile", () => {
      const profile = makeProfile({ displayName: "Alice Custom" });
      profileManager._profiles.set("alice", profile);

      rm.handleClientMessage("alice", {
        type: "join_room",
        roomId: "room-2",
      });

      expect(rm.getRoomUsers("room-2")).toContain("alice");
    });

    it("should use default profile for join_room when no profile is set", () => {
      profileManager.getProfile.mockReturnValue(undefined);

      rm.handleClientMessage("alice", {
        type: "join_room",
        roomId: "room-3",
      });

      expect(profileManager.getDefaultProfile).toHaveBeenCalledWith("alice");
      expect(rm.getRoomUsers("room-3")).toContain("alice");
    });

    it("should not throw for sign_document when user is not in any room", () => {
      rm.handleClientMessage("alice", {
        type: "sign_document",
        documentId: "doc_1",
      });
    });

    it("should not throw for set_trigger_keyword when user is not in any room", () => {
      rm.handleClientMessage("alice", {
        type: "set_trigger_keyword",
        keyword: "deal",
      });
    });
  });

  // ── 8. destroy cleans up all rooms ──

  describe("destroy", () => {
    it("should clean up all slots across all rooms", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-2", "bob", makeProfile({ displayName: "Bob" }));

      rm.destroy();

      expect(rm.getRoomUsers("room-1")).toEqual([]);
      expect(rm.getRoomUsers("room-2")).toEqual([]);
    });

    it("should stop all agents and destroy all audio services", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      rm.destroy();

      for (const agent of mockAgentInstances) {
        expect(agent.stop).toHaveBeenCalled();
      }
      for (const audio of mockAudioInstances) {
        expect(audio.destroy).toHaveBeenCalled();
      }
      for (const td of mockTriggerDetectorInstances) {
        expect(td.destroy).toHaveBeenCalled();
      }
    });

    it("should destroy audioRelay and negotiation for all rooms", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      rm.destroy();

      expect(mockAudioRelayInstances[0].destroy).toHaveBeenCalled();
      expect(mockNegotiationInstances[0].destroy).toHaveBeenCalled();
    });

    it("should handle destroy on empty RoomManager without error", () => {
      rm.destroy();
    });
  });

  // ── 9. Event listener wiring verification ──

  describe("document event wiring", () => {
    it("should wire document:signed, document:completed, and document:generated events on agreement", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const docInstance = mockDocumentInstances[0];
      const negInstance = mockNegotiationInstances[0];
      const agreedCall = negInstance.on.mock.calls.find(
        (c: any[]) => c[0] === "negotiation:agreed",
      );
      expect(agreedCall).toBeDefined();

      const mockNeg = makeNegotiationFixture();

      // Trigger the agreed handler
      const agreedHandler = agreedCall![1];
      agreedHandler(mockNeg);

      // Verify document events are wired correctly
      // document:signed uses .on() so both signatures broadcast
      const onCalls = docInstance.on.mock.calls.map((c: any[]) => c[0]);
      expect(onCalls).toContain("document:signed");
      // document:completed and document:generated use .once()
      const onceCalls = docInstance.once.mock.calls.map((c: any[]) => c[0]);
      expect(onceCalls).toContain("document:completed");
      expect(onceCalls).toContain("document:generated");
    });

    it("should call injectInstruction on initiator agent when agreement is reached", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const negInstance = mockNegotiationInstances[0];
      const agreedCall = negInstance.on.mock.calls.find(
        (c: any[]) => c[0] === "negotiation:agreed",
      );
      expect(agreedCall).toBeDefined();

      const mockNeg = makeNegotiationFixture({ initiator: "alice" });

      const agreedHandler = agreedCall![1];
      agreedHandler(mockNeg);

      // The initiator's agent (alice = first agent) should have injectInstruction called
      expect(mockAgentInstances[0].injectInstruction).toHaveBeenCalledWith(
        expect.stringContaining("AGREEMENT REACHED"),
      );
    });

    it("should set session status to signing when agreement is reached", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const negInstance = mockNegotiationInstances[0];
      const agreedCall = negInstance.on.mock.calls.find(
        (c: any[]) => c[0] === "negotiation:agreed",
      );

      mockSessionInstances[0].setStatus.mockClear();
      mockSessionInstances[1].setStatus.mockClear();

      const agreedHandler = agreedCall![1];
      agreedHandler(makeNegotiationFixture());

      expect(mockSessionInstances[0].setStatus).toHaveBeenCalledWith("signing");
      expect(mockSessionInstances[1].setStatus).toHaveBeenCalledWith("signing");
    });
  });

  // ── 10. Payment failure tracking ──

  describe("payment failure tracking", () => {
    it("should broadcast payment summary with succeeded/failed counts when failures occur", async () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", stripeAccountId: "acct_bob" }),
      );

      const paymentInstance = mockPaymentInstances[0];
      paymentInstance.executePayment
        .mockResolvedValueOnce({ success: true, paymentIntentId: "pi_1" })
        .mockResolvedValueOnce({ success: false, error: "Card declined" });

      const mockNeg = makeNegotiationFixture({
        currentProposal: {
          summary: "Test",
          lineItems: [
            {
              description: "Labour",
              amount: 10000,
              type: "immediate" as const,
            },
            {
              description: "Parts",
              amount: 5000,
              type: "immediate" as const,
            },
          ],
          totalAmount: 15000,
          currency: "gbp",
          conditions: [],
          expiresAt: Date.now() + 30000,
        },
      });

      await (rm as any).executePayments(
        (rm as any).rooms.get("room-1"),
        mockNeg,
      );

      expect(panelEmitter.broadcast).toHaveBeenCalledWith(
        "room-1",
        expect.objectContaining({
          panel: "execution",
          step: "payment_summary",
          status: "partial_failure",
          details: "1 succeeded, 1 failed out of 2 items",
        }),
      );
    });

    it("should not broadcast payment_summary when all payments succeed", async () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", stripeAccountId: "acct_bob" }),
      );

      const paymentInstance = mockPaymentInstances[0];
      paymentInstance.executePayment
        .mockResolvedValueOnce({ success: true, paymentIntentId: "pi_1" })
        .mockResolvedValueOnce({ success: true, paymentIntentId: "pi_2" });

      const mockNeg = makeNegotiationFixture({
        currentProposal: {
          summary: "Test",
          lineItems: [
            {
              description: "Labour",
              amount: 10000,
              type: "immediate" as const,
            },
            {
              description: "Parts",
              amount: 5000,
              type: "immediate" as const,
            },
          ],
          totalAmount: 15000,
          currency: "gbp",
          conditions: [],
          expiresAt: Date.now() + 30000,
        },
      });

      panelEmitter.broadcast.mockClear();

      await (rm as any).executePayments(
        (rm as any).rooms.get("room-1"),
        mockNeg,
      );

      const summaryCall = panelEmitter.broadcast.mock.calls.find(
        (c: any[]) =>
          c[1]?.panel === "execution" && c[1]?.step === "payment_summary",
      );
      expect(summaryCall).toBeUndefined();
    });

    it("should handle escrow line items in payment execution", async () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", stripeAccountId: "acct_bob" }),
      );

      const mockNeg = makeNegotiationFixture({
        currentProposal: {
          summary: "Test",
          lineItems: [
            {
              description: "Deposit",
              amount: 5000,
              type: "escrow" as const,
            },
          ],
          totalAmount: 5000,
          currency: "gbp",
          conditions: [],
          expiresAt: Date.now() + 30000,
        },
      });

      await (rm as any).executePayments(
        (rm as any).rooms.get("room-1"),
        mockNeg,
      );

      expect(mockPaymentInstances[0].createEscrowHold).toHaveBeenCalledWith({
        amount: 5000,
        currency: "gbp",
        description: "Deposit",
        recipientAccountId: "acct_bob",
        payerCustomerId: undefined,
      });

      expect(panelEmitter.broadcast).toHaveBeenCalledWith(
        "room-1",
        expect.objectContaining({
          panel: "execution",
          step: "escrow_Deposit",
          status: "done",
        }),
      );
    });

    it("should count escrow failures and broadcast failure details", async () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", stripeAccountId: "acct_bob" }),
      );

      const paymentInstance = mockPaymentInstances[0];
      paymentInstance.createEscrowHold.mockRejectedValueOnce(
        new Error("Stripe error"),
      );

      const mockNeg = makeNegotiationFixture({
        currentProposal: {
          summary: "Test",
          lineItems: [
            {
              description: "Deposit",
              amount: 5000,
              type: "escrow" as const,
            },
          ],
          totalAmount: 5000,
          currency: "gbp",
          conditions: [],
          expiresAt: Date.now() + 30000,
        },
      });

      await (rm as any).executePayments(
        (rm as any).rooms.get("room-1"),
        mockNeg,
      );

      expect(panelEmitter.broadcast).toHaveBeenCalledWith(
        "room-1",
        expect.objectContaining({
          panel: "execution",
          step: "escrow_Deposit",
          status: "failed",
          details: "Stripe error",
        }),
      );

      expect(panelEmitter.broadcast).toHaveBeenCalledWith(
        "room-1",
        expect.objectContaining({
          panel: "execution",
          step: "payment_summary",
          status: "partial_failure",
          details: "0 succeeded, 1 failed out of 1 items",
        }),
      );
    });

    it("should set session status to completed after payment execution", async () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", stripeAccountId: "acct_bob" }),
      );

      const mockNeg = makeNegotiationFixture();

      await (rm as any).executePayments(
        (rm as any).rooms.get("room-1"),
        mockNeg,
      );

      expect(mockSessionInstances[0].setStatus).toHaveBeenCalledWith(
        "completed",
      );
      expect(mockSessionInstances[1].setStatus).toHaveBeenCalledWith(
        "completed",
      );
    });

    it("should broadcast completed status after payment execution", async () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", stripeAccountId: "acct_bob" }),
      );

      panelEmitter.broadcast.mockClear();
      const mockNeg = makeNegotiationFixture();

      await (rm as any).executePayments(
        (rm as any).rooms.get("room-1"),
        mockNeg,
      );

      expect(panelEmitter.broadcast).toHaveBeenCalledWith("room-1", {
        panel: "status",
        roomId: "room-1",
        users: expect.arrayContaining(["alice", "bob"]),
        sessionStatus: "completed",
      });
    });
  });

  // ── Additional edge cases ──────────────────────────

  describe("getRoomUsers", () => {
    it("should return empty array for non-existent room", () => {
      expect(rm.getRoomUsers("non-existent")).toEqual([]);
    });

    it("should return current users in a room", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      expect(rm.getRoomUsers("room-1")).toEqual(["alice"]);
    });
  });

  describe("MonzoService creation", () => {
    it("should create MonzoService when profile has monzoAccessToken", () => {
      const profile = makeProfile({ monzoAccessToken: "monzo_token_123" });
      profileManager._profiles.set("alice", profile);
      profileManager.getProfile.mockReturnValue(profile);

      rm.joinRoom("room-1", "alice", profile);

      expect(mockMonzoInstances.length).toBe(1);
      expect(mockMonzoInstances[0].setAccessToken).toHaveBeenCalledWith(
        "monzo_token_123",
      );
    });

    it("should not create MonzoService when profile lacks monzoAccessToken", () => {
      const profile = makeProfile();
      rm.joinRoom("room-1", "alice", profile);

      expect(mockMonzoInstances.length).toBe(0);
    });
  });

  describe("registerPanelSocket", () => {
    it("should register socket and set room in panel emitter", () => {
      rm.joinRoom("room-1", "alice", makeProfile());
      const ws = makeMockWebSocket();

      rm.registerPanelSocket("room-1", "alice", ws);

      expect(panelEmitter.registerSocket).toHaveBeenCalledWith("alice", ws);
      expect(panelEmitter.setRoom).toHaveBeenCalledWith("alice", "room-1");
    });

    it("should send current room status to newly connected panel socket", () => {
      rm.joinRoom("room-1", "alice", makeProfile());
      panelEmitter.sendToUser.mockClear();

      const ws = makeMockWebSocket();
      rm.registerPanelSocket("room-1", "alice", ws);

      expect(panelEmitter.sendToUser).toHaveBeenCalledWith("alice", {
        panel: "status",
        roomId: "room-1",
        users: ["alice"],
        sessionStatus: "discovering",
      });
    });

    it("should register message handler on websocket for client messages", () => {
      rm.joinRoom("room-1", "alice", makeProfile());
      const ws = makeMockWebSocket();

      rm.registerPanelSocket("room-1", "alice", ws);

      const messageCall = ws.on.mock.calls.find(
        (c: any[]) => c[0] === "message",
      );
      expect(messageCall).toBeDefined();
    });
  });

  describe("multiple rooms isolation", () => {
    it("should keep rooms independent from each other", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-2", "bob", makeProfile({ displayName: "Bob" }));

      expect(rm.getRoomUsers("room-1")).toEqual(["alice"]);
      expect(rm.getRoomUsers("room-2")).toEqual(["bob"]);

      rm.leaveRoom("room-1", "alice");

      expect(rm.getRoomUsers("room-1")).toEqual([]);
      expect(rm.getRoomUsers("room-2")).toEqual(["bob"]);
    });
  });

  describe("dual-keyword coordination", () => {
    function getTriggerHandler(slotIndex: number) {
      const td = mockTriggerDetectorInstances[slotIndex];
      const call = td.on.mock.calls.find((c: any[]) => c[0] === "triggered");
      expect(call).toBeDefined();
      return call![1];
    }

    function makeTriggerEvent(speakerId: string) {
      return {
        type: "keyword" as const,
        confidence: 1.0,
        matchedText: "handshake",
        timestamp: Date.now(),
        speakerId,
      };
    }

    it("should set pending trigger when first user triggers", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const triggerAlice = getTriggerHandler(0);
      triggerAlice(makeTriggerEvent("alice"));

      const room = (rm as any).rooms.get("room-1");
      expect(room.pendingTrigger).not.toBeNull();
      expect(room.pendingTrigger.userId).toBe("alice");

      // Should NOT start negotiation yet
      expect(mockAgentInstances[0].startNegotiation).not.toHaveBeenCalled();
      expect(mockAgentInstances[1].startNegotiation).not.toHaveBeenCalled();
    });

    it("should send 'waiting' message to first user", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      panelEmitter.sendToUser.mockClear();

      const triggerAlice = getTriggerHandler(0);
      triggerAlice(makeTriggerEvent("alice"));

      expect(panelEmitter.sendToUser).toHaveBeenCalledWith(
        "alice",
        expect.objectContaining({
          panel: "agent",
          text: expect.stringContaining("Waiting for other party"),
        }),
      );
    });

    it("should start negotiation when second different user triggers", () => {
      rm.joinRoom(
        "room-1",
        "alice",
        makeProfile({ displayName: "Alice", role: "homeowner" }),
      );
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", role: "plumber" }),
      );

      const triggerAlice = getTriggerHandler(0);
      const triggerBob = getTriggerHandler(1);

      triggerAlice(makeTriggerEvent("alice"));
      triggerBob(makeTriggerEvent("bob"));

      // Provider (bob=plumber) should be the initiator
      expect(mockAgentInstances[1].startNegotiation).toHaveBeenCalled();
    });

    it("should ignore duplicate trigger from same user", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const triggerAlice = getTriggerHandler(0);
      triggerAlice(makeTriggerEvent("alice"));
      triggerAlice(makeTriggerEvent("alice"));

      // Still pending, no negotiation started
      expect(mockAgentInstances[0].startNegotiation).not.toHaveBeenCalled();
      expect(mockAgentInstances[1].startNegotiation).not.toHaveBeenCalled();
    });

    it("should clear pending trigger on timeout", () => {
      vi.useFakeTimers();
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const triggerAlice = getTriggerHandler(0);
      triggerAlice(makeTriggerEvent("alice"));

      const room = (rm as any).rooms.get("room-1");
      expect(room.pendingTrigger).not.toBeNull();

      vi.advanceTimersByTime(20_000);

      expect(room.pendingTrigger).toBeNull();
      expect(room.pendingTriggerTimeout).toBeNull();
      // Trigger detector should be reset so user can try again
      expect(mockTriggerDetectorInstances[0].reset).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("should ignore trigger when negotiation is already active", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const negInstance = mockNegotiationInstances[0];
      negInstance.getActiveNegotiation.mockReturnValue({ id: "neg_active" });

      const triggerAlice = getTriggerHandler(0);
      triggerAlice(makeTriggerEvent("alice"));

      const room = (rm as any).rooms.get("room-1");
      expect(room.pendingTrigger).toBeNull();
      expect(mockAgentInstances[0].startNegotiation).not.toHaveBeenCalled();
    });

    it("should select provider role as initiator (proposer)", () => {
      rm.joinRoom(
        "room-1",
        "alice",
        makeProfile({ displayName: "Alice", role: "homeowner" }),
      );
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", role: "contractor" }),
      );

      const triggerAlice = getTriggerHandler(0);
      const triggerBob = getTriggerHandler(1);

      triggerAlice(makeTriggerEvent("alice"));
      triggerBob(makeTriggerEvent("bob"));

      // bob (contractor=provider) should be the initiator
      expect(mockAgentInstances[1].startNegotiation).toHaveBeenCalled();
      expect(mockAgentInstances[0].startNegotiation).not.toHaveBeenCalled();
    });

    it("should fallback to first speaker when no provider role found", () => {
      rm.joinRoom(
        "room-1",
        "alice",
        makeProfile({ displayName: "Alice", role: "participant" }),
      );
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", role: "participant" }),
      );

      const triggerAlice = getTriggerHandler(0);
      const triggerBob = getTriggerHandler(1);

      // Alice triggers first, then Bob
      triggerAlice(makeTriggerEvent("alice"));
      triggerBob(makeTriggerEvent("bob"));

      // The event.speakerId in handleTrigger will be "bob" (the second trigger),
      // but since neither has provider role, fallback to event.speakerId
      // The event is the bob trigger with type changed to dual_keyword
      expect(
        mockAgentInstances[0].startNegotiation.mock.calls.length +
          mockAgentInstances[1].startNegotiation.mock.calls.length,
      ).toBe(1);
    });

    it("should emit dual_keyword type in trigger event", () => {
      rm.joinRoom(
        "room-1",
        "alice",
        makeProfile({ displayName: "Alice", role: "homeowner" }),
      );
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", role: "plumber" }),
      );

      const triggerAlice = getTriggerHandler(0);
      const triggerBob = getTriggerHandler(1);

      triggerAlice(makeTriggerEvent("alice"));
      triggerBob(makeTriggerEvent("bob"));

      const call = mockAgentInstances[1].startNegotiation.mock.calls[0];
      expect(call[0].type).toBe("dual_keyword");
    });

    it("should block triggers when triggerInProgress is set", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const room = (rm as any).rooms.get("room-1");
      room.triggerInProgress = true;

      const triggerAlice = getTriggerHandler(0);
      triggerAlice(makeTriggerEvent("alice"));

      expect(room.pendingTrigger).toBeNull();
      expect(mockAgentInstances[0].startNegotiation).not.toHaveBeenCalled();
    });
  });

  describe("negotiation rejected/expired resets triggers", () => {
    it("should reset trigger detectors and session status on negotiation:rejected", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const negInstance = mockNegotiationInstances[0];
      const rejectedCall = negInstance.on.mock.calls.find(
        (c: any[]) => c[0] === "negotiation:rejected",
      );
      expect(rejectedCall).toBeDefined();

      // Clear earlier setStatus calls
      mockSessionInstances[0].setStatus.mockClear();
      mockSessionInstances[1].setStatus.mockClear();

      const rejectedHandler = rejectedCall![1];
      rejectedHandler(makeNegotiationFixture({ status: "rejected" }));

      expect(mockSessionInstances[0].setStatus).toHaveBeenCalledWith("active");
      expect(mockSessionInstances[1].setStatus).toHaveBeenCalledWith("active");
      expect(mockTriggerDetectorInstances[0].reset).toHaveBeenCalled();
      expect(mockTriggerDetectorInstances[1].reset).toHaveBeenCalled();
    });

    it("should reset trigger detectors and session status on negotiation:expired", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const negInstance = mockNegotiationInstances[0];
      const expiredCall = negInstance.on.mock.calls.find(
        (c: any[]) => c[0] === "negotiation:expired",
      );
      expect(expiredCall).toBeDefined();

      mockSessionInstances[0].setStatus.mockClear();
      mockSessionInstances[1].setStatus.mockClear();

      const expiredHandler = expiredCall![1];
      expiredHandler(makeNegotiationFixture({ status: "expired" }));

      expect(mockSessionInstances[0].setStatus).toHaveBeenCalledWith("active");
      expect(mockSessionInstances[1].setStatus).toHaveBeenCalledWith("active");
      expect(mockTriggerDetectorInstances[0].reset).toHaveBeenCalled();
      expect(mockTriggerDetectorInstances[1].reset).toHaveBeenCalled();
    });
  });

  // ── 11. Trigger race guard (triggerInProgress) with dual-keyword ──

  describe("trigger race guard with dual-keyword", () => {
    function getTriggerHandler(slotIndex: number) {
      const td = mockTriggerDetectorInstances[slotIndex];
      const call = td.on.mock.calls.find((c: any[]) => c[0] === "triggered");
      return call![1];
    }

    function makeTriggerEvent(speakerId: string) {
      return {
        type: "keyword" as const,
        confidence: 1.0,
        matchedText: "handshake",
        timestamp: Date.now(),
        speakerId,
      };
    }

    it("should block new dual-keyword while triggerInProgress is set", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const negInstance = mockNegotiationInstances[0];
      negInstance.getActiveNegotiation.mockReturnValue(undefined);

      const triggerAlice = getTriggerHandler(0);
      const triggerBob = getTriggerHandler(1);

      // Complete dual-keyword handshake
      triggerAlice(makeTriggerEvent("alice"));
      triggerBob(makeTriggerEvent("bob"));

      // triggerInProgress should now be true
      const room = (rm as any).rooms.get("room-1");
      expect(room.triggerInProgress).toBe(true);

      // Reset trigger detectors (they're already triggered internally)
      mockTriggerDetectorInstances[0].reset();
      mockTriggerDetectorInstances[1].reset();

      // New trigger attempts should be blocked
      triggerAlice(makeTriggerEvent("alice"));
      expect(room.pendingTrigger).toBeNull();
    });

    it("should reset triggerInProgress on negotiation:rejected and allow new dual-keyword", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const negInstance = mockNegotiationInstances[0];
      negInstance.getActiveNegotiation.mockReturnValue(undefined);

      const triggerAlice = getTriggerHandler(0);
      const triggerBob = getTriggerHandler(1);

      // Complete dual-keyword handshake
      triggerAlice(makeTriggerEvent("alice"));
      triggerBob(makeTriggerEvent("bob"));

      // Reject the negotiation
      const rejectedHandler = negInstance.on.mock.calls.find(
        (c: any[]) => c[0] === "negotiation:rejected",
      )![1];
      rejectedHandler(makeNegotiationFixture({ status: "rejected" }));

      // triggerInProgress should be reset
      const room = (rm as any).rooms.get("room-1");
      expect(room.triggerInProgress).toBe(false);
      expect(room.pendingTrigger).toBeNull();
    });

    it("should reset triggerInProgress on negotiation:expired", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const negInstance = mockNegotiationInstances[0];
      negInstance.getActiveNegotiation.mockReturnValue(undefined);

      const triggerAlice = getTriggerHandler(0);
      const triggerBob = getTriggerHandler(1);

      // Complete dual-keyword handshake
      triggerAlice(makeTriggerEvent("alice"));
      triggerBob(makeTriggerEvent("bob"));

      // Expire the negotiation
      const expiredHandler = negInstance.on.mock.calls.find(
        (c: any[]) => c[0] === "negotiation:expired",
      )![1];
      expiredHandler(makeNegotiationFixture({ status: "expired" }));

      const room = (rm as any).rooms.get("room-1");
      expect(room.triggerInProgress).toBe(false);
      expect(room.pendingTrigger).toBeNull();
    });
  });

  // ── 12. Payment idempotency guard ──

  describe("payment idempotency", () => {
    it("should prevent duplicate payment execution", async () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({ displayName: "Bob", stripeAccountId: "acct_bob" }),
      );

      const mockNeg = makeNegotiationFixture();
      const room = (rm as any).rooms.get("room-1");

      await (rm as any).executePayments(room, mockNeg);
      const firstCallCount =
        mockPaymentInstances[0].executePayment.mock.calls.length;

      // Second call should be no-op
      await (rm as any).executePayments(room, mockNeg);
      expect(mockPaymentInstances[0].executePayment.mock.calls.length).toBe(
        firstCallCount,
      );
    });
  });

  // ── 13. Audio socket close stops transcription ──

  describe("audio socket close handling", () => {
    it("should stop transcription when audio socket closes", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      const ws = makeMockWebSocket();

      rm.registerAudioSocket("room-1", "alice", ws);

      // Find the close handler
      const closeCall = ws.on.mock.calls.find((c: any[]) => c[0] === "close");
      expect(closeCall).toBeDefined();

      // Trigger close
      closeCall![1]();

      expect(mockTranscriptionInstances[0].stop).toHaveBeenCalled();
    });

    it("should unregister from audio relay when socket closes", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      const ws = makeMockWebSocket();

      rm.registerAudioSocket("room-1", "alice", ws);

      const closeCall = ws.on.mock.calls.find((c: any[]) => c[0] === "close");
      closeCall![1]();

      expect(mockAudioRelayInstances[0].unregisterUser).toHaveBeenCalledWith(
        "alice",
      );
    });
  });

  // ── 14. Panel socket close handling ──

  describe("panel socket close handling", () => {
    it("should unregister socket from panel emitter when panel socket closes", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      const ws = makeMockWebSocket();

      rm.registerPanelSocket("room-1", "alice", ws);

      const closeCall = ws.on.mock.calls.find((c: any[]) => c[0] === "close");
      expect(closeCall).toBeDefined();

      panelEmitter.unregisterSocket.mockClear();
      closeCall![1]();

      expect(panelEmitter.unregisterSocket).toHaveBeenCalledWith("alice");
    });
  });

  // ── 15. cleanupSlot paired conditional ──

  describe("cleanupSlot paired state", () => {
    it("should only set paired=false when slot count drops below 2", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const room = (rm as any).rooms.get("room-1");
      expect(room.paired).toBe(true);

      // Remove one user — drops to 1, so paired should become false
      rm.leaveRoom("room-1", "alice");
      expect(room.paired).toBe(false);
    });

    it("should destroy active negotiation when user leaves", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const negInstance = mockNegotiationInstances[0];
      negInstance.getActiveNegotiation.mockReturnValue({ id: "neg_active" });

      rm.leaveRoom("room-1", "alice");

      expect(negInstance.destroy).toHaveBeenCalled();
    });

    it("should reset triggerInProgress and pendingTrigger when user leaves and drops below 2", () => {
      rm.joinRoom("room-1", "alice", makeProfile({ displayName: "Alice" }));
      rm.joinRoom("room-1", "bob", makeProfile({ displayName: "Bob" }));

      const room = (rm as any).rooms.get("room-1");
      room.triggerInProgress = true;
      room.pendingTrigger = { userId: "alice", timestamp: Date.now() };

      rm.leaveRoom("room-1", "alice");

      expect(room.triggerInProgress).toBe(false);
      expect(room.pendingTrigger).toBeNull();
      expect(room.pendingTriggerTimeout).toBeNull();
    });
  });

  // ── 16. Bilateral milestone confirmation ──

  describe("bilateral milestone confirmation", () => {
    function setupRoomWithMilestoneDoc() {
      rm.joinRoom(
        "room-1",
        "alice",
        makeProfile({
          displayName: "Alice",
          role: "plumber",
          stripeAccountId: "acct_alice",
        }),
      );
      rm.joinRoom(
        "room-1",
        "bob",
        makeProfile({
          displayName: "Bob",
          role: "homeowner",
          stripeAccountId: "acct_bob",
        }),
      );

      const docInstance = mockDocumentInstances[0];
      const fixedMilestone = {
        id: "ms_fixed",
        documentId: "doc_1",
        lineItemIndex: 0,
        description: "Fix boiler",
        amount: 5000,
        condition: "Boiler working",
        status: "pending" as const,
        escrowHoldId: "hold_1",
      };
      const rangeMilestone = {
        id: "ms_range",
        documentId: "doc_1",
        lineItemIndex: 1,
        description: "Extra work",
        amount: 10000,
        condition: "Additional repairs",
        status: "pending" as const,
        escrowHoldId: "hold_2",
        minAmount: 3000,
        maxAmount: 10000,
      };
      const mockDoc = {
        id: "doc_1",
        title: "Agreement",
        content: "# Agreement",
        negotiationId: "neg_1",
        parties: [
          { userId: "alice", name: "Alice", role: "plumber" },
          { userId: "bob", name: "Bob", role: "homeowner" },
        ],
        terms: { currency: "gbp", lineItems: [] } as any,
        signatures: [],
        status: "fully_signed",
        providerId: "alice",
        clientId: "bob",
        milestones: [fixedMilestone, rangeMilestone],
        createdAt: Date.now(),
      };
      docInstance.getDocument.mockReturnValue(mockDoc);
      docInstance.updateMilestones.mockImplementation(
        (_docId: string, milestones: any[]) => {
          mockDoc.milestones = milestones;
        },
      );
      return { docInstance, mockDoc, fixedMilestone, rangeMilestone };
    }

    it("should set provider_confirmed when provider confirms first", () => {
      const { docInstance } = setupRoomWithMilestoneDoc();

      rm.handleClientMessage("alice", {
        type: "confirm_milestone",
        milestoneId: "ms_fixed",
        documentId: "doc_1",
      });

      expect(docInstance.updateMilestones).toHaveBeenCalled();
      const updatedMs = docInstance.updateMilestones.mock.calls[0][1];
      const fixed = updatedMs.find((m: any) => m.id === "ms_fixed");
      expect(fixed.status).toBe("provider_confirmed");
      expect(fixed.providerConfirmed).toBe(true);
      expect(fixed.clientConfirmed).toBe(false);
    });

    it("should set client_confirmed when client confirms first", () => {
      const { docInstance } = setupRoomWithMilestoneDoc();

      rm.handleClientMessage("bob", {
        type: "confirm_milestone",
        milestoneId: "ms_fixed",
        documentId: "doc_1",
      });

      const updatedMs = docInstance.updateMilestones.mock.calls[0][1];
      const fixed = updatedMs.find((m: any) => m.id === "ms_fixed");
      expect(fixed.status).toBe("client_confirmed");
      expect(fixed.clientConfirmed).toBe(true);
      expect(fixed.providerConfirmed).toBe(false);
    });

    it("should auto-capture and set completed when both confirm a fixed-price milestone", () => {
      const { docInstance, mockDoc } = setupRoomWithMilestoneDoc();

      // Provider confirms first
      rm.handleClientMessage("alice", {
        type: "confirm_milestone",
        milestoneId: "ms_fixed",
        documentId: "doc_1",
      });

      // Update mock to reflect the new state
      const firstUpdate = docInstance.updateMilestones.mock.calls[0][1];
      mockDoc.milestones = firstUpdate;
      docInstance.getDocument.mockReturnValue(mockDoc);

      // Client confirms second
      rm.handleClientMessage("bob", {
        type: "confirm_milestone",
        milestoneId: "ms_fixed",
        documentId: "doc_1",
      });

      const secondUpdate = docInstance.updateMilestones.mock.calls[1][1];
      const fixed = secondUpdate.find((m: any) => m.id === "ms_fixed");
      expect(fixed.status).toBe("completed");
      expect(fixed.providerConfirmed).toBe(true);
      expect(fixed.clientConfirmed).toBe(true);
      expect(fixed.completedAt).toBeDefined();
    });

    it("should set pending_amount when both confirm a range-priced milestone", () => {
      const { docInstance, mockDoc } = setupRoomWithMilestoneDoc();

      // Provider confirms
      rm.handleClientMessage("alice", {
        type: "confirm_milestone",
        milestoneId: "ms_range",
        documentId: "doc_1",
      });

      const firstUpdate = docInstance.updateMilestones.mock.calls[0][1];
      mockDoc.milestones = firstUpdate;
      docInstance.getDocument.mockReturnValue(mockDoc);

      // Client confirms
      rm.handleClientMessage("bob", {
        type: "confirm_milestone",
        milestoneId: "ms_range",
        documentId: "doc_1",
      });

      const secondUpdate = docInstance.updateMilestones.mock.calls[1][1];
      const range = secondUpdate.find((m: any) => m.id === "ms_range");
      expect(range.status).toBe("pending_amount");
    });

    it("should allow provider to propose amount for pending_amount milestone", () => {
      const { docInstance, mockDoc } = setupRoomWithMilestoneDoc();

      // Set milestone to pending_amount state
      mockDoc.milestones = mockDoc.milestones.map((m: any) =>
        m.id === "ms_range"
          ? {
              ...m,
              status: "pending_amount",
              providerConfirmed: true,
              clientConfirmed: true,
            }
          : m,
      );
      docInstance.getDocument.mockReturnValue(mockDoc);

      rm.handleClientMessage("alice", {
        type: "propose_milestone_amount",
        milestoneId: "ms_range",
        documentId: "doc_1",
        amount: 7500,
      });

      const updatedMs = docInstance.updateMilestones.mock.calls[0][1];
      const range = updatedMs.find((m: any) => m.id === "ms_range");
      expect(range.proposedAmount).toBe(7500);
      expect(range.proposedBy).toBe("alice");
    });

    it("should reject amount proposal from client", () => {
      const { mockDoc } = setupRoomWithMilestoneDoc();

      mockDoc.milestones = mockDoc.milestones.map((m: any) =>
        m.id === "ms_range"
          ? {
              ...m,
              status: "pending_amount",
              providerConfirmed: true,
              clientConfirmed: true,
            }
          : m,
      );

      rm.handleClientMessage("bob", {
        type: "propose_milestone_amount",
        milestoneId: "ms_range",
        documentId: "doc_1",
        amount: 7500,
      });

      expect(panelEmitter.sendToUser).toHaveBeenCalledWith(
        "bob",
        expect.objectContaining({
          panel: "error",
          message: "Only the provider can propose an amount",
        }),
      );
    });

    it("should allow client to approve proposed amount", () => {
      const { docInstance, mockDoc } = setupRoomWithMilestoneDoc();

      mockDoc.milestones = mockDoc.milestones.map((m: any) =>
        m.id === "ms_range"
          ? {
              ...m,
              status: "pending_amount",
              providerConfirmed: true,
              clientConfirmed: true,
              proposedAmount: 7500,
              proposedBy: "alice",
            }
          : m,
      );
      docInstance.getDocument.mockReturnValue(mockDoc);

      rm.handleClientMessage("bob", {
        type: "approve_milestone_amount",
        milestoneId: "ms_range",
        documentId: "doc_1",
      });

      const updatedMs = docInstance.updateMilestones.mock.calls[0][1];
      const range = updatedMs.find((m: any) => m.id === "ms_range");
      expect(range.status).toBe("completed");
      expect(range.amount).toBe(7500);
      expect(range.completedAt).toBeDefined();
    });

    it("should allow provider to release escrow", () => {
      const { docInstance } = setupRoomWithMilestoneDoc();

      rm.handleClientMessage("alice", {
        type: "release_escrow",
        milestoneId: "ms_fixed",
        documentId: "doc_1",
      });

      const updatedMs = docInstance.updateMilestones.mock.calls[0][1];
      const fixed = updatedMs.find((m: any) => m.id === "ms_fixed");
      expect(fixed.status).toBe("released");
    });

    it("should reject release from client", () => {
      setupRoomWithMilestoneDoc();

      rm.handleClientMessage("bob", {
        type: "release_escrow",
        milestoneId: "ms_fixed",
        documentId: "doc_1",
      });

      expect(panelEmitter.sendToUser).toHaveBeenCalledWith(
        "bob",
        expect.objectContaining({
          panel: "error",
          message: "Only the provider can release escrow",
        }),
      );
    });

    it("should reject duplicate confirmation from same side", () => {
      const { mockDoc } = setupRoomWithMilestoneDoc();

      mockDoc.milestones = mockDoc.milestones.map((m: any) =>
        m.id === "ms_fixed"
          ? { ...m, status: "provider_confirmed", providerConfirmed: true }
          : m,
      );

      rm.handleClientMessage("alice", {
        type: "confirm_milestone",
        milestoneId: "ms_fixed",
        documentId: "doc_1",
      });

      expect(panelEmitter.sendToUser).toHaveBeenCalledWith(
        "alice",
        expect.objectContaining({
          panel: "error",
          message: "You already confirmed this milestone",
        }),
      );
    });
  });
});
