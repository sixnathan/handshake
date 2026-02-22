import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { useDocumentStore } from "@/stores/document-store";
import { useSessionStore } from "@/stores/session-store";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  panelWs: React.RefObject<WebSocket | null>;
}

export function BottomSheet({ panelWs }: BottomSheetProps) {
  const doc = useDocumentStore((s) => s.currentDocument);
  const visible = useDocumentStore((s) => s.bottomSheetVisible);
  const hideBottomSheet = useDocumentStore((s) => s.hideBottomSheet);
  const showOverlay = useDocumentStore((s) => s.showOverlay);
  const addSignature = useDocumentStore((s) => s.addSignature);
  const milestones = useDocumentStore((s) => s.milestones);
  const userId = useSessionStore((s) => s.userId);
  const signedRef = useRef(false);

  if (!doc) return null;

  const alreadySigned =
    signedRef.current || doc.signatures.some((s) => s.userId === userId);
  const sigCount = doc.signatures.length;
  const totalParties = doc.parties.length;
  const isFullySigned = doc.status === "fully_signed";

  const pendingMilestones = [...milestones.values()].filter(
    (m) => m.status === "pending",
  ).length;

  function handleSign() {
    if (!panelWs.current || !doc || !userId) return;
    panelWs.current.send(
      JSON.stringify({ type: "sign_document", documentId: doc.id }),
    );
    signedRef.current = true;
    addSignature(userId);
  }

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-[80] max-h-[50vh] overflow-y-auto rounded-t-2xl border-t border-separator bg-surface-secondary transition-transform duration-300",
        visible ? "translate-y-0" : "translate-y-full",
      )}
    >
      {/* Handle bar */}
      <button
        className="flex w-full justify-center py-3"
        onClick={hideBottomSheet}
      >
        <div className="h-1 w-10 rounded-full bg-gray-3" />
      </button>

      <div className="px-5 pb-6">
        <h3 className="mb-2 text-lg font-bold text-text-primary">
          {doc.title}
        </h3>
        <p className="mb-2 text-sm leading-relaxed text-text-secondary">
          {doc.content.length > 200
            ? doc.content.slice(0, 200) + "..."
            : doc.content}
        </p>

        {/* Signature status */}
        <p
          className={cn(
            "mb-1 text-xs",
            isFullySigned ? "text-accent-green" : "text-accent-orange",
          )}
        >
          Signatures: {sigCount}/{totalParties}
          {isFullySigned && " \u2014 Complete!"}
        </p>

        {/* Milestone count */}
        {milestones.size > 0 && (
          <p
            className={cn(
              "mb-4 text-xs",
              pendingMilestones === 0
                ? "text-accent-green"
                : "text-text-secondary",
            )}
          >
            {pendingMilestones > 0
              ? `Milestones: ${pendingMilestones} pending`
              : "All milestones complete!"}
          </p>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <Button
            className="flex-1 bg-accent-green text-white hover:bg-accent-green/90"
            disabled={alreadySigned || isFullySigned}
            onClick={handleSign}
          >
            {alreadySigned ? "Signed \u2713" : "Sign Agreement"}
          </Button>
          <Button
            variant="outline"
            className="border-separator text-text-secondary"
            onClick={showOverlay}
          >
            View Full
          </Button>
        </div>
      </div>
    </div>
  );
}
