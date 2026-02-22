import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DocumentOverlay } from "@/components/session/DocumentOverlay";
import { VerificationModal } from "@/components/contracts/VerificationModal";
import { useSessionStore } from "@/stores/session-store";
import { useVerificationStore } from "@/stores/verification-store";
import { loadContracts } from "@/hooks/use-profile";
import type { LegalDocument, Milestone } from "@/stores/document-store";
import { cn, currencySymbol, formatTime } from "@/lib/utils";
import { ArrowLeft, FileText, ChevronDown, ChevronRight } from "lucide-react";

interface SavedContract extends LegalDocument {
  conversationHistory?: { speaker: string; text: string; timestamp: number }[];
}

const STATUS_CONFIG: Record<
  Milestone["status"],
  { label: string; dot: string; text: string }
> = {
  pending: {
    label: "Pending",
    dot: "bg-accent-orange",
    text: "text-accent-orange",
  },
  verifying: {
    label: "Verifying",
    dot: "bg-accent-blue animate-pulse",
    text: "text-accent-blue",
  },
  completed: {
    label: "Completed",
    dot: "bg-accent-green",
    text: "text-accent-green",
  },
  failed: { label: "Failed", dot: "bg-accent-red", text: "text-accent-red" },
  disputed: {
    label: "Disputed",
    dot: "bg-accent-purple",
    text: "text-accent-purple",
  },
};

export function ContractsScreen() {
  const backToSetup = useSessionStore((s) => s.backToSetup);
  const [viewDoc, setViewDoc] = useState<SavedContract | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  const contracts = useMemo(() => loadContracts() as SavedContract[], []);

  const openVerification = useVerificationStore((s) => s.openModal);

  const handleVerify = useCallback(
    (documentId: string, milestoneId: string) => {
      openVerification(documentId, milestoneId);
    },
    [openVerification],
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface-primary">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-separator px-6 py-4">
        <Button
          variant="outline"
          size="icon"
          className="border-separator text-text-secondary"
          onClick={backToSetup}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-xl font-bold text-text-primary">My Contracts</h1>
      </header>

      {/* Content */}
      <ScrollArea className="flex-1 p-6">
        {contracts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {contracts.map((contract) => (
              <ContractCard
                key={contract.id}
                contract={contract}
                onViewDoc={() => setViewDoc(contract)}
                onVerify={handleVerify}
                historyExpanded={expandedHistory === contract.id}
                onToggleHistory={() =>
                  setExpandedHistory((prev) =>
                    prev === contract.id ? null : contract.id,
                  )
                }
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Document overlay for viewing full document */}
      {viewDoc && (
        <DocumentOverlay
          panelWs={{ current: null }}
          readOnly
          externalDoc={viewDoc}
          onClose={() => setViewDoc(null)}
        />
      )}

      {/* Verification modal */}
      <VerificationModal panelWs={null} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <FileText className="mb-4 size-12 text-text-tertiary" />
      <p className="text-lg text-text-secondary">No contracts yet</p>
      <p className="mt-1 text-sm text-text-tertiary">
        Contracts will appear here after you complete a negotiation
      </p>
    </div>
  );
}

interface ContractCardProps {
  contract: SavedContract;
  onViewDoc: () => void;
  onVerify: (documentId: string, milestoneId: string) => void;
  historyExpanded: boolean;
  onToggleHistory: () => void;
}

function ContractCard({
  contract,
  onViewDoc,
  onVerify,
  historyExpanded,
  onToggleHistory,
}: ContractCardProps) {
  const currency = currencySymbol(contract.terms.currency);
  const total = (contract.terms.totalAmount / 100).toFixed(2);
  const date = new Date(contract.createdAt).toLocaleDateString();
  const parties = contract.parties.map((p) => p.name).join(" & ");
  const hasHistory =
    contract.conversationHistory && contract.conversationHistory.length > 0;

  return (
    <div className="rounded-xl border border-separator bg-surface-secondary p-5">
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-text-primary">
            {contract.title}
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary">
            {date} &middot; {parties}
          </p>
        </div>
        <span className="shrink-0 text-lg font-bold text-accent-green">
          {currency}
          {total}
        </span>
      </div>

      {/* Milestones */}
      {contract.milestones && contract.milestones.length > 0 && (
        <div className="mt-4 space-y-2">
          {contract.milestones.map((ms) => {
            const cfg = STATUS_CONFIG[ms.status] ?? STATUS_CONFIG.pending;
            return (
              <div
                key={ms.id}
                className="flex items-center gap-3 rounded-lg border border-separator bg-surface-tertiary p-3"
              >
                <div
                  className={cn("size-2.5 shrink-0 rounded-full", cfg.dot)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary">{ms.description}</p>
                  <p className="text-xs text-text-tertiary">{ms.condition}</p>
                </div>
                <span className={cn("text-sm font-semibold", cfg.text)}>
                  {currency}
                  {(ms.amount / 100).toFixed(2)}
                </span>
                {ms.status === "pending" && (
                  <Button
                    size="sm"
                    className="bg-accent-blue text-white hover:bg-accent-blue/90"
                    onClick={() => onVerify(contract.id, ms.id)}
                  >
                    Verify
                  </Button>
                )}
                {ms.status !== "pending" && (
                  <span className={cn("text-xs font-medium", cfg.text)}>
                    {cfg.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions row */}
      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="border-separator text-text-secondary"
          onClick={onViewDoc}
        >
          <FileText className="mr-1.5 size-3.5" />
          View Full Document
        </Button>
        {hasHistory && (
          <Button
            variant="outline"
            size="sm"
            className="border-separator text-text-secondary"
            onClick={onToggleHistory}
          >
            {historyExpanded ? (
              <ChevronDown className="mr-1.5 size-3.5" />
            ) : (
              <ChevronRight className="mr-1.5 size-3.5" />
            )}
            Conversation
          </Button>
        )}
      </div>

      {/* Conversation history (collapsible) */}
      {historyExpanded && hasHistory && (
        <div className="mt-3 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-separator bg-surface-primary p-3">
          {contract.conversationHistory!.map((entry, i) => (
            <div key={i} className="text-xs">
              <span className="font-medium text-accent-blue">
                {entry.speaker}
              </span>
              <span className="ml-1.5 text-text-tertiary">
                {formatTime(entry.timestamp)}
              </span>
              <p className="text-text-secondary">{entry.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
