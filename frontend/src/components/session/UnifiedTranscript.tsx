import { useEffect, useMemo, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TranscriptBubble } from "./TranscriptBubble";
import { useTranscriptStore } from "@/stores/transcript-store";
import { useSessionStore } from "@/stores/session-store";

export function UnifiedTranscript() {
  const entries = useTranscriptStore((s) => s.entries);
  const partialsMap = useTranscriptStore((s) => s.partials);
  const displayName = useSessionStore((s) => s.displayName);
  const peerDisplayName = useSessionStore((s) => s.peerDisplayName);

  const partials = useMemo(() => {
    const result = [];
    for (const [, entry] of partialsMap) {
      result.push(entry);
    }
    return result;
  }, [partialsMap]);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, partials.length]);

  const isEmpty = entries.length === 0 && partials.length === 0;

  return (
    <ScrollArea className="flex-1 bg-surface-tertiary">
      <div className="p-3">
        {isEmpty && (
          <div className="flex flex-col items-center gap-2 py-12">
            <div className="flex items-center gap-1.5">
              <span className="size-2 animate-pulse rounded-full bg-accent-blue" />
              <span className="size-2 animate-pulse rounded-full bg-accent-blue [animation-delay:200ms]" />
              <span className="size-2 animate-pulse rounded-full bg-accent-blue [animation-delay:400ms]" />
            </div>
            <p className="text-sm text-text-tertiary">Waiting for speech...</p>
          </div>
        )}
        {entries.map((entry, i) => (
          <TranscriptBubble
            key={`${entry.timestamp}-${i}`}
            text={entry.text}
            timestamp={entry.timestamp}
            isLocal={entry.isLocal}
            isPartial={false}
            variant="chat"
            speaker={
              entry.isLocal
                ? (displayName ?? "You")
                : (peerDisplayName ?? "Peer")
            }
          />
        ))}
        {partials.map((entry, i) => (
          <TranscriptBubble
            key={`partial-${i}`}
            text={entry.text}
            timestamp={entry.timestamp}
            isLocal={entry.isLocal}
            isPartial={true}
            variant="chat"
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
