import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/stores/session-store";
import { TranscriptColumn } from "./TranscriptColumn";
import { TimelinePanel } from "./TimelinePanel";
import { X, Mic, MicOff, Volume2, VolumeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function ExpandedView() {
  const expandedView = useSessionStore((s) => s.expandedView);
  const setExpanded = useSessionStore((s) => s.setExpanded);
  const peerDisplayName = useSessionStore((s) => s.peerDisplayName);
  const displayName = useSessionStore((s) => s.displayName);
  const micMuted = useSessionStore((s) => s.micMuted);
  const toggleMicMute = useSessionStore((s) => s.toggleMicMute);
  const audioRelay = useSessionStore((s) => s.audioRelay);
  const toggleAudioRelay = useSessionStore((s) => s.toggleAudioRelay);

  if (!expandedView) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-secondary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-separator bg-surface-primary px-5 py-4">
        <h2 className="text-base font-semibold text-text-primary">
          Session Details
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "border-separator",
              micMuted
                ? "border-accent-red text-accent-red"
                : "text-text-secondary",
            )}
            onClick={toggleMicMute}
            title={micMuted ? "Microphone is muted" : "Microphone is on"}
          >
            {micMuted ? (
              <MicOff className="size-4" />
            ) : (
              <Mic className="size-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "border-separator",
              audioRelay
                ? "border-accent-green text-accent-green"
                : "text-text-secondary",
            )}
            onClick={toggleAudioRelay}
            title={
              audioRelay
                ? "Audio from peer is playing"
                : "Audio from peer is muted"
            }
          >
            {audioRelay ? (
              <Volume2 className="size-4" />
            ) : (
              <VolumeOff className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExpanded(false)}
            className="text-text-secondary"
          >
            <X className="size-5" />
          </Button>
        </div>
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
