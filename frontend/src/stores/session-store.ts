import { create } from "zustand";

export type AppScreen = "setup" | "session" | "contracts";

interface SessionState {
  status: AppScreen;
  userId: string | null;
  displayName: string | null;
  roomId: string | null;
  peerUserId: string | null;
  peerDisplayName: string | null;
  expandedView: boolean;
  audioRelay: boolean;
  sessionStatus: string;
}

interface SessionActions {
  startSession: (userId: string, displayName: string, roomId: string) => void;
  setPeer: (userId: string, displayName: string) => void;
  clearPeer: () => void;
  toggleExpanded: () => void;
  setExpanded: (open: boolean) => void;
  toggleAudioRelay: () => void;
  setSessionStatus: (status: string) => void;
  showContracts: () => void;
  backToSetup: () => void;
  reset: () => void;
}

const initialState: SessionState = {
  status: "setup",
  userId: null,
  displayName: null,
  roomId: null,
  peerUserId: null,
  peerDisplayName: null,
  expandedView: false,
  audioRelay: false,
  sessionStatus: "Waiting...",
};

export const useSessionStore = create<SessionState & SessionActions>()(
  (set) => ({
    ...initialState,

    startSession: (userId, displayName, roomId) =>
      set({
        status: "session",
        userId,
        displayName,
        roomId,
      }),

    setPeer: (userId, displayName) =>
      set({ peerUserId: userId, peerDisplayName: displayName }),

    clearPeer: () => set({ peerUserId: null, peerDisplayName: null }),

    toggleExpanded: () => set((s) => ({ expandedView: !s.expandedView })),

    setExpanded: (open) => set({ expandedView: open }),

    toggleAudioRelay: () => set((s) => ({ audioRelay: !s.audioRelay })),

    setSessionStatus: (sessionStatus) => set({ sessionStatus }),

    showContracts: () => set({ status: "contracts" }),

    backToSetup: () => set({ status: "setup" }),

    reset: () => set(initialState),
  }),
);
