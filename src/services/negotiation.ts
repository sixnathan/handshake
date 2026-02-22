import { EventEmitter } from "eventemitter3";
import type {
  AgentMessage,
  AgentProposal,
  Negotiation,
  NegotiationId,
  NegotiationRound,
  NegotiationStatus,
  UserId,
} from "../types.js";
import type { INegotiationService } from "../interfaces.js";

export class NegotiationService
  extends EventEmitter
  implements INegotiationService
{
  private negotiations = new Map<NegotiationId, Negotiation>();
  private activeNegotiationId: NegotiationId | null = null;
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private totalTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_ROUNDS = 5;
  private readonly ROUND_TIMEOUT_MS = 90_000;
  private readonly TOTAL_TIMEOUT_MS = 300_000;

  constructor(private readonly roomId: string) {
    super();
  }

  createNegotiation(
    initiator: UserId,
    responder: UserId,
    proposal: AgentProposal,
  ): Negotiation {
    if (this.activeNegotiationId) {
      throw new Error("Negotiation already in progress");
    }

    const id: NegotiationId =
      "neg_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 6);

    const round: NegotiationRound = {
      round: 1,
      fromAgent: initiator,
      proposal,
      action: "propose",
      timestamp: Date.now(),
    };

    const negotiation: Negotiation = {
      id,
      roomId: this.roomId,
      status: "proposed",
      initiator,
      responder,
      currentProposal: proposal,
      rounds: [round],
      maxRounds: this.MAX_ROUNDS,
      roundTimeoutMs: this.ROUND_TIMEOUT_MS,
      totalTimeoutMs: this.TOTAL_TIMEOUT_MS,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.negotiations.set(id, negotiation);
    this.activeNegotiationId = id;
    this.startTimers(id);
    this.emit("negotiation:started", negotiation);
    return negotiation;
  }

  handleAgentMessage(message: AgentMessage): void {
    const negotiation = this.negotiations.get(message.negotiationId);
    if (!negotiation) {
      console.warn(
        `[negotiation] No negotiation found for id ${message.negotiationId}`,
      );
      return;
    }

    if (
      negotiation.status !== "proposed" &&
      negotiation.status !== "countering"
    ) {
      console.warn(
        `[negotiation] Received message for non-active negotiation ${message.negotiationId} (status: ${negotiation.status})`,
      );
      return;
    }

    switch (message.type) {
      case "agent_proposal":
      case "agent_counter": {
        if (negotiation.rounds.length >= this.MAX_ROUNDS) {
          this.expireNegotiation(negotiation.id, "Round limit exceeded");
          return;
        }

        const proposal =
          message.type === "agent_counter"
            ? message.proposal
            : message.proposal;
        const reason =
          message.type === "agent_counter" ? message.reason : undefined;

        const round: NegotiationRound = {
          round: negotiation.rounds.length + 1,
          fromAgent: message.fromAgent,
          proposal,
          action: "counter",
          reason,
          timestamp: Date.now(),
        };

        const updated: Negotiation = {
          ...negotiation,
          status: "countering",
          currentProposal: proposal,
          rounds: [...negotiation.rounds, round],
          updatedAt: Date.now(),
        };

        this.negotiations.set(updated.id, updated);
        this.emit("negotiation:updated", updated);
        this.resetRoundTimer(updated.id);
        break;
      }

      case "agent_accept": {
        const round: NegotiationRound = {
          round: negotiation.rounds.length + 1,
          fromAgent: message.fromAgent,
          proposal: negotiation.currentProposal,
          action: "accept",
          timestamp: Date.now(),
        };

        const updated: Negotiation = {
          ...negotiation,
          status: "accepted",
          rounds: [...negotiation.rounds, round],
          updatedAt: Date.now(),
        };

        this.clearTimers();
        this.negotiations.set(updated.id, updated);
        this.emit("negotiation:agreed", updated);
        this.activeNegotiationId = null;
        break;
      }

      case "agent_reject": {
        const round: NegotiationRound = {
          round: negotiation.rounds.length + 1,
          fromAgent: message.fromAgent,
          proposal: negotiation.currentProposal,
          action: "reject",
          reason: message.reason,
          timestamp: Date.now(),
        };

        const updated: Negotiation = {
          ...negotiation,
          status: "rejected",
          rounds: [...negotiation.rounds, round],
          updatedAt: Date.now(),
        };

        this.clearTimers();
        this.negotiations.set(updated.id, updated);
        this.emit("negotiation:rejected", updated);
        this.activeNegotiationId = null;
        break;
      }
    }
  }

  getNegotiation(id: NegotiationId): Negotiation | undefined {
    return this.negotiations.get(id);
  }

  getActiveNegotiation(): Negotiation | undefined {
    if (!this.activeNegotiationId) return undefined;
    return this.negotiations.get(this.activeNegotiationId);
  }

  getLatestNegotiation(): Negotiation | undefined {
    let latest: Negotiation | undefined;
    for (const neg of this.negotiations.values()) {
      if (!latest || neg.updatedAt > latest.updatedAt) {
        latest = neg;
      }
    }
    return latest;
  }

  destroy(): void {
    this.clearTimers();
    this.removeAllListeners();
  }

  private startTimers(negotiationId: NegotiationId): void {
    this.clearTimers();
    this.roundTimer = setTimeout(
      () => this.handleRoundTimeout(negotiationId),
      this.ROUND_TIMEOUT_MS,
    );
    this.totalTimer = setTimeout(
      () => this.handleTotalTimeout(negotiationId),
      this.TOTAL_TIMEOUT_MS,
    );
  }

  private resetRoundTimer(negotiationId: NegotiationId): void {
    if (this.roundTimer) clearTimeout(this.roundTimer);
    this.roundTimer = setTimeout(
      () => this.handleRoundTimeout(negotiationId),
      this.ROUND_TIMEOUT_MS,
    );
  }

  private clearTimers(): void {
    if (this.roundTimer) clearTimeout(this.roundTimer);
    if (this.totalTimer) clearTimeout(this.totalTimer);
    this.roundTimer = null;
    this.totalTimer = null;
  }

  private handleRoundTimeout(negotiationId: NegotiationId): void {
    console.log(`[negotiation] Round timeout for ${negotiationId}`);
    this.expireNegotiation(
      negotiationId,
      "Round timeout — no response within 30 seconds",
    );
  }

  private handleTotalTimeout(negotiationId: NegotiationId): void {
    console.log(`[negotiation] Total timeout for ${negotiationId}`);
    this.expireNegotiation(
      negotiationId,
      "Total timeout — negotiation exceeded 2 minutes",
    );
  }

  private expireNegotiation(
    negotiationId: NegotiationId,
    reason: string,
  ): void {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) return;

    const terminalStatuses: NegotiationStatus[] = [
      "accepted",
      "rejected",
      "expired",
      "completed",
      "failed",
    ];
    if (terminalStatuses.includes(negotiation.status)) return;

    const updated: Negotiation = {
      ...negotiation,
      status: "expired",
      updatedAt: Date.now(),
    };

    this.clearTimers();
    this.negotiations.set(updated.id, updated);
    this.emit("negotiation:expired", updated);
    this.activeNegotiationId = null;
  }
}
