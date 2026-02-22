import { describe, it, expect, vi, beforeEach } from "vitest";
import { PanelEmitter } from "../src/services/panel-emitter.js";
import type { PanelMessage } from "../src/types.js";
import { EventEmitter } from "events";

// Mock WebSocket
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

describe("PanelEmitter Module", () => {
  let pe: PanelEmitter;

  beforeEach(() => {
    pe = new PanelEmitter();
  });

  it("should register a socket and send messages", () => {
    const ws = createMockWs();
    pe.registerSocket("alice", ws);

    const message: PanelMessage = {
      panel: "agent",
      userId: "alice",
      text: "Hello",
      timestamp: Date.now(),
    };
    pe.sendToUser("alice", message);

    expect(ws.send).toHaveBeenCalledOnce();
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual(message);
  });

  it("should not send to unregistered user", () => {
    const ws = createMockWs();
    pe.registerSocket("alice", ws);

    pe.sendToUser("bob", {
      panel: "agent",
      userId: "bob",
      text: "Hello",
      timestamp: Date.now(),
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it("should close existing socket on re-register", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    pe.registerSocket("alice", ws1);
    pe.registerSocket("alice", ws2);

    expect(ws1.close).toHaveBeenCalledWith(4002, "replaced");
  });

  it("should broadcast to all room members", () => {
    const wsA = createMockWs();
    const wsB = createMockWs();
    pe.registerSocket("alice", wsA);
    pe.registerSocket("bob", wsB);
    pe.setRoom("alice", "room-1");
    pe.setRoom("bob", "room-1");

    const message: PanelMessage = {
      panel: "status",
      roomId: "room-1",
      users: ["alice", "bob"],
      sessionStatus: "active",
    };
    pe.broadcast("room-1", message);

    expect(wsA.send).toHaveBeenCalledOnce();
    expect(wsB.send).toHaveBeenCalledOnce();
  });

  it("should not broadcast to users in other rooms", () => {
    const wsA = createMockWs();
    const wsB = createMockWs();
    pe.registerSocket("alice", wsA);
    pe.registerSocket("bob", wsB);
    pe.setRoom("alice", "room-1");
    pe.setRoom("bob", "room-2");

    pe.broadcast("room-1", {
      panel: "status",
      roomId: "room-1",
      users: ["alice"],
      sessionStatus: "active",
    });

    expect(wsA.send).toHaveBeenCalledOnce();
    expect(wsB.send).not.toHaveBeenCalled();
  });

  it("should skip closed sockets on send", () => {
    const ws = createMockWs(3); // CLOSED state
    pe.registerSocket("alice", ws);

    pe.sendToUser("alice", {
      panel: "agent",
      userId: "alice",
      text: "Hello",
      timestamp: Date.now(),
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it("should clean up on socket close event", () => {
    const ws = createMockWs();
    pe.registerSocket("alice", ws);
    pe.setRoom("alice", "room-1");

    // Simulate close
    ws.emit("close");

    // Socket should be removed
    pe.sendToUser("alice", {
      panel: "agent",
      userId: "alice",
      text: "Hello",
      timestamp: Date.now(),
    });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("should not remove socket on close if it was replaced", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    pe.registerSocket("alice", ws1);
    pe.registerSocket("alice", ws2);

    // Old socket fires close — should NOT remove ws2
    ws1.emit("close");

    pe.sendToUser("alice", {
      panel: "agent",
      userId: "alice",
      text: "Hello",
      timestamp: Date.now(),
    });
    expect(ws2.send).toHaveBeenCalledOnce();
  });

  it("should unregister socket manually", () => {
    const ws = createMockWs();
    pe.registerSocket("alice", ws);
    pe.unregisterSocket("alice");

    pe.sendToUser("alice", {
      panel: "agent",
      userId: "alice",
      text: "Hello",
      timestamp: Date.now(),
    });
    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe("PanelEmitter Edge Cases", () => {
  let pe: PanelEmitter;

  beforeEach(() => {
    pe = new PanelEmitter();
  });

  it("should broadcast to room with 0 users without error", () => {
    const message: PanelMessage = {
      panel: "status",
      roomId: "empty-room",
      users: [],
      sessionStatus: "active",
    };

    // Should not throw when broadcasting to a room with no registered users
    expect(() => pe.broadcast("empty-room", message)).not.toThrow();
  });

  it("should throw on message that fails JSON.stringify (circular ref)", () => {
    const ws = createMockWs();
    pe.registerSocket("alice", ws);

    // PanelEmitter.sendToUser calls JSON.stringify without try/catch,
    // so a circular reference will throw
    const circular: any = {
      panel: "agent",
      userId: "alice",
      text: "hi",
      timestamp: Date.now(),
    };
    circular.self = circular;

    expect(() => pe.sendToUser("alice", circular as PanelMessage)).toThrow();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("should clean up room membership when socket closes", () => {
    const wsAlice = createMockWs();
    const wsBob = createMockWs();
    pe.registerSocket("alice", wsAlice);
    pe.registerSocket("bob", wsBob);
    pe.setRoom("alice", "room-1");
    pe.setRoom("bob", "room-1");

    // Alice's socket closes
    wsAlice.emit("close");

    // Broadcast to room-1 — only Bob should receive, not Alice
    const message: PanelMessage = {
      panel: "status",
      roomId: "room-1",
      users: ["bob"],
      sessionStatus: "active",
    };
    pe.broadcast("room-1", message);

    expect(wsAlice.send).not.toHaveBeenCalled();
    expect(wsBob.send).toHaveBeenCalledOnce();
  });
});
