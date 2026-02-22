import { create } from "zustand";

export interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: number;
  isLocal: boolean;
  isFinal: boolean;
}

interface TranscriptState {
  entries: TranscriptEntry[];
  partials: Map<string, TranscriptEntry>;
}

interface TranscriptActions {
  addFinal: (entry: TranscriptEntry) => void;
  setPartial: (speaker: string, entry: TranscriptEntry) => void;
  clearPartial: (speaker: string) => void;
  reset: () => void;
}

export const useTranscriptStore = create<TranscriptState & TranscriptActions>()(
  (set) => ({
    entries: [],
    partials: new Map(),

    addFinal: (entry) =>
      set((s) => ({
        entries: [...s.entries, entry],
        partials: removeKey(s.partials, entry.speaker),
      })),

    setPartial: (speaker, entry) =>
      set((s) => ({
        partials: new Map(s.partials).set(speaker, entry),
      })),

    clearPartial: (speaker) =>
      set((s) => ({
        partials: removeKey(s.partials, speaker),
      })),

    reset: () => set({ entries: [], partials: new Map() }),
  }),
);

function removeKey<K, V>(map: Map<K, V>, key: K): Map<K, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}
