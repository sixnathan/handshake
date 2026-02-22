import { useEffect, useMemo, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TranscriptBubble } from "./TranscriptBubble";
import { useTranscriptStore } from "@/stores/transcript-store";
import { useShallow } from "zustand/react/shallow";

interface TranscriptColumnProps {
  label: string;
  isLocal: boolean;
}

export function TranscriptColumn({ label, isLocal }: TranscriptColumnProps) {
  const allEntries = useTranscriptStore(useShallow((s) => s.entries));
  const partialsMap = useTranscriptStore(useShallow((s) => s.partials));

  const entries = useMemo(
    () => allEntries.filter((e) => e.isLocal === isLocal),
    [allEntries, isLocal],
  );
  const partials = useMemo(() => {
    const result = [];
    for (const [, entry] of partialsMap) {
      if (entry.isLocal === isLocal) result.push(entry);
    }
    return result;
  }, [partialsMap, isLocal]);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, partials.length]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-separator bg-surface-primary px-3 py-2.5 text-sm font-medium uppercase tracking-wider text-text-primary">
        {label}
      </div>
      <ScrollArea className="flex-1 bg-surface-tertiary">
        <div className="p-3">
          {entries.length === 0 && partials.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12">
              <span className="size-2 animate-pulse rounded-full bg-text-tertiary" />
              <p className="text-sm text-text-tertiary">
                Waiting for speech...
              </p>
            </div>
          )}
          {entries.map((entry, i) => (
            <TranscriptBubble
              key={`${entry.timestamp}-${i}`}
              text={entry.text}
              timestamp={entry.timestamp}
              isLocal={entry.isLocal}
              isPartial={false}
            />
          ))}
          {partials.map((entry, i) => (
            <TranscriptBubble
              key={`partial-${i}`}
              text={entry.text}
              timestamp={entry.timestamp}
              isLocal={entry.isLocal}
              isPartial={true}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
