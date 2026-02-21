import { EventEmitter } from "eventemitter3";
import type { AgentMessage, UserId } from "../types.js";
import type { IInProcessPeer } from "../interfaces.js";

export class InProcessPeer extends EventEmitter implements IInProcessPeer {
  private partner: InProcessPeer | null = null;
  private readonly otherUserId: UserId;

  constructor(
    private readonly myUserId: UserId,
    otherUserId: UserId,
  ) {
    super();
    this.otherUserId = otherUserId;
  }

  send(message: AgentMessage): void {
    if (!this.partner) {
      throw new Error("No partner connected");
    }
    const copy = { ...message };
    process.nextTick(() => this.partner!.emit("message", copy));
  }

  getOtherUserId(): UserId {
    return this.otherUserId;
  }

  static createPair(
    userIdA: UserId,
    userIdB: UserId,
  ): [InProcessPeer, InProcessPeer] {
    const peerA = new InProcessPeer(userIdA, userIdB);
    const peerB = new InProcessPeer(userIdB, userIdA);
    peerA.partner = peerB;
    peerB.partner = peerA;
    return [peerA, peerB];
  }
}
