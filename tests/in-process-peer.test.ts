import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InProcessPeer } from "../src/services/in-process-peer.js";
import type { AgentMessage } from "../src/types.js";

describe("InProcessPeer Module", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create a paired set of peers", () => {
    const [peerA, peerB] = InProcessPeer.createPair("alice", "bob");
    expect(peerA.getOtherUserId()).toBe("bob");
    expect(peerB.getOtherUserId()).toBe("alice");
  });

  it("should deliver messages from A to B asynchronously", async () => {
    const [peerA, peerB] = InProcessPeer.createPair("alice", "bob");

    const received: AgentMessage[] = [];
    peerB.on("message", (msg) => received.push(msg));

    const message: AgentMessage = {
      type: "agent_accept",
      negotiationId: "neg_1",
      fromAgent: "alice",
    };

    peerA.send(message);

    // Message should NOT arrive synchronously
    expect(received.length).toBe(0);

    // Wait for process.nextTick
    await new Promise((resolve) => process.nextTick(resolve));
    expect(received.length).toBe(1);
    expect(received[0].type).toBe("agent_accept");
  });

  it("should deliver messages from B to A", async () => {
    const [peerA, peerB] = InProcessPeer.createPair("alice", "bob");

    const received: AgentMessage[] = [];
    peerA.on("message", (msg) => received.push(msg));

    peerB.send({
      type: "agent_reject",
      negotiationId: "neg_1",
      reason: "too expensive",
      fromAgent: "bob",
    });

    await new Promise((resolve) => process.nextTick(resolve));
    expect(received.length).toBe(1);
    expect(received[0].type).toBe("agent_reject");
  });

  it("should copy messages (immutability)", async () => {
    const [peerA, peerB] = InProcessPeer.createPair("alice", "bob");

    const received: AgentMessage[] = [];
    peerB.on("message", (msg) => received.push(msg));

    const original: AgentMessage = {
      type: "agent_accept",
      negotiationId: "neg_1",
      fromAgent: "alice",
    };

    peerA.send(original);
    await new Promise((resolve) => process.nextTick(resolve));

    expect(received[0]).not.toBe(original);
    expect(received[0]).toEqual(original);
  });

  it("should throw when sending without partner", () => {
    // Create a peer manually without pair
    const peer = new InProcessPeer("alice", "bob");
    expect(() =>
      peer.send({
        type: "agent_accept",
        negotiationId: "neg_1",
        fromAgent: "alice",
      }),
    ).toThrow("No partner connected");
  });

  it("should support multiple messages in sequence", async () => {
    const [peerA, peerB] = InProcessPeer.createPair("alice", "bob");

    const received: AgentMessage[] = [];
    peerB.on("message", (msg) => received.push(msg));

    peerA.send({
      type: "agent_accept",
      negotiationId: "neg_1",
      fromAgent: "alice",
    });
    peerA.send({
      type: "agent_accept",
      negotiationId: "neg_2",
      fromAgent: "alice",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received.length).toBe(2);
  });

  it("should support bidirectional communication", async () => {
    const [peerA, peerB] = InProcessPeer.createPair("alice", "bob");

    const aReceived: AgentMessage[] = [];
    const bReceived: AgentMessage[] = [];
    peerA.on("message", (msg) => aReceived.push(msg));
    peerB.on("message", (msg) => bReceived.push(msg));

    peerA.send({
      type: "agent_accept",
      negotiationId: "neg_1",
      fromAgent: "alice",
    });
    peerB.send({
      type: "agent_reject",
      negotiationId: "neg_1",
      reason: "no",
      fromAgent: "bob",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(bReceived.length).toBe(1);
    expect(aReceived.length).toBe(1);
    expect(bReceived[0].fromAgent).toBe("alice");
    expect(aReceived[0].fromAgent).toBe("bob");
  });
});
