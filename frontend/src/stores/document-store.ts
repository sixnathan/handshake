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
  status: "pending" | "verifying" | "completed" | "failed" | "disputed";
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
  createdAt: number;
}

interface DocumentState {
  currentDocument: LegalDocument | null;
  milestones: Map<string, Milestone>;
  bottomSheetVisible: boolean;
  overlayVisible: boolean;
}

interface DocumentActions {
  setDocument: (doc: LegalDocument) => void;
  addSignature: (userId: string) => void;
  setFullySigned: () => void;
  updateMilestone: (milestone: Milestone) => void;
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
    bottomSheetVisible: false,
    overlayVisible: false,

    setDocument: (doc) => {
      const milestones = new Map<string, Milestone>();
      if (doc.milestones) {
        for (const ms of doc.milestones) {
          milestones.set(ms.id, ms);
        }
      }
      return set({
        currentDocument: doc,
        milestones,
        bottomSheetVisible: true,
      });
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

    showBottomSheet: () => set({ bottomSheetVisible: true }),
    hideBottomSheet: () => set({ bottomSheetVisible: false }),
    showOverlay: () => set({ overlayVisible: true }),
    hideOverlay: () => set({ overlayVisible: false }),
    reset: () =>
      set({
        currentDocument: null,
        milestones: new Map(),
        bottomSheetVisible: false,
        overlayVisible: false,
      }),
  }),
);
