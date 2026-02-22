import type { ToolDefinition } from "./interfaces.js";
import type {
  IPaymentService,
  IMonzoService,
  INegotiationService,
  IDocumentService,
  ISessionService,
  IPanelEmitter,
  IInProcessPeer,
} from "./interfaces.js";
import type {
  AgentProposal,
  ProposalMilestone,
  PriceFactor,
  UserId,
  NegotiationId,
  DocumentId,
  Milestone,
  MilestoneId,
} from "./types.js";

export interface ToolDependencies {
  payment: IPaymentService;
  monzo: IMonzoService | null;
  negotiation: INegotiationService;
  document: IDocumentService;
  session: ISessionService;
  panelEmitter: IPanelEmitter;
  peer: IInProcessPeer;
  userId: UserId;
  otherUserId: UserId;
  displayName: string;
  otherDisplayName: string;
  recipientAccountId: string;
  payerCustomerId?: string;
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
                amount: {
                  type: "number",
                  description:
                    "Amount in pence. For range-priced items, use maxAmount as the escrow hold.",
                },
                type: {
                  type: "string",
                  enum: ["immediate", "escrow", "conditional"],
                },
                condition: {
                  type: "string",
                  description: "Condition for escrow/conditional items",
                },
                minAmount: {
                  type: "number",
                  description: "Lower bound in pence for range-priced items",
                },
                maxAmount: {
                  type: "number",
                  description:
                    "Upper bound in pence for range-priced items (escrow holds this)",
                },
                factors: {
                  type: "array",
                  description:
                    "Observable factors that determine where the final price lands in the range",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      description: {
                        type: "string",
                        description: "What this factor measures",
                      },
                      impact: {
                        type: "string",
                        enum: ["increases", "decreases", "determines"],
                      },
                    },
                    required: ["name", "description", "impact"],
                  },
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
          factorSummary: {
            type: "string",
            description:
              "Plain English explanation of how factors determine the final price",
          },
          milestones: {
            type: "array",
            description:
              "Required for escrow/conditional line items. Define specific, verifiable milestones with clear completion criteria.",
            items: {
              type: "object",
              properties: {
                lineItemIndex: {
                  type: "number",
                  description: "Index of the linked line item (0-based)",
                },
                title: {
                  type: "string",
                  description:
                    "Specific deliverable (e.g., 'Boiler diagnosis and quote', not 'Service payment')",
                },
                deliverables: {
                  type: "array",
                  items: { type: "string" },
                  description: "What must be produced/completed",
                },
                verificationMethod: {
                  type: "string",
                  description:
                    "How to verify: 'Visual inspection by client', 'Phone confirmation', 'Receipt/invoice provided'",
                },
                completionCriteria: {
                  type: "array",
                  items: { type: "string" },
                  description: "Checklist — ALL must be satisfied",
                },
                amount: {
                  type: "number",
                  description: "Pence",
                },
                expectedTimeline: {
                  type: "string",
                  description: "When completion is expected",
                },
              },
              required: [
                "lineItemIndex",
                "title",
                "deliverables",
                "verificationMethod",
                "completionCriteria",
                "amount",
              ],
            },
          },
        },
        required: ["summary", "lineItems", "currency"],
      },
      handler: async (input) => {
        try {
          if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
            return "Error: lineItems must be a non-empty array";
          }
          const lineItems = (
            input.lineItems as Array<Record<string, unknown>>
          ).map((li) => {
            const factors = Array.isArray(li.factors)
              ? (li.factors as Array<Record<string, unknown>>).map(
                  (f): PriceFactor => ({
                    name: String(f.name),
                    description: String(f.description),
                    impact: String(f.impact) as PriceFactor["impact"],
                  }),
                )
              : undefined;

            return {
              description: String(li.description),
              amount: Number(li.amount),
              type: String(li.type) as "immediate" | "escrow" | "conditional",
              condition: li.condition ? String(li.condition) : undefined,
              minAmount:
                li.minAmount !== undefined ? Number(li.minAmount) : undefined,
              maxAmount:
                li.maxAmount !== undefined ? Number(li.maxAmount) : undefined,
              factors: factors && factors.length > 0 ? factors : undefined,
            };
          });

          // Use maxAmount when available for total (what gets escrowed)
          const totalAmount = lineItems.reduce(
            (sum, li) => sum + (li.maxAmount ?? li.amount),
            0,
          );

          const milestones: ProposalMilestone[] | undefined = Array.isArray(
            input.milestones,
          )
            ? (input.milestones as Array<Record<string, unknown>>).map(
                (m): ProposalMilestone => ({
                  lineItemIndex: Number(m.lineItemIndex),
                  title: String(m.title),
                  deliverables: Array.isArray(m.deliverables)
                    ? (m.deliverables as string[]).map(String)
                    : [],
                  verificationMethod: String(m.verificationMethod),
                  completionCriteria: Array.isArray(m.completionCriteria)
                    ? (m.completionCriteria as string[]).map(String)
                    : [],
                  amount: Number(m.amount),
                  expectedTimeline: m.expectedTimeline
                    ? String(m.expectedTimeline)
                    : undefined,
                }),
              )
            : undefined;

          const proposal: AgentProposal = {
            summary: String(input.summary),
            lineItems,
            totalAmount,
            currency: String(input.currency),
            conditions: Array.isArray(input.conditions)
              ? (input.conditions as string[]).map(String)
              : [],
            expiresAt: Date.now() + 30_000,
            factorSummary: input.factorSummary
              ? String(input.factorSummary)
              : undefined,
            milestones:
              milestones && milestones.length > 0 ? milestones : undefined,
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

          const rangeInfo = lineItems
            .filter(
              (li) => li.minAmount !== undefined && li.maxAmount !== undefined,
            )
            .map(
              (li) =>
                `${li.description}: £${(li.minAmount! / 100).toFixed(2)}–£${(li.maxAmount! / 100).toFixed(2)}`,
            );
          const rangeStr =
            rangeInfo.length > 0 ? `\nRanges: ${rangeInfo.join(", ")}` : "";

          return `Proposal created and sent to other agent: ${negotiation.id}\nSummary: ${proposal.summary}\nTotal (max): £${(totalAmount / 100).toFixed(2)}\nLine items: ${lineItems.length}${rangeStr}`;
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
                    minAmount: { type: "number" },
                    maxAmount: { type: "number" },
                    factors: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          description: { type: "string" },
                          impact: {
                            type: "string",
                            enum: ["increases", "decreases", "determines"],
                          },
                        },
                        required: ["name", "description", "impact"],
                      },
                    },
                  },
                  required: ["description", "amount", "type"],
                },
              },
              currency: { type: "string" },
              conditions: { type: "array", items: { type: "string" } },
              factorSummary: { type: "string" },
              milestones: {
                type: "array",
                description:
                  "Verifiable milestones for escrow/conditional line items",
                items: {
                  type: "object",
                  properties: {
                    lineItemIndex: { type: "number" },
                    title: { type: "string" },
                    deliverables: {
                      type: "array",
                      items: { type: "string" },
                    },
                    verificationMethod: { type: "string" },
                    completionCriteria: {
                      type: "array",
                      items: { type: "string" },
                    },
                    amount: { type: "number" },
                    expectedTimeline: { type: "string" },
                  },
                  required: [
                    "lineItemIndex",
                    "title",
                    "deliverables",
                    "verificationMethod",
                    "completionCriteria",
                    "amount",
                  ],
                },
              },
            },
          },
        },
        required: ["negotiationId", "decision"],
      },
      handler: async (input) => {
        try {
          // Use the active negotiation — don't trust LLM-provided IDs
          const activeNeg = deps.negotiation.getActiveNegotiation();
          const negotiationId = activeNeg
            ? activeNeg.id
            : (String(input.negotiationId) as NegotiationId);
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
              ).map((li) => {
                const factors = Array.isArray(li.factors)
                  ? (li.factors as Array<Record<string, unknown>>).map(
                      (f): PriceFactor => ({
                        name: String(f.name),
                        description: String(f.description),
                        impact: String(f.impact) as PriceFactor["impact"],
                      }),
                    )
                  : undefined;

                return {
                  description: String(li.description),
                  amount: Number(li.amount),
                  type: String(li.type) as
                    | "immediate"
                    | "escrow"
                    | "conditional",
                  condition: li.condition ? String(li.condition) : undefined,
                  minAmount:
                    li.minAmount !== undefined
                      ? Number(li.minAmount)
                      : undefined,
                  maxAmount:
                    li.maxAmount !== undefined
                      ? Number(li.maxAmount)
                      : undefined,
                  factors: factors && factors.length > 0 ? factors : undefined,
                };
              });

              const counterMilestones: ProposalMilestone[] | undefined =
                Array.isArray(cp.milestones)
                  ? (cp.milestones as Array<Record<string, unknown>>).map(
                      (m): ProposalMilestone => ({
                        lineItemIndex: Number(m.lineItemIndex),
                        title: String(m.title),
                        deliverables: Array.isArray(m.deliverables)
                          ? (m.deliverables as string[]).map(String)
                          : [],
                        verificationMethod: String(m.verificationMethod),
                        completionCriteria: Array.isArray(m.completionCriteria)
                          ? (m.completionCriteria as string[]).map(String)
                          : [],
                        amount: Number(m.amount),
                        expectedTimeline: m.expectedTimeline
                          ? String(m.expectedTimeline)
                          : undefined,
                      }),
                    )
                  : undefined;

              const counterProposal: AgentProposal = {
                summary: String(cp.summary ?? "Counter-proposal"),
                lineItems,
                totalAmount: lineItems.reduce(
                  (sum, li) => sum + (li.maxAmount ?? li.amount),
                  0,
                ),
                currency: String(cp.currency ?? "gbp"),
                conditions: Array.isArray(cp.conditions)
                  ? (cp.conditions as string[]).map(String)
                  : [],
                expiresAt: Date.now() + 30_000,
                factorSummary: cp.factorSummary
                  ? String(cp.factorSummary)
                  : undefined,
                milestones:
                  counterMilestones && counterMilestones.length > 0
                    ? counterMilestones
                    : undefined,
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
          if (!deps.recipientAccountId) {
            return "Error: Recipient has no Stripe account connected. They must set their Stripe Account ID in their profile.";
          }
          const amount = Number(input.amount);
          if (!Number.isFinite(amount) || amount <= 0) {
            return "Error: amount must be a positive number";
          }
          const result = await deps.payment.executePayment({
            amount,
            currency: String(input.currency),
            description: String(input.description),
            recipientAccountId: deps.recipientAccountId,
            payerCustomerId: deps.payerCustomerId,
          });
          if (result.success) {
            return `Payment successful: £${(amount / 100).toFixed(2)} sent. ID: ${result.paymentIntentId}`;
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
          if (!deps.recipientAccountId) {
            return "Error: Recipient has no Stripe account connected. They must set their Stripe Account ID in their profile.";
          }
          const amount = Number(input.amount);
          if (!Number.isFinite(amount) || amount <= 0) {
            return "Error: amount must be a positive number";
          }
          const hold = await deps.payment.createEscrowHold({
            amount,
            currency: String(input.currency),
            description: String(input.description),
            recipientAccountId: deps.recipientAccountId,
            payerCustomerId: deps.payerCustomerId,
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
          if (
            amount !== undefined &&
            (!Number.isFinite(amount) || amount <= 0)
          ) {
            return "Error: amount must be a positive number";
          }
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

    // Tool 10: generate_document
    {
      name: "generate_document",
      description:
        "Generate a legal agreement document from an accepted negotiation. Call this after negotiation is agreed to create a binding document with milestones for escrow/conditional items.",
      parameters: {
        type: "object",
        properties: {
          negotiationId: {
            type: "string",
            description: "The ID of the accepted negotiation",
          },
          additionalNotes: {
            type: "string",
            description:
              "Optional notes to include in the document (e.g., special conditions discussed verbally)",
          },
        },
        required: ["negotiationId"],
      },
      handler: async (input) => {
        try {
          // Try LLM-provided ID, then active, then latest (for post-accept)
          const inputId = String(input.negotiationId) as NegotiationId;
          const negotiation =
            deps.negotiation.getNegotiation(inputId) ??
            deps.negotiation.getActiveNegotiation() ??
            deps.negotiation.getLatestNegotiation();
          if (!negotiation) {
            return `Error: No negotiation found (tried ${inputId})`;
          }
          const negotiationId = negotiation.id;
          if (negotiation.status !== "accepted") {
            return `Error: Negotiation status is "${negotiation.status}", must be "accepted" to generate document`;
          }

          const parties = [
            {
              userId: deps.userId,
              name: deps.displayName,
              role: "Party A",
            },
            {
              userId: deps.otherUserId,
              name: deps.otherDisplayName,
              role: "Party B",
            },
          ];

          const conversationContext = deps.session.getTranscriptText();
          const additionalNotes = input.additionalNotes
            ? `\n\nADDITIONAL NOTES FROM AGENT:\n${String(input.additionalNotes)}`
            : "";

          const doc = await deps.document.generateDocument(
            negotiation,
            negotiation.currentProposal,
            parties,
            conversationContext + additionalNotes,
          );

          // Build milestones from proposal milestones (rich) or fall back to line items (basic)
          const proposalMilestones =
            negotiation.currentProposal.milestones ?? [];
          const milestones: Milestone[] =
            proposalMilestones.length > 0
              ? proposalMilestones.map(
                  (pm): Milestone => ({
                    id: `ms_${doc.id}_${pm.lineItemIndex}` as MilestoneId,
                    documentId: doc.id as DocumentId,
                    lineItemIndex: pm.lineItemIndex,
                    description: pm.title,
                    amount: pm.amount,
                    condition: pm.completionCriteria.join("; "),
                    deliverables: pm.deliverables,
                    verificationMethod: pm.verificationMethod,
                    completionCriteria: pm.completionCriteria,
                    expectedTimeline: pm.expectedTimeline,
                    status: "pending",
                  }),
                )
              : // Fallback: extract from escrow/conditional line items
                negotiation.currentProposal.lineItems
                  .map((li, index) => {
                    if (li.type === "escrow" || li.type === "conditional") {
                      const milestone: Milestone = {
                        id: `ms_${doc.id}_${index}` as MilestoneId,
                        documentId: doc.id as DocumentId,
                        lineItemIndex: index,
                        description: li.description,
                        amount: li.amount,
                        condition: li.condition ?? "Completion of work",
                        status: "pending",
                      };
                      return milestone;
                    }
                    return null;
                  })
                  .filter((m): m is Milestone => m !== null);

          if (milestones.length > 0) {
            deps.document.updateMilestones(doc.id, milestones);
          }

          // Broadcast document to both users
          const docWithMilestones = deps.document.getDocument(doc.id)!;
          deps.panelEmitter.broadcast(deps.roomId, {
            panel: "document",
            document: docWithMilestones,
          });

          // Broadcast milestones individually
          for (const milestone of milestones) {
            deps.panelEmitter.broadcast(deps.roomId, {
              panel: "milestone",
              milestone,
            });
          }

          const milestoneInfo =
            milestones.length > 0
              ? `\nMilestones created: ${milestones.length} (${milestones.map((m) => m.description).join(", ")})`
              : "";

          return `Document generated: "${doc.title}" (${doc.id})\nParties: ${parties.map((p) => p.name).join(", ")}\nLine items: ${negotiation.currentProposal.lineItems.length}${milestoneInfo}\nStatus: pending signatures`;
        } catch (err) {
          return `Error generating document: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // Tool 11: complete_milestone
    {
      name: "complete_milestone",
      description:
        "Mark a milestone as completed and release linked escrow funds if applicable. Only call when the milestone's condition has been verified as met.",
      parameters: {
        type: "object",
        properties: {
          milestoneId: {
            type: "string",
            description: "The ID of the milestone to complete",
          },
          documentId: {
            type: "string",
            description: "The ID of the document containing the milestone",
          },
        },
        required: ["milestoneId", "documentId"],
      },
      handler: async (input) => {
        try {
          const documentId = String(input.documentId) as DocumentId;
          const milestoneId = String(input.milestoneId) as MilestoneId;

          const doc = deps.document.getDocument(documentId);
          if (!doc) {
            return `Error: Document ${documentId} not found`;
          }
          if (doc.status !== "fully_signed") {
            return `Error: Document must be fully signed before completing milestones (current: ${doc.status})`;
          }

          const milestones = doc.milestones ?? [];
          const milestone = milestones.find((m) => m.id === milestoneId);
          if (!milestone) {
            return `Error: Milestone ${milestoneId} not found in document ${documentId}`;
          }
          if (milestone.status === "completed") {
            return `Milestone "${milestone.description}" is already completed`;
          }

          // Inform — bilateral confirmation required from both parties
          deps.panelEmitter.broadcast(deps.roomId, {
            panel: "agent",
            userId: deps.userId,
            text: `Milestone "${milestone.description}" is ready for completion. Both parties must click Confirm Complete in the contract view.`,
            timestamp: Date.now(),
          });

          return `Milestone "${milestone.description}" is pending bilateral confirmation. Both parties must click Confirm Complete in the contract view to release escrow.`;
        } catch (err) {
          return `Error completing milestone: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
