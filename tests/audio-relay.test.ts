import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioRelayService } from "../src/services/audio-relay.js";
import { EventEmitter } from "events";

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
  };
}

describe("AudioRelayService Module", () => {
  let relay: AudioRelayService;

  beforeEach(() => {
    relay = new AudioRelayService();
  });

  it("should relay audio to all other users in room", () => {
    const wsA = createMockWs();
    const wsB = createMockWs();
    const wsC = createMockWs();
    relay.registerUser("alice", wsA);
    relay.registerUser("bob", wsB);
    relay.registerUser("carol", wsC);

    const buffer = Buffer.from("audio-data");
    relay.relayAudio("alice", buffer);

    expect(wsA.send).not.toHaveBeenCalled(); // sender excluded
    expect(wsB.send).toHaveBeenCalledWith(buffer);
    expect(wsC.send).toHaveBeenCalledWith(buffer);
  });

  it("should not relay to self", () => {
    const ws = createMockWs();
    relay.registerUser("alice", ws);

    relay.relayAudio("alice", Buffer.from("data"));
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("should skip closed sockets", () => {
    const wsA = createMockWs();
    const wsB = createMockWs(3); // CLOSED
    relay.registerUser("alice", wsA);
    relay.registerUser("bob", wsB);

    relay.relayAudio("alice", Buffer.from("data"));
    expect(wsB.send).not.toHaveBeenCalled();
  });

  it("should close existing socket on re-register", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    relay.registerUser("alice", ws1);
    relay.registerUser("alice", ws2);

    expect(ws1.close).toHaveBeenCalledWith(4002, "replaced");
  });

  it("should unregister user", () => {
    const wsA = createMockWs();
    const wsB = createMockWs();
    relay.registerUser("alice", wsA);
    relay.registerUser("bob", wsB);

    relay.unregisterUser("bob");
    relay.relayAudio("alice", Buffer.from("data"));
    expect(wsB.send).not.toHaveBeenCalled();
  });

  it("should cleanup on socket close event", () => {
    const ws = createMockWs();
    relay.registerUser("alice", ws);

    ws.emit("close");
    // After close, alice should be removed — relay from bob should not reach alice
    const wsB = createMockWs();
    relay.registerUser("bob", wsB);
    relay.relayAudio("bob", Buffer.from("data"));
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("should handle destroy", () => {
    const ws = createMockWs();
    relay.registerUser("alice", ws);
    relay.destroy();

    relay.relayAudio("bob", Buffer.from("data"));
    expect(ws.send).not.toHaveBeenCalled();
  });
});
