import type { ToolDefinition } from "./interfaces.js";
import type {
  IPaymentService,
  IMonzoService,
  INegotiationService,
  IPanelEmitter,
  IInProcessPeer,
} from "./interfaces.js";
import type { AgentProposal, UserId, NegotiationId } from "./types.js";

export interface ToolDependencies {
  payment: IPaymentService;
  monzo: IMonzoService | null;
  negotiation: INegotiationService;
  panelEmitter: IPanelEmitter;
  peer: IInProcessPeer;
  userId: UserId;
  otherUserId: UserId;
  displayName: string;
  recipientAccountId: string;
  roomId: string;
}

export function buildTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // Tool 1: analyze_and_propose
    {
      name: "analyze_and_propose",
      description:
        "Analyze the conversation context and create a structured proposal with line items, amounts, and conditions. Call this when a negotiation is triggered.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Brief summary of the agreement",
          },
          lineItems: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                amount: { type: "number", description: "Amount in pence" },
                type: {
                  type: "string",
                  enum: ["immediate", "escrow", "conditional"],
                },
                condition: {
                  type: "string",
                  description: "Condition for escrow/conditional items",
                },
              },
              required: ["description", "amount", "type"],
            },
          },
          currency: {
            type: "string",
            description: "Currency code (e.g., 'gbp')",
          },
          conditions: {
            type: "array",
            items: { type: "string" },
            description: "General conditions for the agreement",
          },
        },
        required: ["summary", "lineItems", "currency"],
      },
      handler: async (input) => {
        try {
          const lineItems = (
            input.lineItems as Array<Record<string, unknown>>
          ).map((li) => ({
            description: String(li.description),
            amount: Number(li.amount),
            type: String(li.type) as "immediate" | "escrow" | "conditional",
            condition: li.condition ? String(li.condition) : undefined,
          }));

          const totalAmount = lineItems.reduce((sum, li) => sum + li.amount, 0);

          const proposal: AgentProposal = {
            summary: String(input.summary),
            lineItems,
            totalAmount,
            currency: String(input.currency),
            conditions: Array.isArray(input.conditions)
              ? (input.conditions as string[]).map(String)
              : [],
            expiresAt: Date.now() + 30_000,
          };

          const negotiation = deps.negotiation.createNegotiation(
            deps.userId,
            deps.otherUserId,
            proposal,
          );

          deps.peer.send({
            type: "agent_proposal",
            negotiationId: negotiation.id,
            proposal,
            fromAgent: deps.userId,
          });

          return `Proposal created and sent to other agent: ${negotiation.id}\nSummary: ${proposal.summary}\nTotal: £${(totalAmount / 100).toFixed(2)}\nLine items: ${lineItems.length}`;
        } catch (err) {
          return `Error creating proposal: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // Tool 2: evaluate_proposal
    {
      name: "evaluate_proposal",
      description:
        "Evaluate an incoming proposal and decide to accept, counter, or reject. Call this when you receive a proposal from the other agent.",
      parameters: {
        type: "object",
        properties: {
          negotiationId: { type: "string" },
          decision: {
            type: "string",
            enum: ["accept", "counter", "reject"],
          },
          reason: {
            type: "string",
            description: "Reason for counter/reject",
          },
          counterProposal: {
            type: "object",
            description: "Required if decision is 'counter'",
            properties: {
              summary: { type: "string" },
              lineItems: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    amount: { type: "number" },
                    type: {
                      type: "string",
                      enum: ["immediate", "escrow", "conditional"],
                    },
                    condition: { type: "string" },
                  },
                  required: ["description", "amount", "type"],
                },
              },
              currency: { type: "string" },
              conditions: { type: "array", items: { type: "string" } },
            },
          },
        },
        required: ["negotiationId", "decision"],
      },
      handler: async (input) => {
        try {
          const negotiationId = String(input.negotiationId) as NegotiationId;
          const decision = String(input.decision);
          const reason = input.reason ? String(input.reason) : "";

          switch (decision) {
            case "accept": {
              const acceptMsg = {
                type: "agent_accept" as const,
                negotiationId,
                fromAgent: deps.userId,
              };
              deps.negotiation.handleAgentMessage(acceptMsg);
              deps.peer.send(acceptMsg);
              return "Proposal accepted. Document generation will follow.";
            }

            case "reject": {
              const rejectMsg = {
                type: "agent_reject" as const,
                negotiationId,
                reason,
                fromAgent: deps.userId,
              };
              deps.negotiation.handleAgentMessage(rejectMsg);
              deps.peer.send(rejectMsg);
              return `Proposal rejected. Reason: ${reason}`;
            }

            case "counter": {
              const cp = input.counterProposal as
                | Record<string, unknown>
                | undefined;
              if (!cp)
                return "Error: counterProposal required for counter decision";

              const lineItems = (
                cp.lineItems as Array<Record<string, unknown>>
              ).map((li) => ({
                description: String(li.description),
                amount: Number(li.amount),
                type: String(li.type) as "immediate" | "escrow" | "conditional",
                condition: li.condition ? String(li.condition) : undefined,
              }));

              const counterProposal: AgentProposal = {
                summary: String(cp.summary ?? "Counter-proposal"),
                lineItems,
                totalAmount: lineItems.reduce((sum, li) => sum + li.amount, 0),
                currency: String(cp.currency ?? "gbp"),
                conditions: Array.isArray(cp.conditions)
                  ? (cp.conditions as string[]).map(String)
                  : [],
                expiresAt: Date.now() + 30_000,
              };

              const counterMsg = {
                type: "agent_counter" as const,
                negotiationId,
                proposal: counterProposal,
                reason,
                fromAgent: deps.userId,
              };
              deps.negotiation.handleAgentMessage(counterMsg);
              deps.peer.send(counterMsg);
              return `Counter-proposal sent to other agent. New total: £${(counterProposal.totalAmount / 100).toFixed(2)}`;
            }

            default:
              return `Error: Invalid decision "${decision}". Must be accept, counter, or reject.`;
          }
        } catch (err) {
          return `Error evaluating proposal: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // Tool 3: execute_payment
    {
      name: "execute_payment",
      description: "Execute an immediate Stripe payment to the other party",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Amount in pence" },
          currency: { type: "string", description: "Currency code" },
          description: { type: "string" },
        },
        required: ["amount", "currency", "description"],
      },
      handler: async (input) => {
        try {
          const result = await deps.payment.executePayment({
            amount: Number(input.amount),
            currency: String(input.currency),
            description: String(input.description),
            recipientAccountId: deps.recipientAccountId,
          });
          if (result.success) {
            return `Payment successful: £${(Number(input.amount) / 100).toFixed(2)} sent. ID: ${result.paymentIntentId}`;
          }
          return `Payment failed: ${result.error}`;
        } catch (err) {
          return `Error executing payment: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // Tool 4: create_escrow_hold
    {
      name: "create_escrow_hold",
      description:
        "Create an escrow hold — authorizes funds without capturing. Use for conditional agreements.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Amount in pence to hold" },
          currency: { type: "string" },
          description: { type: "string" },
        },
        required: ["amount", "currency", "description"],
      },
      handler: async (input) => {
        try {
          const hold = await deps.payment.createEscrowHold({
            amount: Number(input.amount),
            currency: String(input.currency),
            description: String(input.description),
            recipientAccountId: deps.recipientAccountId,
          });
          return `Escrow hold created: £${(hold.amount / 100).toFixed(2)} held. Hold ID: ${hold.holdId}`;
        } catch (err) {
          return `Error creating escrow hold: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // Tool 5: capture_escrow
    {
      name: "capture_escrow",
      description:
        "Capture (complete) an escrow hold, transferring funds to recipient. Supports partial capture.",
      parameters: {
        type: "object",
        properties: {
          holdId: { type: "string" },
          amount: {
            type: "number",
            description:
              "Optional: amount to capture in pence (for partial capture). Omit for full capture.",
          },
        },
        required: ["holdId"],
      },
      handler: async (input) => {
        try {
          const amount =
            input.amount !== undefined ? Number(input.amount) : undefined;
          const result = await deps.payment.captureEscrow(
            String(input.holdId),
            amount,
          );
          if (result.success) {
            return `Escrow captured successfully${amount ? ` (£${(amount / 100).toFixed(2)})` : " (full amount)"}`;
          }
          return `Escrow capture failed: ${result.error}`;
        } catch (err) {
          return `Error capturing escrow: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // Tool 6: release_escrow
    {
      name: "release_escrow",
      description:
        "Release (cancel) an escrow hold, returning funds to the payer",
      parameters: {
        type: "object",
        properties: {
          holdId: { type: "string" },
        },
        required: ["holdId"],
      },
      handler: async (input) => {
        try {
          const result = await deps.payment.releaseEscrow(String(input.holdId));
          if (result.success) {
            return "Escrow released — funds returned to payer.";
          }
          return `Escrow release failed: ${result.error}`;
        } catch (err) {
          return `Error releasing escrow: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // Tool 7: check_balance
    {
      name: "check_balance",
      description:
        "Check your user's Monzo bank balance for context during negotiation",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        if (!deps.monzo) return "Monzo not connected — balance unavailable.";
        try {
          const bal = await deps.monzo.getBalance();
          return `Balance: £${(bal.balance / 100).toFixed(2)}, Spend today: £${(Math.abs(bal.spend_today) / 100).toFixed(2)}`;
        } catch (err) {
          return `Failed to check balance: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // Tool 8: check_transactions
    {
      name: "check_transactions",
      description:
        "Check your user's recent Monzo transactions. Useful to verify affordability, check spending patterns, or confirm recent payments.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description:
              "Number of days of history to fetch (default 30, max 90)",
          },
        },
      },
      handler: async (input) => {
        if (!deps.monzo)
          return "Monzo not connected — transactions unavailable.";
        try {
          const days = Math.min(Math.max(Number(input.days) || 30, 1), 90);
          const transactions = await deps.monzo.getTransactions(days);
          if (transactions.length === 0) {
            return `No transactions found in the last ${days} days.`;
          }
          const summary = transactions.slice(0, 20).map((t) => {
            const amount = (t.amount / 100).toFixed(2);
            const sign = t.amount < 0 ? "-" : "+";
            const merchant = t.merchant?.name ?? t.description;
            return `${sign}£${Math.abs(Number(amount)).toFixed(2)} ${merchant} (${t.category}) ${t.created.slice(0, 10)}`;
          });
          const total = transactions.reduce((sum, t) => sum + t.amount, 0);
          return `Last ${days} days (${transactions.length} transactions, showing first 20):\n${summary.join("\n")}\nNet: £${(total / 100).toFixed(2)}`;
        } catch (err) {
          return `Failed to fetch transactions: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // Tool 9: send_message_to_user
    {
      name: "send_message_to_user",
      description:
        "Display a message in your user's agent panel. Use to communicate what you're doing.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message to show the user" },
        },
        required: ["text"],
      },
      handler: async (input) => {
        try {
          deps.panelEmitter.sendToUser(deps.userId, {
            panel: "agent",
            userId: deps.userId,
            text: String(input.text),
            timestamp: Date.now(),
          });
          return "Message sent to user panel.";
        } catch (err) {
          return `Error sending message: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
