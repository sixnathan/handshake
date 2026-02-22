import { useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDocumentStore, type LegalDocument } from "@/stores/document-store";
import { useSessionStore } from "@/stores/session-store";
import { ContractView } from "@/components/contracts/ContractView";

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

  const doc = externalDoc ?? storeDoc;

  // Reset optimistic signing state when document changes
  const docId = doc?.id;
  useEffect(() => {
    signedRef.current = false;
  }, [docId]);

  const isOpen = externalDoc ? true : overlayVisible;
  const handleOpenChange = externalDoc ? () => onClose?.() : hideOverlay;

  // For external docs, build milestones from the doc itself
  const milestones = externalDoc
    ? new Map((externalDoc.milestones ?? []).map((ms) => [ms.id, ms]))
    : storeMilestones;

  if (!doc) return null;

  const alreadySigned =
    signedRef.current || doc.signatures.some((s) => s.userId === userId);

  function handleSign() {
    if (!panelWs.current || !doc || !userId) return;
    panelWs.current.send(
      JSON.stringify({ type: "sign_document", documentId: doc.id }),
    );
    signedRef.current = true;
    addSignature(userId);
  }

  function handleConfirmMilestone(milestoneId: string) {
    if (!panelWs.current || !doc) return;
    panelWs.current.send(
      JSON.stringify({
        type: "confirm_milestone",
        milestoneId,
        documentId: doc.id,
      }),
    );
  }

  function handleProposeMilestoneAmount(milestoneId: string, amount: number) {
    if (!panelWs.current || !doc) return;
    panelWs.current.send(
      JSON.stringify({
        type: "propose_milestone_amount",
        milestoneId,
        documentId: doc.id,
        amount,
      }),
    );
  }

  function handleApproveMilestoneAmount(milestoneId: string) {
    if (!panelWs.current || !doc) return;
    panelWs.current.send(
      JSON.stringify({
        type: "approve_milestone_amount",
        milestoneId,
        documentId: doc.id,
      }),
    );
  }

  function handleReleaseEscrow(milestoneId: string) {
    if (!panelWs.current || !doc) return;
    panelWs.current.send(
      JSON.stringify({
        type: "release_escrow",
        milestoneId,
        documentId: doc.id,
      }),
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-[700px] overflow-hidden border-separator bg-surface-secondary p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Contract Details</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-20px)] px-6 py-6">
          <ContractView
            doc={doc}
            milestones={milestones}
            readOnly={readOnly}
            userId={userId ?? undefined}
            providerId={doc.providerId}
            clientId={doc.clientId}
            onSign={handleSign}
            onConfirmMilestone={handleConfirmMilestone}
            onProposeMilestoneAmount={handleProposeMilestoneAmount}
            onApproveMilestoneAmount={handleApproveMilestoneAmount}
            onReleaseEscrow={handleReleaseEscrow}
            alreadySigned={alreadySigned}
          />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
