import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/stores/session-store";
import { useDocumentStore } from "@/stores/document-store";
import { useCallTimer } from "@/hooks/use-call-timer";
import { ChevronDown, Volume2, VolumeOff, FileCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function TopBar() {
  const peerDisplayName = useSessionStore((s) => s.peerDisplayName);
  const peerUserId = useSessionStore((s) => s.peerUserId);
  const audioRelay = useSessionStore((s) => s.audioRelay);
  const toggleAudioRelay = useSessionStore((s) => s.toggleAudioRelay);
  const toggleExpanded = useSessionStore((s) => s.toggleExpanded);

  const hasDoc = useDocumentStore((s) => s.currentDocument !== null);
  const showBottomSheet = useDocumentStore((s) => s.showBottomSheet);

  const timerRunning = peerUserId !== null;
  const timerText = useCallTimer(timerRunning);

  const connected = peerUserId !== null;

  return (
    <div className="flex items-center border-b border-separator bg-surface-secondary px-5 py-3">
      {/* Left: status dot + peer name */}
      <div className="flex flex-1 items-center gap-3">
        <div
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            connected ? "bg-accent-green" : "animate-pulse bg-accent-orange",
          )}
        />
        <span className="font-semibold text-text-primary">
          {peerDisplayName ?? "Waiting for partner..."}
        </span>
      </div>

      {/* Center: timer */}
      <div className="flex-1 text-center">
        <span className="text-xl tabular-nums tracking-wide text-text-secondary">
          {timerText}
        </span>
      </div>

      {/* Right: audio toggle + contract + details */}
      <div className="flex flex-1 items-center justify-end gap-2">
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
        {hasDoc && (
          <Button
            variant="outline"
            size="icon"
            className="border-accent-green text-accent-green"
            onClick={showBottomSheet}
            title="View contract"
          >
            <FileCheck className="size-4" />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="border-separator text-text-secondary"
          onClick={toggleExpanded}
        >
          Details
          <ChevronDown className="ml-1 size-3" />
        </Button>
      </div>
    </div>
  );
}
