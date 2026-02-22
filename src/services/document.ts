import { EventEmitter } from "eventemitter3";
import type { ILLMProvider } from "../providers/provider.js";
import type {
  AgentProposal,
  DocumentId,
  DocumentParty,
  DocumentSignature,
  LegalDocument,
  Milestone,
  MilestoneId,
  Negotiation,
  UserId,
} from "../types.js";
import type { IDocumentService } from "../interfaces.js";

const DOCUMENT_GENERATION_PROMPT = `You are a legal document generator. Create a CONCISE, professional agreement in Markdown format.

IMPORTANT: Keep it SHORT — under 400 words. The structured data (line items, milestones, signatures) is displayed separately in the app UI. This document is supplementary legal text only.

Include these sections BRIEFLY:
1. **TITLE** — One line
2. **DATE & PARTIES** — Names, roles, one line each
3. **AGREEMENT** — 2-3 sentences summarizing what was agreed
4. **PRICING** — One paragraph covering all line items, amounts, and payment types. For ranges, state the range and what determines the final price.
5. **MILESTONES** — If applicable, a bullet list of completion criteria and verification methods (1-2 lines each)
6. **TERMS** — Any conditions, dispute resolution, and cancellation in 2-3 bullet points
7. **SIGNATURES** — Simple placeholder lines

FORMATTING RULES:
- Use Markdown (headers, bold, bullet lists)
- Amounts with currency symbol (e.g., £500.00), ranges as £MIN–£MAX
- Simple language, no legal jargon — readable by anyone
- NO lengthy recitals, NO verbose boilerplate
- Be precise but brief

Output ONLY the document content in Markdown. No preamble.`;

export class DocumentService extends EventEmitter implements IDocumentService {
  private documents = new Map<DocumentId, LegalDocument>();

  constructor(
    private readonly config: {
      llmProvider: ILLMProvider;
      llmModel: string;
    },
  ) {
    super();
  }

  async generateDocument(
    negotiation: Negotiation,
    proposal: AgentProposal,
    parties: DocumentParty[],
    conversationContext: string,
  ): Promise<LegalDocument> {
    const id: DocumentId =
      "doc_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 6);

    const response = await this.config.llmProvider.createMessage({
      model: this.config.llmModel,
      maxTokens: 3000,
      system: DOCUMENT_GENERATION_PROMPT,
      messages: [
        {
          role: "user",
          content: this.buildDocumentRequest(
            negotiation,
            proposal,
            parties,
            conversationContext,
          ),
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const content =
      textBlock && textBlock.type === "text"
        ? textBlock.text
        : "Error: Failed to generate document";

    const doc: LegalDocument = {
      id,
      title: `Agreement — ${proposal.summary}`,
      content,
      negotiationId: negotiation.id,
      parties,
      terms: proposal,
      signatures: [],
      status: "draft",
      createdAt: Date.now(),
    };

    const pending: LegalDocument = {
      ...doc,
      status: "pending_signatures" as const,
    };
    this.documents.set(id, pending);
    this.emit("document:generated", pending);
    return pending;
  }

  signDocument(documentId: DocumentId, userId: UserId): void {
    const doc = this.documents.get(documentId);
    if (!doc) {
      throw new Error("Document not found");
    }
    if (doc.status === "fully_signed") {
      throw new Error("Document already fully signed");
    }
    if (!doc.parties.some((p) => p.userId === userId)) {
      throw new Error("User is not a party to this document");
    }
    if (doc.signatures.some((s) => s.userId === userId)) {
      return;
    }

    const sig: DocumentSignature = { userId, signedAt: Date.now() };
    const updated: LegalDocument = {
      ...doc,
      signatures: [...doc.signatures, sig],
      status:
        doc.signatures.length + 1 >= doc.parties.length
          ? "fully_signed"
          : "pending_signatures",
    };

    this.documents.set(documentId, updated);
    this.emit("document:signed", { documentId, userId });

    if (updated.status === "fully_signed") {
      this.emit("document:completed", updated);
    }
  }

  isFullySigned(documentId: DocumentId): boolean {
    const doc = this.documents.get(documentId);
    return doc?.status === "fully_signed";
  }

  getDocument(documentId: DocumentId): LegalDocument | undefined {
    return this.documents.get(documentId);
  }

  updateMilestones(documentId: DocumentId, milestones: Milestone[]): void {
    const doc = this.documents.get(documentId);
    if (!doc) {
      throw new Error("Document not found");
    }
    const updated: LegalDocument = { ...doc, milestones };
    this.documents.set(documentId, updated);
  }

  private generateMilestones(
    documentId: DocumentId,
    proposal: AgentProposal,
  ): Milestone[] {
    const milestones: Milestone[] = [];
    proposal.lineItems.forEach((li, index) => {
      if (li.type === "escrow" || li.type === "conditional") {
        const milestoneId: MilestoneId =
          "ms_" +
          Date.now().toString(36) +
          "_" +
          Math.random().toString(36).slice(2, 6);
        milestones.push({
          id: milestoneId,
          documentId,
          lineItemIndex: index,
          description: li.description,
          amount: li.maxAmount ?? li.amount,
          condition: li.condition ?? `Completion of: ${li.description}`,
          status: "pending",
        });
      }
    });
    return milestones;
  }

  private buildDocumentRequest(
    negotiation: Negotiation,
    proposal: AgentProposal,
    parties: DocumentParty[],
    conversationContext: string,
  ): string {
    const partyList = parties.map((p) => `- ${p.name} (${p.role})`).join("\n");
    const lineItems = proposal.lineItems
      .map((li) => {
        let line = `- ${li.description}: `;
        if (li.minAmount !== undefined && li.maxAmount !== undefined) {
          line += `£${(li.minAmount / 100).toFixed(2)}–£${(li.maxAmount / 100).toFixed(2)} (${li.type}`;
        } else {
          line += `£${(li.amount / 100).toFixed(2)} (${li.type}`;
        }
        if (li.condition) line += `, condition: ${li.condition}`;
        line += ")";
        if (li.factors && li.factors.length > 0) {
          line += `\n  Factors: ${li.factors.map((f) => `${f.name} [${f.impact}]: ${f.description}`).join("; ")}`;
        }
        return line;
      })
      .join("\n");

    const factorSection = proposal.factorSummary
      ? `\nFACTOR SUMMARY:\n${proposal.factorSummary}\n`
      : "";

    const milestoneSection =
      proposal.milestones && proposal.milestones.length > 0
        ? `\nMILESTONES:\n${proposal.milestones
            .map(
              (m, i) =>
                `Milestone ${i + 1}: ${m.title}\n  Deliverables: ${m.deliverables.join(", ")}\n  Verification: ${m.verificationMethod}\n  Criteria: ${m.completionCriteria.join("; ")}\n  Amount: £${(m.amount / 100).toFixed(2)}\n  Timeline: ${m.expectedTimeline ?? "TBD"}`,
            )
            .join("\n")}\n`
        : "\nMILESTONES:\nNone — immediate payment only\n";

    return `Generate a binding agreement document for the following:

PARTIES:
${partyList}

AGREED TERMS:
Summary: ${proposal.summary}
Total (maximum): £${(proposal.totalAmount / 100).toFixed(2)} ${proposal.currency.toUpperCase()}

LINE ITEMS:
${lineItems}
${factorSection}${milestoneSection}
CONDITIONS:
${proposal.conditions.length > 0 ? proposal.conditions.map((c) => `- ${c}`).join("\n") : "None"}

NEGOTIATION ROUNDS: ${negotiation.rounds.length}

CONVERSATION CONTEXT (last relevant portion):
${conversationContext.slice(-2000)}`;
  }
}
