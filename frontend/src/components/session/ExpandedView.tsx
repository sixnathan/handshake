import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/stores/session-store";
import { TranscriptColumn } from "./TranscriptColumn";
import { TimelinePanel } from "./TimelinePanel";
import { X } from "lucide-react";

export function ExpandedView() {
  const expandedView = useSessionStore((s) => s.expandedView);
  const setExpanded = useSessionStore((s) => s.setExpanded);
  const peerDisplayName = useSessionStore((s) => s.peerDisplayName);
  const displayName = useSessionStore((s) => s.displayName);

  if (!expandedView) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-secondary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-separator bg-surface-primary px-5 py-4">
        <h2 className="text-base font-semibold text-text-primary">
          Session Details
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setExpanded(false)}
          className="text-text-secondary"
        >
          <X className="size-5" />
        </Button>
      </div>

      {/* Body: transcript columns + timeline */}
      <div className="flex flex-1 overflow-hidden max-md:flex-col">
        {/* Dual transcript — peer LEFT, local RIGHT */}
        <div className="flex flex-1 overflow-hidden border-r border-separator max-md:h-1/2 max-md:border-b max-md:border-r-0">
          <TranscriptColumn label={peerDisplayName ?? "Peer"} isLocal={false} />
          <div className="w-px shrink-0 bg-separator" />
          <TranscriptColumn label={displayName ?? "You"} isLocal={true} />
        </div>

        {/* Timeline */}
        <div className="flex flex-1 overflow-hidden max-md:h-1/2">
          <TimelinePanel />
        </div>
      </div>
    </div>
  );
}
