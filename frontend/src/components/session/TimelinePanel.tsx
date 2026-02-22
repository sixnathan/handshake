import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TimelineNodeItem } from "./TimelineNode";
import { useTimelineStore } from "@/stores/timeline-store";

export function TimelinePanel() {
  const nodes = useTimelineStore((s) => s.nodes);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [nodes.length]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-separator bg-surface-primary px-3 py-2.5 text-sm font-medium uppercase tracking-wider text-text-primary">
        Agent Timeline
      </div>
      <ScrollArea className="flex-1 bg-surface-tertiary">
        <div className="relative p-4 pl-8">
          {/* Vertical line */}
          <div className="absolute bottom-0 left-[22px] top-0 w-0.5 bg-separator" />
          {nodes.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12">
              <div className="flex items-center gap-1.5">
                <span className="size-2 animate-pulse rounded-full bg-accent-blue" />
                <span className="size-2 animate-pulse rounded-full bg-accent-blue [animation-delay:200ms]" />
                <span className="size-2 animate-pulse rounded-full bg-accent-blue [animation-delay:400ms]" />
              </div>
              <p className="text-sm text-text-tertiary">
                Listening for agreement...
              </p>
            </div>
          )}
          {nodes.map((node, i) => (
            <TimelineNodeItem
              key={`${node.timestamp}-${i}`}
              type={node.type}
              text={node.text}
              timestamp={node.timestamp}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
