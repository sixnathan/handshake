import { useState } from "react";
import { TopBar } from "@/components/session/TopBar";
import { PulseRing } from "@/components/session/PulseRing";
import { ExpandedView } from "@/components/session/ExpandedView";
import { BottomSheet } from "@/components/session/BottomSheet";
import { DocumentOverlay } from "@/components/session/DocumentOverlay";
import { UnifiedTranscript } from "@/components/session/UnifiedTranscript";
import { TimelinePanel } from "@/components/session/TimelinePanel";
import { BottomControlBar } from "@/components/session/BottomControlBar";
import { usePanelWebSocket } from "@/hooks/use-websocket";
import { useAudioWebSocket } from "@/hooks/use-audio";
import { cn } from "@/lib/utils";

type MobileTab = "chat" | "agent";

export function SessionScreen() {
  const panelWs = usePanelWebSocket();
  useAudioWebSocket();
  const [activeTab, setActiveTab] = useState<MobileTab>("chat");

  return (
    <div className="flex h-screen flex-col">
      <TopBar />

      {/* Mobile tab bar */}
      <div className="flex border-b border-separator bg-surface-secondary md:hidden">
        <button
          className={cn(
            "flex-1 py-2.5 text-center text-sm font-medium tracking-wide transition-colors",
            activeTab === "chat"
              ? "border-b-2 border-accent-blue text-accent-blue"
              : "text-text-tertiary",
          )}
          onClick={() => setActiveTab("chat")}
        >
          Chat
        </button>
        <button
          className={cn(
            "flex-1 py-2.5 text-center text-sm font-medium tracking-wide transition-colors",
            activeTab === "agent"
              ? "border-b-2 border-accent-orange text-accent-orange"
              : "text-text-tertiary",
          )}
          onClick={() => setActiveTab("agent")}
        >
          Agent
        </button>
      </div>

      {/* Mobile content area */}
      <div className="flex flex-1 flex-col overflow-hidden md:hidden">
        {activeTab === "chat" ? <UnifiedTranscript /> : <TimelinePanel />}
      </div>

      {/* Desktop: PulseRing (hidden on mobile via PulseRing component) */}
      <PulseRing />

      <ExpandedView />
      <BottomSheet panelWs={panelWs} />
      <DocumentOverlay panelWs={panelWs} />

      {/* Mobile bottom control bar */}
      <BottomControlBar />
    </div>
  );
}
