import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useVerificationStore,
  type VerificationStep,
} from "@/stores/verification-store";
import { cn, currencySymbol } from "@/lib/utils";
import { OUTCOME_CONFIG } from "@/lib/milestone-config";
import { useDocumentStore } from "@/stores/document-store";

interface VerificationModalProps {
  panelWs: React.RefObject<WebSocket | null> | null;
}

export function VerificationModal({ panelWs }: VerificationModalProps) {
  const modalVisible = useVerificationStore((s) => s.modalVisible);
  const documentId = useVerificationStore((s) => s.documentId);
  const milestoneId = useVerificationStore((s) => s.milestoneId);
  const steps = useVerificationStore((s) => s.steps);
  const result = useVerificationStore((s) => s.result);
  const error = useVerificationStore((s) => s.error);
  const closeModal = useVerificationStore((s) => s.closeModal);
  const currentDoc = useDocumentStore((s) => s.currentDocument);
  const currency = currencySymbol(currentDoc?.terms.currency ?? "gbp");

  const [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [started, setStarted] = useState(false);

  const isConnected = panelWs?.current?.readyState === WebSocket.OPEN;

  function handleStart() {
    if (!panelWs?.current || !documentId || !milestoneId) return;

    panelWs.current.send(
      JSON.stringify({
        type: "verify_milestone",
        documentId,
        milestoneId,
        phone: phone.trim() || undefined,
        contactName: contactName.trim() || undefined,
      }),
    );
    setStarted(true);
  }

  function handleClose() {
    closeModal();
    setPhone("");
    setContactName("");
    setStarted(false);
  }

  return (
    <Dialog open={modalVisible} onOpenChange={handleClose}>
      <DialogContent className="max-h-[80vh] max-w-[500px] overflow-hidden border-separator bg-surface-secondary p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-accent-blue">
            Verify Milestone
          </DialogTitle>
          <DialogDescription className="text-text-secondary">
            Verify completion of this milestone to release payment
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(80vh-100px)] px-6 pb-6">
          {!isConnected && !result && (
            <div className="mb-4 rounded-lg border border-accent-orange/30 bg-accent-orange/10 p-3">
              <p className="text-sm text-accent-orange">
                Not connected to a room. Join a room first to verify milestones.
              </p>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-accent-red/30 bg-accent-red/10 p-3">
              <p className="text-sm text-accent-red">{error}</p>
            </div>
          )}

          {!started && !result && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Contact Phone (optional)
                </label>
                <Input
                  placeholder="+44 7700 900000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="border-separator bg-surface-tertiary text-text-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Contact Name (optional)
                </label>
                <Input
                  placeholder="Name of verifying party"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="border-separator bg-surface-tertiary text-text-primary"
                />
              </div>
              <Button
                className="w-full bg-accent-blue text-white hover:bg-accent-blue/90"
                disabled={!isConnected}
                onClick={handleStart}
              >
                Start Verification
              </Button>
            </div>
          )}

          {started && !result && (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                Verification in progress...
              </p>
              {steps.map((step, i) => (
                <StepRow key={i} step={step} />
              ))}
              <div className="flex items-center gap-2 pt-2">
                <span className="size-2 animate-pulse rounded-full bg-accent-blue" />
                <span className="size-2 animate-pulse rounded-full bg-accent-blue [animation-delay:150ms]" />
                <span className="size-2 animate-pulse rounded-full bg-accent-blue [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {result && <ResultDisplay result={result} currency={currency} />}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function StepRow({ step }: { step: VerificationStep }) {
  const colorClass =
    step.status === "completed"
      ? "bg-accent-green"
      : step.status === "failed"
        ? "bg-accent-red"
        : "bg-accent-blue animate-pulse";

  return (
    <div className="flex items-center gap-3">
      <div className={cn("size-2 shrink-0 rounded-full", colorClass)} />
      <span className="text-sm text-text-primary">{step.text}</span>
    </div>
  );
}

function ResultDisplay({
  result,
  currency,
}: {
  result: NonNullable<
    ReturnType<typeof useVerificationStore.getState>["result"]
  >;
  currency: string;
}) {
  const cfg = OUTCOME_CONFIG[result.outcome];

  return (
    <div className="space-y-4">
      <div className={cn("rounded-lg border p-4", cfg.bg, cfg.border)}>
        <p className={cn("text-lg font-bold", cfg.color)}>{cfg.label}</p>
        {result.verifiedAmount != null && (
          <p className="mt-1 text-sm text-text-secondary">
            Verified amount: {currency}
            {(result.verifiedAmount / 100).toFixed(2)}
          </p>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Reasoning
        </h4>
        <p className="text-sm text-text-primary">{result.reasoning}</p>
      </div>

      {result.evidence.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Evidence
          </h4>
          <ul className="space-y-1">
            {result.evidence.map((item, i) => (
              <li
                key={i}
                className="rounded border border-separator bg-surface-tertiary p-2 text-sm text-text-primary"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
