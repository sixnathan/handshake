import { create } from "zustand";

export type TimelineNodeType =
  | "detect"
  | "propose"
  | "receive"
  | "counter"
  | "accept"
  | "reject"
  | "sign"
  | "pay"
  | "doc"
  | "tool"
  | "message";

export interface TimelineNode {
  type: TimelineNodeType;
  text: string;
  timestamp: number;
}

interface TimelineState {
  nodes: TimelineNode[];
}

interface TimelineActions {
  addNode: (node: TimelineNode) => void;
  reset: () => void;
}

export const useTimelineStore = create<TimelineState & TimelineActions>()(
  (set) => ({
    nodes: [],

    addNode: (node) => set((s) => ({ nodes: [...s.nodes, node] })),

    reset: () => set({ nodes: [] }),
  }),
);
