import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  LegalDocument,
  Milestone,
  PaymentEvent,
} from "@/stores/document-store";
import { cn, currencySymbol } from "@/lib/utils";
import {
  CheckCircle2,
  Circle,
  FileText,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { markdownToHtml } from "@/lib/utils";

interface ContractViewProps {
  doc: LegalDocument;
  milestones: Map<string, Milestone>;
  paymentEvents?: PaymentEvent[];
  readOnly?: boolean;
  userId?: string;
  providerId?: string;
  clientId?: string;
  onSign?: () => void;
  onConfirmMilestone?: (milestoneId: string) => void;
  onProposeMilestoneAmount?: (milestoneId: string, amount: number) => void;
  onApproveMilestoneAmount?: (milestoneId: string) => void;
  onReleaseEscrow?: (milestoneId: string) => void;
  alreadySigned?: boolean;
}

export function ContractView({
  doc,
  milestones,
  paymentEvents,
  readOnly = false,
  userId,
  clientId,
  onSign,
  onConfirmMilestone,
  alreadySigned = false,
}: ContractViewProps) {
  const [showRawDoc, setShowRawDoc] = useState(false);
  const [confirmedLocally, setConfirmedLocally] = useState(false);
  const currency = currencySymbol(doc.terms.currency);
  const isFullySigned = doc.status === "fully_signed";
  const milestonesArray = [...milestones.values()];
  const isClient = userId === clientId;

  const immediateItems = doc.terms.lineItems.filter(
    (li) => li.type === "immediate",
  );
  const escrowItems = doc.terms.lineItems.filter(
    (li) => li.type === "escrow" || li.type === "conditional",
  );

  // Check if escrow milestone is done (either from server or optimistic local)
  const escrowDone =
    confirmedLocally ||
    milestonesArray.some(
      (m) => m.status === "completed" || m.status === "released",
    );

  function handleConfirmEscrow(msId: string) {
    setConfirmedLocally(true);
    onConfirmMilestone?.(msId);
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
              isFullySigned
                ? "bg-accent-green/10 text-accent-green"
                : "bg-accent-orange/10 text-accent-orange",
            )}
          >
            {isFullySigned ? "Active" : "Awaiting Signatures"}
          </span>
        </div>
        <h2 className="mt-1.5 text-lg font-bold text-text-primary">
          {doc.terms.summary || doc.title}
        </h2>
        <p className="mt-0.5 text-xs text-text-tertiary">
          {doc.parties.map((p) => p.name).join(" & ")} &middot;{" "}
          {new Date(doc.createdAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      </div>

      {/* ── Total ── */}
      <div className="rounded-xl border border-separator bg-surface-tertiary p-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
          Agreement Total
        </p>
        <p className="mt-1 text-3xl font-bold text-text-primary">
          {currency}
          {(doc.terms.totalAmount / 100).toFixed(2)}
        </p>
      </div>

      {/* ── Immediate Payments ── */}
      {immediateItems.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Due Now
          </h3>
          {immediateItems.map((li, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-accent-green/20 bg-accent-green/5 p-3"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-accent-green" />
                <span className="text-sm font-medium text-text-primary">
                  {li.description}
                </span>
              </div>
              <span className="text-sm font-bold text-accent-green">
                {currency}
                {(li.amount / 100).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Escrow Items + Milestone Checkbox ── */}
      {escrowItems.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Held in Escrow
          </h3>
          {escrowItems.map((li, i) => {
            const hasRange =
              li.minAmount !== undefined && li.maxAmount !== undefined;
            return (
              <div
                key={i}
                className={cn(
                  "rounded-lg border p-3",
                  escrowDone
                    ? "border-accent-green/20 bg-accent-green/5"
                    : "border-accent-blue/20 bg-accent-blue/5",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {escrowDone ? (
                      <CheckCircle2 className="size-4 text-accent-green" />
                    ) : (
                      <Circle className="size-4 text-accent-blue" />
                    )}
                    <span className="text-sm font-medium text-text-primary">
                      {li.description}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-sm font-bold",
                      escrowDone ? "text-accent-green" : "text-accent-blue",
                    )}
                  >
                    {hasRange ? (
                      <>
                        {currency}
                        {(li.minAmount! / 100).toFixed(2)} &ndash; {currency}
                        {(li.maxAmount! / 100).toFixed(2)}
                      </>
                    ) : (
                      <>
                        {currency}
                        {(li.amount / 100).toFixed(2)}
                      </>
                    )}
                  </span>
                </div>
                {escrowDone && (
                  <p className="mt-1.5 text-xs font-medium text-accent-green">
                    Escrow released — payment sent to provider
                  </p>
                )}
              </div>
            );
          })}

          {/* ── Client Checkbox to Release Escrow ── */}
          {isFullySigned && milestonesArray.length > 0 && (
            <div className="mt-3">
              {milestonesArray.map((ms) => {
                const isDone =
                  confirmedLocally ||
                  ms.status === "completed" ||
                  ms.status === "released";
                const canConfirm =
                  isClient && !isDone && ms.status !== "pending_amount";

                return (
                  <label
                    key={ms.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all",
                      isDone
                        ? "border-accent-green/30 bg-accent-green/10"
                        : "border-separator bg-surface-tertiary hover:border-accent-green/30",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isDone}
                      disabled={!canConfirm}
                      onChange={() => handleConfirmEscrow(ms.id)}
                      className="mt-0.5 size-5 accent-green-500"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm font-semibold",
                          isDone ? "text-accent-green" : "text-text-primary",
                        )}
                      >
                        {isDone
                          ? "Work completed — escrow released"
                          : isClient
                            ? "Confirm work is complete to release escrow"
                            : "Waiting for client to confirm completion"}
                      </p>
                      <p className="mt-0.5 text-xs text-text-tertiary">
                        {ms.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Factor Summary ── */}
      {doc.terms.factorSummary && (
        <div className="rounded-lg border border-accent-blue/20 bg-accent-blue/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-blue">
            How pricing works
          </p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            {doc.terms.factorSummary}
          </p>
        </div>
      )}

      {/* ── Signatures ── */}
      <div className="border-t border-separator pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Signatures
        </h3>
        <div className="space-y-2">
          {doc.parties.map((party) => {
            const signed = doc.signatures.some(
              (s) => s.userId === party.userId,
            );
            return (
              <div
                key={party.userId}
                className={cn(
                  "flex items-center justify-between rounded-lg border p-3",
                  signed
                    ? "border-accent-green/20 bg-accent-green/5"
                    : "border-separator bg-surface-tertiary",
                )}
              >
                <div className="flex items-center gap-2">
                  {signed ? (
                    <CheckCircle2 className="size-4 text-accent-green" />
                  ) : (
                    <Circle className="size-4 text-text-tertiary" />
                  )}
                  <span className="text-sm font-medium text-text-primary">
                    {party.name}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    {party.role}
                  </span>
                </div>
                <span
                  className={cn(
                    "text-xs font-medium",
                    signed ? "text-accent-green" : "text-text-tertiary",
                  )}
                >
                  {signed ? "Signed" : "Pending"}
                </span>
              </div>
            );
          })}
        </div>

        {!readOnly && !isFullySigned && onSign && (
          <Button
            className="mt-3 w-full bg-accent-green text-white hover:bg-accent-green/90"
            disabled={alreadySigned}
            onClick={onSign}
          >
            {alreadySigned ? "Signed \u2713" : "Sign Agreement"}
          </Button>
        )}

        {isFullySigned && (
          <div className="mt-3 rounded-lg border border-accent-green/30 bg-accent-green/10 p-3 text-center">
            <p className="text-sm font-bold text-accent-green">
              Agreement Active
            </p>
          </div>
        )}
      </div>

      {/* ── Payment Events (if any) ── */}
      {paymentEvents && paymentEvents.length > 0 && (
        <div className="border-t border-separator pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Payment History
          </h3>
          <div className="space-y-1.5">
            {paymentEvents.map((e) => (
              <div
                key={e.id}
                className={cn(
                  "flex items-center justify-between rounded-lg border p-2.5 text-xs",
                  e.status === "succeeded"
                    ? "border-accent-green/20 bg-accent-green/5"
                    : e.status === "failed"
                      ? "border-accent-red/20 bg-accent-red/5"
                      : "border-separator bg-surface-tertiary",
                )}
              >
                <span className="text-text-secondary">
                  {e.description || e.step}
                </span>
                <span
                  className={cn(
                    "font-medium",
                    e.status === "succeeded"
                      ? "text-accent-green"
                      : e.status === "failed"
                        ? "text-accent-red"
                        : "text-text-tertiary",
                  )}
                >
                  {e.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Raw Document ── */}
      <div className="border-t border-separator pt-3">
        <button
          type="button"
          className="flex items-center gap-2 text-xs text-text-tertiary hover:text-text-secondary"
          onClick={() => setShowRawDoc((v) => !v)}
        >
          {showRawDoc ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          <FileText className="size-3.5" />
          {showRawDoc ? "Hide" : "View"} full legal document
        </button>
        {showRawDoc && (
          <div
            className="prose prose-sm mt-3 max-w-none rounded-lg border border-separator bg-surface-primary p-4 text-text-primary [&_h1]:text-text-primary [&_h2]:text-text-primary [&_h3]:text-text-primary [&_strong]:text-text-primary [&_ul]:ml-5 [&_ol]:ml-5"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(doc.content) }}
          />
        )}
      </div>
    </div>
  );
}
