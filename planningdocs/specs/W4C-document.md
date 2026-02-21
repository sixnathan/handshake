# W4C — DocumentService

**File to create:** `src/services/document.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts`, `src/providers/` (all already exist)
**Depended on by:** RoomManager (generates doc after agreement), PanelEmitter (displays to users)

---

## Purpose

LLM-powered legal document generation. After agents agree on terms, this service generates a markdown-formatted binding agreement document, tracks signatures from both parties, and emits events when fully signed.

---

## Imports

```ts
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
```

---

## Class: DocumentService

```ts
export class DocumentService extends EventEmitter implements IDocumentService
```

### Constructor

```ts
constructor(private readonly config: {
  llmProvider: ILLMProvider;
  llmModel: string;
})
```

### Private State

```ts
private documents = new Map<DocumentId, LegalDocument>();
```

### Methods

**`generateDocument(negotiation: Negotiation, proposal: AgentProposal, parties: DocumentParty[], conversationContext: string): Promise<LegalDocument>`**
1. Generate document ID: `const id = "doc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6)`
2. Call LLM to generate document content:
   ```ts
   const response = await this.config.llmProvider.createMessage({
     model: this.config.llmModel,
     maxTokens: 2000,
     system: DOCUMENT_GENERATION_PROMPT,
     messages: [{
       role: "user",
       content: this.buildDocumentRequest(negotiation, proposal, parties, conversationContext),
     }],
   });
   ```
3. Extract markdown content from response:
   ```ts
   const textBlock = response.content.find(b => b.type === "text");
   const content = textBlock && textBlock.type === "text" ? textBlock.text : "Error: Failed to generate document";
   ```
4. Build document:
   ```ts
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
   ```
5. Update status to pending_signatures: `const pending = { ...doc, status: "pending_signatures" as const }`
6. Store: `this.documents.set(id, pending)`
7. Emit `"document:generated"` with pending
8. Return pending

**`signDocument(documentId: DocumentId, userId: UserId): void`**
1. `const doc = this.documents.get(documentId)`
2. If `!doc`, throw `Error("Document not found")`
3. If `doc.status === "fully_signed"`, throw `Error("Document already fully signed")`
4. Check if user is a party: `if (!doc.parties.some(p => p.userId === userId))`, throw `Error("User is not a party to this document")`
5. Check if already signed: `if (doc.signatures.some(s => s.userId === userId))`, return (idempotent)
6. Build new signature: `const sig: DocumentSignature = { userId, signedAt: Date.now() }`
7. Build updated doc:
   ```ts
   const updated: LegalDocument = {
     ...doc,
     signatures: [...doc.signatures, sig],
     status: doc.signatures.length + 1 >= doc.parties.length ? "fully_signed" : "pending_signatures",
   };
   ```
8. Store: `this.documents.set(documentId, updated)`
9. Emit `"document:signed"` with `{ documentId, userId }`
10. If `updated.status === "fully_signed"`:
    - Emit `"document:completed"` with updated

**`isFullySigned(documentId: DocumentId): boolean`**
1. `const doc = this.documents.get(documentId)`
2. Return `doc?.status === "fully_signed"` (false if not found)

**`getDocument(documentId: DocumentId): LegalDocument | undefined`**
- Return `this.documents.get(documentId)`

---

## LLM Prompt

```ts
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
```

### buildDocumentRequest (private)

```ts
private buildDocumentRequest(
  negotiation: Negotiation,
  proposal: AgentProposal,
  parties: DocumentParty[],
  conversationContext: string,
): string {
  const partyList = parties.map(p => `- ${p.name} (${p.role})`).join("\n");
  const lineItems = proposal.lineItems.map(li =>
    `- ${li.description}: £${(li.amount / 100).toFixed(2)} (${li.type}${li.condition ? `, condition: ${li.condition}` : ""})`
  ).join("\n");

  return `Generate a binding agreement document for the following:

PARTIES:
${partyList}

AGREED TERMS:
Summary: ${proposal.summary}
Total: £${(proposal.totalAmount / 100).toFixed(2)} ${proposal.currency.toUpperCase()}

LINE ITEMS:
${lineItems}

CONDITIONS:
${proposal.conditions.length > 0 ? proposal.conditions.map(c => `- ${c}`).join("\n") : "None"}

NEGOTIATION ROUNDS: ${negotiation.rounds.length}

CONVERSATION CONTEXT (last relevant portion):
${conversationContext.slice(-2000)}`;
}
```

---

## Events Emitted

| Event | Payload | When |
|-------|---------|------|
| `"document:generated"` | `LegalDocument` | Document created and ready for signatures |
| `"document:signed"` | `{ documentId: DocumentId, userId: UserId }` | A party signs |
| `"document:completed"` | `LegalDocument` | All parties have signed |

---

## Edge Cases

- LLM fails to generate: returns document with error content (service doesn't crash)
- Same user signs twice: idempotent (second sign is no-op)
- Non-party tries to sign: throws Error
- Document already fully signed: throws Error
- Very long conversation context: truncated to last 2000 chars in prompt

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `IDocumentService` interface
- LLM generates structured markdown document
- Signature tracking with party validation
- `"document:completed"` emitted when all parties sign
- Immutable document updates
- Error handling for LLM failures
