import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useDocumentStore } from "@/stores/document-store";
import { useSessionStore } from "@/stores/session-store";
import { cn, currencySymbol } from "@/lib/utils";
import { LineItemRow } from "@/components/contracts/LineItemRow";
import { CheckCircle2, Circle, Shield } from "lucide-react";

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

  // Reset optimistic signing state when document changes
  const docId = doc?.id;
  useEffect(() => {
    signedRef.current = false;
  }, [docId]);

  if (!doc) return null;

  const currency = currencySymbol(doc.terms.currency);
  const alreadySigned =
    signedRef.current || doc.signatures.some((s) => s.userId === userId);
  const sigCount = doc.signatures.length;
  const totalParties = doc.parties.length;
  const isFullySigned = doc.status === "fully_signed";

  const milestonesArray = [...milestones.values()];
  const completedMs = milestonesArray.filter(
    (m) => m.status === "completed",
  ).length;
  const totalMs = milestonesArray.length;

  function handleSign() {
    if (!panelWs.current || !doc || !userId) return;
    panelWs.current.send(
      JSON.stringify({ type: "sign_document", documentId: doc.id }),
    );
    signedRef.current = true;
    addSignature(userId);
  }

  return (
    <>
      {/* Backdrop */}
      {visible && (
        <div
          className="fixed inset-0 z-[79] bg-black/30 transition-opacity duration-300"
          onClick={hideBottomSheet}
        />
      )}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-[80] max-h-[50vh] overflow-y-auto rounded-t-2xl border-t border-separator bg-surface-secondary shadow-2xl transition-transform duration-300",
          visible ? "translate-y-0" : "translate-y-full",
        )}
      >
        {/* Handle bar */}
        <button
          type="button"
          aria-label="Dismiss contract sheet"
          className="flex w-full flex-col items-center gap-1 py-3"
          onClick={hideBottomSheet}
        >
          <div className="h-1 w-10 rounded-full bg-gray-3" />
          <span
            className={cn(
              "text-[9px] font-medium uppercase tracking-widest",
              isFullySigned ? "text-accent-green" : "text-text-tertiary",
            )}
          >
            {isFullySigned ? "Agreement Active" : "Contract Ready"}
          </span>
        </button>

        <div className="px-5 pb-6">
          {/* Header */}
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold text-text-primary">
                {doc.terms.summary || doc.title}
              </h3>
              <p className="mt-0.5 text-xs text-text-tertiary">
                {doc.parties.map((p) => p.name).join(" & ")}
              </p>
            </div>
            <p className="text-lg font-bold text-text-primary">
              {currency}
              {(doc.terms.totalAmount / 100).toFixed(2)}
            </p>
          </div>

          {/* Line items compact list */}
          <div className="mb-3 space-y-1">
            {doc.terms.lineItems.map((li, i) => (
              <LineItemRow
                key={i}
                description={li.description}
                amount={li.amount}
                type={li.type}
                currency={currency}
                minAmount={li.minAmount}
                maxAmount={li.maxAmount}
              />
            ))}
          </div>

          {/* Status row */}
          <div className="mb-4 flex items-center gap-4">
            {/* Signatures */}
            <div className="flex items-center gap-1.5">
              {isFullySigned ? (
                <CheckCircle2 className="size-3.5 text-accent-green" />
              ) : (
                <Circle className="size-3.5 text-accent-orange" />
              )}
              <span
                className={cn(
                  "text-xs",
                  isFullySigned ? "text-accent-green" : "text-accent-orange",
                )}
              >
                {sigCount}/{totalParties} signed
              </span>
            </div>

            {/* Milestones */}
            {totalMs > 0 && (
              <div className="flex items-center gap-1.5">
                <Shield className="size-3.5 text-text-tertiary" />
                <span
                  className={cn(
                    "text-xs",
                    completedMs === totalMs
                      ? "text-accent-green"
                      : "text-text-secondary",
                  )}
                >
                  {completedMs}/{totalMs} milestones
                </span>
              </div>
            )}
          </div>

          {/* Signing progress bar */}
          {!isFullySigned && (
            <div className="mb-4 h-1 overflow-hidden rounded-full bg-separator">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent-green to-accent-blue transition-all duration-700 ease-out"
                style={{
                  width: `${totalParties > 0 ? (sigCount / totalParties) * 100 : 0}%`,
                }}
              />
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <Button
              className="flex-1 bg-accent-green text-white hover:bg-accent-green/90"
              disabled={alreadySigned || isFullySigned}
              onClick={handleSign}
            >
              {alreadySigned || isFullySigned
                ? "Signed \u2713"
                : "Sign Agreement"}
            </Button>
            <Button
              variant="outline"
              className="border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10"
              onClick={showOverlay}
            >
              View Contract
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
