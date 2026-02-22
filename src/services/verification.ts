import { EventEmitter } from "eventemitter3";
import type { ILLMProvider } from "../providers/provider.js";
import type {
  LLMMessage,
  LLMToolUseBlock,
  LLMToolResultBlock,
} from "../providers/types.js";
import type {
  LegalDocument,
  LineItem,
  Milestone,
  UserId,
  RoomId,
  VerificationEvidence,
  VerificationId,
  VerificationResult,
} from "../types.js";
import type {
  IVerificationService,
  IPaymentService,
  IMonzoService,
  IPanelEmitter,
  ToolDefinition,
} from "../interfaces.js";
import { PhoneVerificationService } from "./phone-verification.js";
import { buildVerificationTools } from "../verification-tools.js";

const MAX_RECURSION_DEPTH = 15;
const VERIFICATION_TIMEOUT_MS = 120_000; // 2 minutes

function buildVerificationSystemPrompt(
  document: LegalDocument,
  milestone: Milestone,
  lineItem: LineItem,
): string {
  const hasRange =
    lineItem.minAmount !== undefined && lineItem.maxAmount !== undefined;
  const factorList =
    lineItem.factors && lineItem.factors.length > 0
      ? lineItem.factors
          .map((f) => `  - ${f.name}: ${f.description} (${f.impact})`)
          .join("\n")
      : "  None";

  const deliverablesList = milestone.deliverables
    ? `- Deliverables: ${milestone.deliverables.join(", ")}`
    : "";
  const verificationMethodStr = milestone.verificationMethod
    ? `- Verification Method: ${milestone.verificationMethod}`
    : "- Verification Method: General assessment";
  const criteriaList =
    milestone.completionCriteria && milestone.completionCriteria.length > 0
      ? milestone.completionCriteria
      : [milestone.condition];
  const timelineStr = milestone.expectedTimeline
    ? `- Expected Timeline: ${milestone.expectedTimeline}`
    : "";

  return `You are a milestone verification agent for the Handshake platform.

DOCUMENT: "${document.title}" (${document.id})
PARTIES: ${document.parties.map((p) => `${p.name} (${p.role})`).join(", ")}

MILESTONE TO VERIFY:
- Title: ${milestone.description}
${deliverablesList ? deliverablesList + "\n" : ""}- Condition: ${milestone.condition}
${verificationMethodStr}
- Completion Criteria (ALL must be met):
${criteriaList.map((c) => `  [ ] ${c}`).join("\n")}
- Amount: £${(milestone.amount / 100).toFixed(2)}
${hasRange ? `- Price Range: £${(lineItem.minAmount! / 100).toFixed(2)} – £${(lineItem.maxAmount! / 100).toFixed(2)}` : ""}
${timelineStr ? timelineStr + "\n" : ""}- Factors:
${factorList}

YOUR TASK:
Follow this 5-step verification protocol:

1. CLASSIFY: Use send_verification_update to classify the milestone type (service completion, delivery, parts supply, etc.)

2. ASSESS: For each factor/condition, use assess_condition to create structured evidence.
   ${hasRange ? "Your factor assessments determine where in the price range the final amount lands." : ""}

3. GATHER EVIDENCE:
   - If a phone number was provided, use phone_verify to call and confirm
   - Use record_self_attestation to record that the verifier attests completion
   - Use check_payment_history if relevant (parts purchases, material costs)

4. EVALUATE: Use send_verification_update to summarize your overall assessment

5. SUBMIT: Use submit_verdict with your final decision:
   - "passed" = milestone conditions met → escrow will be captured
   - "failed" = conditions not met → escrow will be released (funds returned)
   - "disputed" = unclear/contested → escrow stays held for manual resolution
   ${hasRange ? `- Include recommendedAmount (in pence) between ${lineItem.minAmount} and ${lineItem.maxAmount}` : ""}

RULES:
- Always call send_verification_update at least twice (classifying + evaluating)
- Gather at least 2 types of evidence before submitting verdict
- Be thorough but efficient — this should complete in under 2 minutes
- You MUST call submit_verdict exactly once as your final action`;
}

export class VerificationService
  extends EventEmitter
  implements IVerificationService
{
  private readonly results = new Map<VerificationId, VerificationResult>();

  constructor(
    private readonly config: {
      provider: ILLMProvider;
      model: string;
      maxTokens: number;
    },
    private readonly payment: IPaymentService,
    private readonly monzo: IMonzoService | null,
    private readonly phoneService: PhoneVerificationService,
    private readonly panelEmitter: IPanelEmitter,
    private readonly roomId: RoomId,
  ) {
    super();
  }

  async verifyMilestone(
    document: LegalDocument,
    milestone: Milestone,
    lineItem: LineItem,
    requestedBy: UserId,
    phoneNumber?: string,
    contactName?: string,
  ): Promise<VerificationResult> {
    const verificationId =
      `ver_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` as VerificationId;

    this.emit("verification:started", {
      verificationId,
      milestoneId: milestone.id,
    });

    this.panelEmitter.sendToUser(requestedBy, {
      panel: "verification",
      verificationId,
      milestoneId: milestone.id,
      step: "started",
      status: "in_progress",
      details: `Verifying: ${milestone.description}`,
    });

    try {
      const result = await this.runVerification(
        verificationId,
        document,
        milestone,
        lineItem,
        requestedBy,
        phoneNumber,
        contactName,
      );

      // Process verdict (escrow capture/release)
      const finalResult = await this.processVerdict(result, milestone);
      this.results.set(verificationId, finalResult);

      this.emit("verification:completed", finalResult);

      this.panelEmitter.sendToUser(requestedBy, {
        panel: "verification",
        verificationId,
        milestoneId: milestone.id,
        step: "completed",
        status: finalResult.status,
        details: finalResult.reasoning,
        result: finalResult,
      });

      return finalResult;
    } catch (err) {
      const errorResult: VerificationResult = {
        id: verificationId,
        milestoneId: milestone.id,
        status: "disputed",
        evidence: [],
        reasoning: `Verification error: ${err instanceof Error ? err.message : String(err)}. Escrow held for manual resolution.`,
      };

      this.results.set(verificationId, errorResult);
      this.emit("verification:completed", errorResult);

      this.panelEmitter.sendToUser(requestedBy, {
        panel: "verification",
        verificationId,
        milestoneId: milestone.id,
        step: "error",
        status: "disputed",
        details: errorResult.reasoning,
        result: errorResult,
      });

      return errorResult;
    }
  }

  getResult(verificationId: string): VerificationResult | undefined {
    return this.results.get(verificationId as VerificationId);
  }

  private async runVerification(
    verificationId: VerificationId,
    document: LegalDocument,
    milestone: Milestone,
    lineItem: LineItem,
    requestedBy: UserId,
    phoneNumber?: string,
    contactName?: string,
  ): Promise<VerificationResult> {
    const systemPrompt = buildVerificationSystemPrompt(
      document,
      milestone,
      lineItem,
    );

    let verdictResult: VerificationResult | null = null;

    const tools = buildVerificationTools({
      milestone,
      lineItem,
      verificationId,
      monzo: this.monzo,
      phoneService: this.phoneService,
      panelEmitter: this.panelEmitter,
      requestedBy,
      roomId: this.roomId,
      phoneNumber,
      contactName,
      onEvidence: (evidence: VerificationEvidence) => {
        this.emit("verification:update", {
          verificationId,
          milestoneId: milestone.id,
          step: evidence.type,
          details: evidence.description,
        });
      },
      onVerdict: (verdict) => {
        verdictResult = {
          id: verificationId,
          milestoneId: milestone.id,
          status: verdict.status,
          evidence: verdict.evidence,
          reasoning: verdict.reasoning,
          recommendedAmount: verdict.recommendedAmount,
        };
      },
    });

    const messages: LLMMessage[] = [
      {
        role: "user",
        content: `Begin verification of milestone "${milestone.description}" now. Follow the 5-step protocol.${phoneNumber ? `\n\nPhone number available: ${phoneNumber}${contactName ? ` (${contactName})` : ""}` : "\n\nNo phone number provided — skip phone verification."}`,
      },
    ];

    // Run LLM loop with timeout
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error("Verification timed out")),
        VERIFICATION_TIMEOUT_MS,
      ),
    );

    const loopPromise = this.runVerificationLoop(
      systemPrompt,
      messages,
      tools,
      () => verdictResult !== null,
    );

    await Promise.race([loopPromise, timeoutPromise]);

    if (!verdictResult) {
      return {
        id: verificationId,
        milestoneId: milestone.id,
        status: "disputed",
        evidence: [],
        reasoning:
          "Verification did not produce a verdict. Escrow held for manual resolution.",
      };
    }

    return verdictResult;
  }

  private async runVerificationLoop(
    systemPrompt: string,
    messages: LLMMessage[],
    tools: ToolDefinition[],
    isComplete: () => boolean,
    depth = 0,
  ): Promise<void> {
    if (depth >= MAX_RECURSION_DEPTH || isComplete()) return;

    const llmTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const response = await this.config.provider.createMessage({
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      system: systemPrompt,
      messages,
      tools: llmTools,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stopReason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is LLMToolUseBlock => b.type === "tool_use",
      );

      const toolResults: LLMToolResultBlock[] = [];

      for (const toolUse of toolUseBlocks) {
        const tool = tools.find((t) => t.name === toolUse.name);
        let result: string;

        if (tool) {
          try {
            result = await tool.handler(toolUse.input);
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
        } else {
          result = `Error: Unknown tool "${toolUse.name}"`;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      messages.push({ role: "user", content: toolResults });

      if (!isComplete()) {
        await this.runVerificationLoop(
          systemPrompt,
          messages,
          tools,
          isComplete,
          depth + 1,
        );
      }
    }
  }

  private async processVerdict(
    result: VerificationResult,
    milestone: Milestone,
  ): Promise<VerificationResult> {
    if (!milestone.escrowHoldId) return result;

    switch (result.status) {
      case "passed": {
        const captureAmount = result.recommendedAmount ?? milestone.amount;
        const captureResult = await this.payment.captureEscrow(
          milestone.escrowHoldId,
          result.recommendedAmount,
        );

        if (captureResult.success) {
          return { ...result, capturedAmount: captureAmount };
        }
        return {
          ...result,
          status: "disputed",
          reasoning: `${result.reasoning}\n\nEscrow capture failed: ${captureResult.error}. Held for manual resolution.`,
        };
      }

      case "failed": {
        const releaseResult = await this.payment.releaseEscrow(
          milestone.escrowHoldId,
        );

        if (!releaseResult.success) {
          return {
            ...result,
            reasoning: `${result.reasoning}\n\nEscrow release failed: ${releaseResult.error}. Manual intervention required.`,
          };
        }
        return result;
      }

      case "disputed":
        // No escrow action — held for manual resolution
        return result;

      default:
        return result;
    }
  }
}
