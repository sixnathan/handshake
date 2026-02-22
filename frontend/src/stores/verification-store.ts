import { create } from "zustand";

export interface VerificationStep {
  text: string;
  timestamp: number;
  status: "in_progress" | "completed" | "failed";
}

export interface VerificationResult {
  outcome: "passed" | "failed" | "disputed";
  reasoning: string;
  evidence: string[];
  verifiedAmount?: number;
}

interface VerificationState {
  modalVisible: boolean;
  documentId: string | null;
  milestoneId: string | null;
  steps: VerificationStep[];
  result: VerificationResult | null;
  error: string | null;
}

interface VerificationActions {
  openModal: (documentId: string, milestoneId: string) => void;
  closeModal: () => void;
  addStep: (step: VerificationStep) => void;
  setResult: (result: VerificationResult) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initialState: VerificationState = {
  modalVisible: false,
  documentId: null,
  milestoneId: null,
  steps: [],
  result: null,
  error: null,
};

export const useVerificationStore = create<
  VerificationState & VerificationActions
>()((set) => ({
  ...initialState,

  openModal: (documentId, milestoneId) =>
    set({
      modalVisible: true,
      documentId,
      milestoneId,
      steps: [],
      result: null,
      error: null,
    }),

  closeModal: () => set({ modalVisible: false }),

  addStep: (step) => set((s) => ({ steps: [...s.steps, step] })),

  setResult: (result) => set({ result }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));
