import { TopBar } from "@/components/session/TopBar";
import { PulseRing } from "@/components/session/PulseRing";
import { ExpandedView } from "@/components/session/ExpandedView";
import { BottomSheet } from "@/components/session/BottomSheet";
import { DocumentOverlay } from "@/components/session/DocumentOverlay";
import { usePanelWebSocket } from "@/hooks/use-websocket";
import { useAudioWebSocket } from "@/hooks/use-audio";

export function SessionScreen() {
  const panelWs = usePanelWebSocket();
  useAudioWebSocket();

  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <PulseRing />
      <ExpandedView />
      <BottomSheet panelWs={panelWs} />
      <DocumentOverlay panelWs={panelWs} />
    </div>
  );
}
