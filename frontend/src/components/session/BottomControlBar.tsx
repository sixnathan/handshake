import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/stores/session-store";
import { useDocumentStore } from "@/stores/document-store";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeOff,
  FileCheck,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function BottomControlBar() {
  const micMuted = useSessionStore((s) => s.micMuted);
  const toggleMicMute = useSessionStore((s) => s.toggleMicMute);
  const audioRelay = useSessionStore((s) => s.audioRelay);
  const toggleAudioRelay = useSessionStore((s) => s.toggleAudioRelay);
  const sessionStatus = useSessionStore((s) => s.sessionStatus);
  const reset = useSessionStore((s) => s.reset);

  const hasDoc = useDocumentStore((s) => s.currentDocument !== null);
  const showBottomSheet = useDocumentStore((s) => s.showBottomSheet);

  return (
    <div className="flex items-center justify-between border-t border-separator bg-surface-secondary px-4 py-3 md:hidden">
      {/* Left: mic toggle */}
      <Button
        variant="outline"
        size="icon"
        className={cn(
          "size-10 rounded-full border-separator",
          micMuted
            ? "border-accent-red text-accent-red"
            : "text-text-secondary",
        )}
        onClick={toggleMicMute}
      >
        {micMuted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
      </Button>

      {/* Center: status */}
      <div className="flex items-center gap-2">
        <span className="size-2 animate-pulse rounded-full bg-accent-blue" />
        <span className="text-xs text-text-tertiary">{sessionStatus}</span>
      </div>

      {/* Right: speaker + contract */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "size-10 rounded-full border-separator",
            audioRelay
              ? "border-accent-green text-accent-green"
              : "text-text-secondary",
          )}
          onClick={toggleAudioRelay}
        >
          {audioRelay ? (
            <Volume2 className="size-5" />
          ) : (
            <VolumeOff className="size-5" />
          )}
        </Button>
        {hasDoc && (
          <Button
            variant="outline"
            size="icon"
            className="size-10 rounded-full border-accent-green text-accent-green"
            onClick={showBottomSheet}
          >
            <FileCheck className="size-5" />
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="size-10 rounded-full border-accent-red/30 text-accent-red"
          onClick={reset}
        >
          <LogOut className="size-5" />
        </Button>
      </div>
    </div>
  );
}
