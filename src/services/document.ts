import { EventEmitter } from "eventemitter3";
import type { ILLMProvider } from "../providers/provider.js";
import type {
  AgentProposal,
  DocumentId,
  DocumentParty,
  DocumentSignature,
  LegalDocument,
  Negotiation,
  UserId,
} from "../types.js";
import type { IDocumentService } from "../interfaces.js";

const DOCUMENT_GENERATION_PROMPT = `You are a legal document generator. Create a clear, professional agreement document in Markdown format based on the negotiated terms.

The document MUST include these sections:
1. **TITLE** — Clear description of the agreement
2. **DATE** — Current date
3. **PARTIES** — Full names and roles of each party
4. **RECITALS** — Background context (what was discussed)
5. **TERMS** — Numbered list of agreed terms, including:
   - Description of each line item
   - Amounts in the agreed currency
   - Payment type (immediate, escrow, or conditional)
   - Any conditions for escrow items
6. **PAYMENT SCHEDULE** — When and how payments will be made
7. **CONDITIONS** — Any conditions that must be met
8. **DISPUTE RESOLUTION** — How disputes will be handled
9. **SIGNATURES** — Signature lines for each party (placeholder format)

FORMATTING RULES:
- Use Markdown formatting
- Amounts should be formatted with currency symbol (e.g., £500.00)
- Be precise and unambiguous
- Use simple language, avoid unnecessary legal jargon
- The document should be readable by non-lawyers

Output ONLY the document content in Markdown. No preamble or explanation.`;

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
      maxTokens: 2000,
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

  private buildDocumentRequest(
    negotiation: Negotiation,
    proposal: AgentProposal,
    parties: DocumentParty[],
    conversationContext: string,
  ): string {
    const partyList = parties.map((p) => `- ${p.name} (${p.role})`).join("\n");
    const lineItems = proposal.lineItems
      .map(
        (li) =>
          `- ${li.description}: £${(li.amount / 100).toFixed(2)} (${li.type}${li.condition ? `, condition: ${li.condition}` : ""})`,
      )
      .join("\n");

    return `Generate a binding agreement document for the following:

PARTIES:
${partyList}

AGREED TERMS:
Summary: ${proposal.summary}
Total: £${(proposal.totalAmount / 100).toFixed(2)} ${proposal.currency.toUpperCase()}

LINE ITEMS:
${lineItems}

CONDITIONS:
${proposal.conditions.length > 0 ? proposal.conditions.map((c) => `- ${c}`).join("\n") : "None"}

NEGOTIATION ROUNDS: ${negotiation.rounds.length}

CONVERSATION CONTEXT (last relevant portion):
${conversationContext.slice(-2000)}`;
  }
}
