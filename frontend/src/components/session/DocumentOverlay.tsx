import { useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useDocumentStore,
  type LegalDocument,
  type Milestone,
} from "@/stores/document-store";
import { useSessionStore } from "@/stores/session-store";
import { useVerificationStore } from "@/stores/verification-store";
import { markdownToHtml, cn } from "@/lib/utils";

interface DocumentOverlayProps {
  panelWs: React.RefObject<WebSocket | null>;
  readOnly?: boolean;
  externalDoc?: LegalDocument;
  onClose?: () => void;
}

export function DocumentOverlay({
  panelWs,
  readOnly = false,
  externalDoc,
  onClose,
}: DocumentOverlayProps) {
  const storeDoc = useDocumentStore((s) => s.currentDocument);
  const overlayVisible = useDocumentStore((s) => s.overlayVisible);
  const hideOverlay = useDocumentStore((s) => s.hideOverlay);
  const addSignature = useDocumentStore((s) => s.addSignature);
  const storeMilestones = useDocumentStore((s) => s.milestones);
  const userId = useSessionStore((s) => s.userId);
  const signedRef = useRef(false);
  const openVerification = useVerificationStore((s) => s.openModal);

  const doc = externalDoc ?? storeDoc;
  const isOpen = externalDoc ? true : overlayVisible;
  const handleOpenChange = externalDoc ? () => onClose?.() : hideOverlay;

  // For external docs, build milestones from the doc itself
  const milestones = externalDoc
    ? new Map((externalDoc.milestones ?? []).map((ms) => [ms.id, ms]))
    : storeMilestones;

  if (!doc) return null;

  const alreadySigned =
    signedRef.current || doc.signatures.some((s) => s.userId === userId);
  const sigCount = doc.signatures.length;
  const totalParties = doc.parties.length;
  const isFullySigned = doc.status === "fully_signed";

  function handleSign() {
    if (!panelWs.current || !doc || !userId) return;
    panelWs.current.send(
      JSON.stringify({ type: "sign_document", documentId: doc.id }),
    );
    signedRef.current = true;
    addSignature(userId);
  }

  function handleCompleteMilestone(milestoneId: string) {
    if (!panelWs.current || !doc) return;
    panelWs.current.send(
      JSON.stringify({
        type: "complete_milestone",
        milestoneId,
        documentId: doc.id,
      }),
    );
  }

  function handleVerifyMilestone(milestoneId: string) {
    openVerification(doc!.id, milestoneId);
  }

  const statusDot = (status: Milestone["status"]) => {
    const map: Record<Milestone["status"], string> = {
      pending: "bg-accent-orange",
      verifying: "bg-accent-blue animate-pulse",
      completed: "bg-accent-green",
      failed: "bg-accent-red",
      disputed: "bg-accent-purple",
    };
    return map[status] ?? "bg-accent-orange";
  };

  const statusText = (status: Milestone["status"]) => {
    const map: Record<Milestone["status"], string> = {
      pending: "text-accent-orange",
      verifying: "text-accent-blue",
      completed: "text-accent-green",
      failed: "text-accent-red",
      disputed: "text-accent-purple",
    };
    return map[status] ?? "text-accent-orange";
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-[700px] overflow-hidden border-separator bg-surface-secondary p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-accent-blue">{doc.title}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(80vh-120px)] px-6 pb-6">
          {/* Document content */}
          <div
            className="prose prose-sm max-w-none text-text-primary [&_h1]:text-text-primary [&_h2]:text-text-primary [&_h3]:text-text-primary [&_strong]:text-text-primary [&_ul]:ml-5 [&_ol]:ml-5"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(doc.content) }}
          />

          {/* Signature status */}
          <p
            className={cn(
              "mt-4 text-sm",
              isFullySigned ? "text-accent-green" : "text-accent-orange",
            )}
          >
            Signatures: {sigCount}/{totalParties}
            {isFullySigned && " \u2014 Agreement Complete!"}
          </p>

          {/* Sign button (hidden in read-only mode) */}
          {!readOnly && (
            <Button
              className="mt-3 bg-accent-green text-white hover:bg-accent-green/90"
              disabled={alreadySigned || isFullySigned}
              onClick={handleSign}
            >
              {alreadySigned ? "Signed \u2713" : "Sign Agreement"}
            </Button>
          )}

          {/* Milestones */}
          {milestones.size > 0 && (
            <div className="mt-6 border-t border-separator pt-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Milestones
              </h3>
              {[...milestones.values()].map((ms) => (
                <div
                  key={ms.id}
                  className="mb-2 flex items-center gap-3 rounded-lg border border-separator bg-surface-tertiary p-3"
                >
                  <div
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      statusDot(ms.status),
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary">
                      {ms.description}
                    </p>
                    <p className="text-xs text-text-tertiary">{ms.condition}</p>
                  </div>
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      statusText(ms.status),
                    )}
                  >
                    {"\u00A3"}
                    {(ms.amount / 100).toFixed(2)}
                  </span>
                  {ms.status === "pending" && !readOnly && (
                    <Button
                      size="sm"
                      className="bg-accent-green text-white hover:bg-accent-green/90"
                      onClick={() => handleCompleteMilestone(ms.id)}
                    >
                      Complete
                    </Button>
                  )}
                  {ms.status === "pending" && readOnly && (
                    <Button
                      size="sm"
                      className="bg-accent-blue text-white hover:bg-accent-blue/90"
                      onClick={() => handleVerifyMilestone(ms.id)}
                    >
                      Verify
                    </Button>
                  )}
                  {ms.status !== "pending" && (
                    <span
                      className={cn(
                        "text-xs font-medium",
                        statusText(ms.status),
                      )}
                    >
                      {ms.status === "completed" && "\u2713 Done"}
                      {ms.status === "verifying" && "Verifying..."}
                      {ms.status === "failed" && "\u2717 Failed"}
                      {ms.status === "disputed" && "Disputed"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
