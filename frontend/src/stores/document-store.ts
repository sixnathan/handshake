import { create } from "zustand";

export interface DocumentParty {
  userId: string;
  name: string;
  role: string;
}

export interface DocumentSignature {
  userId: string;
  signedAt: number;
}

export interface Milestone {
  id: string;
  documentId: string;
  lineItemIndex: number;
  description: string;
  amount: number;
  condition: string;
  status:
    | "pending"
    | "provider_confirmed"
    | "client_confirmed"
    | "pending_amount"
    | "completed"
    | "released"
    | "verifying"
    | "failed"
    | "disputed";
  deliverables?: string[];
  verificationMethod?: string;
  completionCriteria?: string[];
  expectedTimeline?: string;
  completedAt?: number;
  completedBy?: string;
  verificationId?: string;
  verificationResult?: {
    outcome: "passed" | "failed" | "disputed";
    reasoning: string;
    evidence: string[];
    verifiedAmount?: number;
  };
  escrowHoldId?: string;
  providerConfirmed?: boolean;
  clientConfirmed?: boolean;
  proposedAmount?: number;
  proposedBy?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface PaymentEvent {
  id: string;
  type: "payment" | "escrow_hold" | "execution";
  timestamp: number;
  amount?: number;
  currency?: string;
  recipient?: string;
  status: string;
  paymentIntentId?: string;
  description?: string;
  step?: string;
  details?: string;
  stripeMethod?: string;
}

export interface SavedContract extends LegalDocument {
  paymentEvents?: PaymentEvent[];
  conversationHistory?: { speaker: string; text: string; timestamp: number }[];
}

export interface LegalDocument {
  id: string;
  title: string;
  content: string;
  negotiationId: string;
  parties: DocumentParty[];
  terms: {
    summary: string;
    lineItems: {
      description: string;
      amount: number;
      type: string;
      condition?: string;
      minAmount?: number;
      maxAmount?: number;
      factors?: { name: string; description: string; impact: string }[];
    }[];
    totalAmount: number;
    currency: string;
    conditions: string[];
    factorSummary?: string;
  };
  signatures: DocumentSignature[];
  status: "draft" | "pending_signatures" | "fully_signed";
  milestones?: Milestone[];
  providerId?: string;
  clientId?: string;
  createdAt: number;
}

interface DocumentState {
  currentDocument: LegalDocument | null;
  milestones: Map<string, Milestone>;
  paymentEvents: PaymentEvent[];
  bottomSheetVisible: boolean;
  overlayVisible: boolean;
}

interface DocumentActions {
  setDocument: (doc: LegalDocument) => void;
  addSignature: (userId: string) => void;
  setFullySigned: () => void;
  updateMilestone: (milestone: Milestone) => void;
  addPaymentEvent: (event: PaymentEvent) => void;
  showBottomSheet: () => void;
  hideBottomSheet: () => void;
  showOverlay: () => void;
  hideOverlay: () => void;
  reset: () => void;
}

export const useDocumentStore = create<DocumentState & DocumentActions>()(
  (set) => ({
    currentDocument: null,
    milestones: new Map(),
    paymentEvents: [],
    bottomSheetVisible: false,
    overlayVisible: false,

    setDocument: (doc) => {
      const milestones = new Map<string, Milestone>();
      if (doc.milestones) {
        for (const ms of doc.milestones) {
          milestones.set(ms.id, ms);
        }
      }
      return set((s) => ({
        currentDocument: doc,
        milestones,
        // Only auto-show bottom sheet if no document existed before
        bottomSheetVisible:
          s.currentDocument === null ? true : s.bottomSheetVisible,
      }));
    },

    addSignature: (userId) =>
      set((s) => {
        if (!s.currentDocument) return s;
        return {
          currentDocument: {
            ...s.currentDocument,
            signatures: [
              ...s.currentDocument.signatures,
              { userId, signedAt: Date.now() },
            ],
          },
        };
      }),

    setFullySigned: () =>
      set((s) => {
        if (!s.currentDocument) return s;
        return {
          currentDocument: { ...s.currentDocument, status: "fully_signed" },
        };
      }),

    updateMilestone: (milestone) =>
      set((s) => ({
        milestones: new Map(s.milestones).set(milestone.id, milestone),
      })),

    addPaymentEvent: (event) =>
      set((s) => ({ paymentEvents: [...s.paymentEvents, event] })),

    showBottomSheet: () => set({ bottomSheetVisible: true }),
    hideBottomSheet: () => set({ bottomSheetVisible: false }),
    showOverlay: () => set({ overlayVisible: true, bottomSheetVisible: false }),
    hideOverlay: () => set({ overlayVisible: false }),
    reset: () =>
      set({
        currentDocument: null,
        milestones: new Map(),
        paymentEvents: [],
        bottomSheetVisible: false,
        overlayVisible: false,
      }),
  }),
);
