import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DocumentOverlay } from "@/components/session/DocumentOverlay";
import { VerificationModal } from "@/components/contracts/VerificationModal";
import { CriterionCheckbox } from "@/components/contracts/CriterionCheckbox";
import { useSessionStore } from "@/stores/session-store";
import { useVerificationStore } from "@/stores/verification-store";
import { loadContracts, clearContracts } from "@/hooks/use-profile";
import type { LegalDocument, Milestone } from "@/stores/document-store";
import { cn, currencySymbol, formatTime } from "@/lib/utils";
import { MILESTONE_STATUS } from "@/lib/milestone-config";
import { LineItemRow } from "@/components/contracts/LineItemRow";
import {
  ArrowLeft,
  FileText,
  ChevronDown,
  ChevronRight,
  Trash2,
  Clock,
  Shield,
} from "lucide-react";

interface SavedContract extends LegalDocument {
  conversationHistory?: { speaker: string; text: string; timestamp: number }[];
}

export function ContractsScreen() {
  const backToSetup = useSessionStore((s) => s.backToSetup);
  const [viewDoc, setViewDoc] = useState<SavedContract | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  const [contractList, setContractList] = useState<SavedContract[]>(
    () => loadContracts() as SavedContract[],
  );

  const handleClearAll = useCallback(() => {
    clearContracts();
    setContractList([]);
    setViewDoc(null);
    setExpandedHistory(null);
  }, []);

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
        <div className="flex flex-1 items-center gap-2">
          <h1 className="text-xl font-bold text-text-primary">My Contracts</h1>
          {contractList.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-accent-blue/10 px-2 py-0.5 text-xs font-medium text-accent-blue">
              {contractList.length}
            </span>
          )}
        </div>
        {contractList.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="border-accent-red/30 text-accent-red hover:bg-accent-red/10"
            onClick={handleClearAll}
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Clear All
          </Button>
        )}
      </header>

      {/* Content */}
      <ScrollArea className="flex-1 p-6">
        {contractList.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {contractList.map((contract) => (
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
  const date = new Date(contract.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const parties = contract.parties.map((p) => p.name).join(" & ");
  const hasHistory =
    contract.conversationHistory && contract.conversationHistory.length > 0;
  const isFullySigned = contract.status === "fully_signed";

  return (
    <div
      className={cn(
        "rounded-xl border bg-surface-secondary p-5",
        isFullySigned
          ? "border-l-[3px] border-accent-green/30 border-l-accent-green"
          : "border-separator",
      )}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                isFullySigned
                  ? "bg-accent-green/10 text-accent-green"
                  : "bg-accent-orange/10 text-accent-orange",
              )}
            >
              {isFullySigned ? "Signed" : "Pending"}
            </span>
            <span className="text-xs text-text-tertiary">{date}</span>
          </div>
          <h3 className="mt-1 text-base font-semibold text-text-primary">
            {contract.terms.summary || contract.title}
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary">{parties}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-text-tertiary">Total</p>
          <span className="text-lg font-bold text-text-primary">
            {currency}
            {total}
          </span>
        </div>
      </div>

      {/* Line items summary */}
      {contract.terms.lineItems.length > 0 && (
        <div className="mt-3 space-y-1">
          {contract.terms.lineItems.map((li, i) => (
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
      )}

      {/* Factor summary */}
      {contract.terms.factorSummary && (
        <p className="mt-3 rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-3 py-2 text-xs leading-relaxed text-text-secondary">
          {contract.terms.factorSummary}
        </p>
      )}

      {/* Milestones */}
      {contract.milestones && contract.milestones.length > 0 && (
        <CardMilestonesBlock
          milestones={contract.milestones}
          currency={currency}
          contractId={contract.id}
          onVerify={onVerify}
        />
      )}

      {/* Actions row */}
      <div className="mt-4 flex items-center gap-3 border-t border-separator pt-4">
        <Button
          variant="outline"
          size="sm"
          className="border-separator text-text-secondary"
          onClick={onViewDoc}
        >
          <FileText className="mr-1.5 size-3.5" />
          View Contract
        </Button>
        {hasHistory && (
          <Button
            variant="outline"
            size="sm"
            className="border-separator text-text-secondary"
            aria-expanded={historyExpanded}
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
        <div className="mt-3 max-h-60 space-y-2 overflow-y-auto rounded-lg border border-separator bg-surface-primary p-3">
          {contract.conversationHistory!.map((entry, i) => {
            const speakerIndex = contract.parties.findIndex(
              (p) => p.userId === entry.speaker || p.name === entry.speaker,
            );
            const speakerColor =
              speakerIndex === 0
                ? "text-accent-blue"
                : speakerIndex === 1
                  ? "text-accent-green"
                  : "text-accent-orange";

            return (
              <div key={i} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span className={cn("font-semibold", speakerColor)}>
                    {entry.speaker}
                  </span>
                  <span className="text-text-tertiary">
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
                <p className="mt-0.5 text-text-secondary">{entry.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CardMilestonesBlock({
  milestones,
  currency,
  contractId,
  onVerify,
}: {
  milestones: Milestone[];
  currency: string;
  contractId: string;
  onVerify: (documentId: string, milestoneId: string) => void;
}) {
  const completedCount = milestones.filter(
    (m) => m.status === "completed",
  ).length;
  const totalCount = milestones.length;

  return (
    <div className="mt-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
          Milestones
        </p>
        <span className="text-[11px] text-text-tertiary">
          {completedCount}/{totalCount} complete
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1 overflow-hidden rounded-full bg-separator">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700 ease-out",
            completedCount === totalCount
              ? "bg-accent-green"
              : "bg-gradient-to-r from-accent-green to-accent-blue",
          )}
          style={{
            width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
          }}
        />
      </div>
      {milestones.map((ms) => {
        const status = MILESTONE_STATUS[ms.status] ?? MILESTONE_STATUS.pending;
        const StatusIcon = status.icon;

        return (
          <div
            key={ms.id}
            className={cn(
              "rounded-lg border p-3 transition-colors",
              ms.status === "completed"
                ? "border-accent-green/20 bg-accent-green/5"
                : ms.status === "failed"
                  ? "border-accent-red/20 bg-accent-red/5"
                  : ms.status === "disputed"
                    ? "border-accent-orange/20 bg-accent-orange/5"
                    : "border-separator bg-surface-tertiary",
            )}
          >
            {/* Milestone header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <StatusIcon
                  className={cn("mt-0.5 size-4 shrink-0", status.color)}
                />
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {ms.description}
                  </p>
                  {ms.expectedTimeline && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary">
                      <Clock className="size-3" />
                      {ms.expectedTimeline}
                    </span>
                  )}
                </div>
              </div>
              <span className={cn("text-sm font-semibold", status.color)}>
                {currency}
                {(ms.amount / 100).toFixed(2)}
              </span>
            </div>

            {/* Completion criteria checkboxes */}
            {ms.completionCriteria && ms.completionCriteria.length > 0 && (
              <div className="mt-2 space-y-1 pl-6">
                {ms.completionCriteria.map((c, i) => (
                  <CriterionCheckbox
                    key={i}
                    label={c}
                    checked={ms.status === "completed"}
                    size="sm"
                  />
                ))}
              </div>
            )}

            {/* Fallback: plain condition as checkbox */}
            {(!ms.completionCriteria || ms.completionCriteria.length === 0) &&
              ms.condition && (
                <div className="mt-2 pl-6">
                  <CriterionCheckbox
                    label={ms.condition}
                    checked={ms.status === "completed"}
                    size="sm"
                  />
                </div>
              )}

            {/* Verification method */}
            {ms.verificationMethod && (
              <div className="mt-2 flex items-center gap-1.5 pl-6">
                <Shield className="size-3 text-text-tertiary" />
                <span className="text-[10px] text-text-tertiary">
                  {ms.verificationMethod}
                </span>
              </div>
            )}

            {/* Verification result (compact) */}
            {ms.verificationResult && (
              <div
                className={cn(
                  "ml-6 mt-2 rounded border px-2 py-1.5 text-[11px]",
                  ms.verificationResult.outcome === "passed"
                    ? "border-accent-green/30 bg-accent-green/5 text-accent-green"
                    : ms.verificationResult.outcome === "failed"
                      ? "border-accent-red/30 bg-accent-red/5 text-accent-red"
                      : "border-accent-orange/30 bg-accent-orange/5 text-accent-orange",
                )}
              >
                <span className="font-bold uppercase">
                  {ms.verificationResult.outcome}
                </span>
                {ms.verificationResult.verifiedAmount !== undefined && (
                  <span className="ml-2 text-text-secondary">
                    {currency}
                    {(ms.verificationResult.verifiedAmount / 100).toFixed(2)}
                  </span>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-2 flex items-center justify-between pl-6">
              {ms.status === "pending" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10"
                  onClick={() => onVerify(contractId, ms.id)}
                >
                  <Shield className="mr-1 size-3" />
                  Verify
                </Button>
              )}
              {ms.status !== "pending" && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                    status.bg,
                    status.color,
                  )}
                >
                  {status.label}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
