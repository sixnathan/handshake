import type { ToolDefinition } from "./interfaces.js";
import type {
  VerificationEvidence,
  VerificationResult,
  VerificationId,
  MilestoneId,
  LineItem,
  Milestone,
} from "./types.js";
import type { IMonzoService, IPanelEmitter } from "./interfaces.js";
import type { PhoneVerificationService } from "./services/phone-verification.js";
import type { UserId, RoomId } from "./types.js";

export interface VerificationToolDependencies {
  milestone: Milestone;
  lineItem: LineItem;
  verificationId: VerificationId;
  monzo: IMonzoService | null;
  phoneService: PhoneVerificationService;
  panelEmitter: IPanelEmitter;
  requestedBy: UserId;
  roomId: RoomId;
  phoneNumber?: string;
  contactName?: string;
  onEvidence: (evidence: VerificationEvidence) => void;
  onVerdict: (verdict: {
    status: "passed" | "failed" | "disputed";
    reasoning: string;
    recommendedAmount?: number;
    evidence: VerificationEvidence[];
  }) => void;
}

export function buildVerificationTools(
  deps: VerificationToolDependencies,
): ToolDefinition[] {
  const collectedEvidence: VerificationEvidence[] = [];

  return [
    // Tool 1: assess_condition
    {
      name: "assess_condition",
      description:
        "Assess a specific condition or factor for the milestone. Call this for each factor/condition to build structured evidence. For range-priced items, your assessment determines the capture amount.",
      parameters: {
        type: "object",
        properties: {
          conditionName: {
            type: "string",
            description: "Name of the condition or factor being assessed",
          },
          assessment: {
            type: "string",
            enum: ["met", "partially_met", "not_met", "unable_to_assess"],
          },
          details: {
            type: "string",
            description: "Explanation of the assessment",
          },
          impactOnPrice: {
            type: "string",
            enum: ["increases", "decreases", "neutral", "not_applicable"],
            description:
              "For range-priced items: how this factor impacts the final price",
          },
        },
        required: ["conditionName", "assessment", "details"],
      },
      handler: async (input) => {
        const evidence: VerificationEvidence = {
          type: "factor_assessment",
          description: String(input.conditionName),
          result:
            input.assessment === "met"
              ? "confirmed"
              : input.assessment === "not_met"
                ? "denied"
                : "inconclusive",
          details: `${String(input.assessment)}: ${String(input.details)}${input.impactOnPrice ? ` (price impact: ${String(input.impactOnPrice)})` : ""}`,
          timestamp: Date.now(),
        };
        collectedEvidence.push(evidence);
        deps.onEvidence(evidence);
        return `Condition "${String(input.conditionName)}" assessed as ${String(input.assessment)}.`;
      },
    },

    // Tool 2: phone_verify
    {
      name: "phone_verify",
      description:
        "Initiate a phone call to verify milestone completion with a contact person. Uses ElevenLabs Conversational AI to call and ask verification questions.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: { type: "string" },
            description:
              "Questions to ask the contact during the call (2-4 questions)",
          },
        },
        required: ["questions"],
      },
      handler: async (input) => {
        if (!deps.phoneNumber) {
          return "No phone number provided — phone verification skipped. Use other evidence types.";
        }

        const questions = Array.isArray(input.questions)
          ? (input.questions as string[]).map(String)
          : [];

        if (questions.length === 0) {
          return "Error: at least one verification question is required";
        }

        deps.panelEmitter.sendToUser(deps.requestedBy, {
          panel: "verification",
          verificationId: deps.verificationId,
          milestoneId: deps.milestone.id,
          step: "phone_call",
          status: "in_progress",
          details: deps.phoneService.isAvailable()
            ? `Calling ${deps.contactName ?? deps.phoneNumber}...`
            : `Simulating call to ${deps.contactName ?? deps.phoneNumber}...`,
        });

        const result = await deps.phoneService.verify({
          phoneNumber: deps.phoneNumber,
          contactName: deps.contactName ?? "the contact",
          milestoneDescription: deps.milestone.description,
          condition: deps.milestone.condition,
          questions,
        });

        const evidence: VerificationEvidence = {
          type: "phone_call",
          description: `Phone verification with ${deps.contactName ?? deps.phoneNumber}`,
          result: result.confirmed
            ? "confirmed"
            : result.success
              ? "denied"
              : "inconclusive",
          details:
            result.details +
            (result.transcript ? `\n\nTranscript:\n${result.transcript}` : ""),
          timestamp: Date.now(),
        };
        collectedEvidence.push(evidence);
        deps.onEvidence(evidence);

        return result.confirmed
          ? `Phone verification CONFIRMED: ${result.details}`
          : `Phone verification result: ${result.details}`;
      },
    },

    // Tool 3: record_self_attestation
    {
      name: "record_self_attestation",
      description:
        "Record that the verifier (the user who clicked Verify) attests to the milestone's completion. Makes the implicit claim explicit and trackable.",
      parameters: {
        type: "object",
        properties: {
          attestation: {
            type: "string",
            description: "The verifier's attestation statement",
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "How confident the verifier is in the completion",
          },
        },
        required: ["attestation", "confidence"],
      },
      handler: async (input) => {
        const evidence: VerificationEvidence = {
          type: "self_attestation",
          description: "Self-attestation by verifying party",
          result:
            input.confidence === "high"
              ? "confirmed"
              : input.confidence === "medium"
                ? "inconclusive"
                : "denied",
          details: `[${String(input.confidence)} confidence] ${String(input.attestation)}`,
          timestamp: Date.now(),
        };
        collectedEvidence.push(evidence);
        deps.onEvidence(evidence);
        return `Self-attestation recorded with ${String(input.confidence)} confidence.`;
      },
    },

    // Tool 4: check_payment_history
    {
      name: "check_payment_history",
      description:
        "Search the verifier's Monzo transaction history for payments related to this milestone (e.g., parts purchases, material costs). Supporting evidence for service/delivery milestones.",
      parameters: {
        type: "object",
        properties: {
          searchTerms: {
            type: "array",
            items: { type: "string" },
            description:
              "Terms to search for in transaction descriptions (e.g., ['plumbing', 'boiler', 'parts'])",
          },
          days: {
            type: "number",
            description: "Number of days of history to search (default 30)",
          },
        },
        required: ["searchTerms"],
      },
      handler: async (input) => {
        if (!deps.monzo) {
          return "Monzo not connected — payment history check skipped.";
        }

        try {
          const days = Math.min(Math.max(Number(input.days) || 30, 1), 90);
          const terms = Array.isArray(input.searchTerms)
            ? (input.searchTerms as string[]).map((t) =>
                String(t).toLowerCase(),
              )
            : [];

          const transactions = await deps.monzo.getTransactions(days);
          const matches = transactions.filter((t) => {
            const desc = t.description.toLowerCase();
            const merchant = t.merchant?.name?.toLowerCase() ?? "";
            return terms.some(
              (term) => desc.includes(term) || merchant.includes(term),
            );
          });

          const details =
            matches.length > 0
              ? `Found ${matches.length} related transactions:\n` +
                matches
                  .slice(0, 10)
                  .map((t) => {
                    const amount = (Math.abs(t.amount) / 100).toFixed(2);
                    const merchant = t.merchant?.name ?? t.description;
                    return `  £${amount} at ${merchant} (${t.created.slice(0, 10)})`;
                  })
                  .join("\n")
              : `No transactions matching [${terms.join(", ")}] found in the last ${days} days.`;

          const evidence: VerificationEvidence = {
            type: "payment_history",
            description: `Transaction search: ${terms.join(", ")}`,
            result: matches.length > 0 ? "confirmed" : "not_applicable",
            details,
            timestamp: Date.now(),
          };
          collectedEvidence.push(evidence);
          deps.onEvidence(evidence);
          return details;
        } catch (err) {
          return `Failed to check payment history: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // Tool 5: send_verification_update
    {
      name: "send_verification_update",
      description:
        "Send a progress message to the user during verification. Use this to keep the UI alive and show what you're doing.",
      parameters: {
        type: "object",
        properties: {
          step: {
            type: "string",
            description:
              "Current verification step (e.g., 'classifying', 'assessing_factors', 'gathering_evidence', 'evaluating')",
          },
          message: {
            type: "string",
            description: "Human-readable progress message",
          },
        },
        required: ["step", "message"],
      },
      handler: async (input) => {
        deps.panelEmitter.sendToUser(deps.requestedBy, {
          panel: "verification",
          verificationId: deps.verificationId,
          milestoneId: deps.milestone.id,
          step: String(input.step),
          status: "in_progress",
          details: String(input.message),
        });
        return "Progress update sent.";
      },
    },

    // Tool 6: submit_verdict
    {
      name: "submit_verdict",
      description:
        "Submit your final verification verdict. This is the TERMINAL tool — call it exactly once when you have gathered enough evidence. The verdict drives escrow capture/release.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["passed", "failed", "disputed"],
            description:
              "passed = milestone met, capture escrow. failed = not met, release escrow. disputed = unclear, hold escrow.",
          },
          reasoning: {
            type: "string",
            description:
              "Explanation of the verdict based on evidence gathered",
          },
          recommendedAmount: {
            type: "number",
            description:
              "For range-priced items: recommended capture amount in pence (between minAmount and maxAmount). Omit for fixed-price items.",
          },
        },
        required: ["status", "reasoning"],
      },
      handler: async (input) => {
        const status = String(input.status) as "passed" | "failed" | "disputed";
        const reasoning = String(input.reasoning);
        const recommendedAmount =
          input.recommendedAmount !== undefined
            ? Number(input.recommendedAmount)
            : undefined;

        // Validate recommended amount against line item range
        if (
          recommendedAmount !== undefined &&
          deps.lineItem.minAmount !== undefined &&
          deps.lineItem.maxAmount !== undefined
        ) {
          if (recommendedAmount < deps.lineItem.minAmount) {
            return `Error: recommendedAmount (${recommendedAmount}) is below minAmount (${deps.lineItem.minAmount})`;
          }
          if (recommendedAmount > deps.lineItem.maxAmount) {
            return `Error: recommendedAmount (${recommendedAmount}) exceeds maxAmount (${deps.lineItem.maxAmount})`;
          }
        }

        deps.onVerdict({
          status,
          reasoning,
          recommendedAmount,
          evidence: [...collectedEvidence],
        });

        return `Verdict submitted: ${status}. ${reasoning}`;
      },
    },
  ];
}
