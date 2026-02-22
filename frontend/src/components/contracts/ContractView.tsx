import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { LegalDocument, Milestone } from "@/stores/document-store";
import { cn, currencySymbol, markdownToHtml } from "@/lib/utils";
import {
  MILESTONE_STATUS,
  PAYMENT_TYPE_CONFIG,
  OUTCOME_CONFIG,
} from "@/lib/milestone-config";
import { CriterionCheckbox } from "@/components/contracts/CriterionCheckbox";
import {
  CheckCircle2,
  Clock,
  Shield,
  ChevronDown,
  ChevronRight,
  FileText,
  Users,
  CreditCard,
} from "lucide-react";

interface ContractViewProps {
  doc: LegalDocument;
  milestones: Map<string, Milestone>;
  readOnly?: boolean;
  onSign?: () => void;
  onCompleteMilestone?: (milestoneId: string) => void;
  onVerifyMilestone?: (milestoneId: string) => void;
  alreadySigned?: boolean;
}

export function ContractView({
  doc,
  milestones,
  readOnly = false,
  onSign,
  onCompleteMilestone,
  onVerifyMilestone,
  alreadySigned = false,
}: ContractViewProps) {
  const [showRawDoc, setShowRawDoc] = useState(false);
  const currency = currencySymbol(doc.terms.currency);
  const isFullySigned = doc.status === "fully_signed";
  const milestonesArray = [...milestones.values()];

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────── */}
      <ContractHeader doc={doc} currency={currency} />

      {/* ── Parties ─────────────────────────────── */}
      <PartiesSection doc={doc} />

      {/* ── Payment Breakdown ───────────────────── */}
      <PaymentBreakdown doc={doc} currency={currency} />

      {/* ── Line Items ──────────────────────────── */}
      <LineItemsSection doc={doc} currency={currency} />

      {/* ── Factor Summary ──────────────────────── */}
      {doc.terms.factorSummary && (
        <section className="rounded-lg border border-accent-blue/20 bg-accent-blue/5 p-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-accent-blue">
            How pricing works
          </h3>
          <p className="text-sm leading-relaxed text-text-secondary">
            {doc.terms.factorSummary}
          </p>
        </section>
      )}

      {/* ── Milestones ──────────────────────────── */}
      {milestonesArray.length > 0 && (
        <MilestonesSection
          milestones={milestonesArray}
          currency={currency}
          readOnly={readOnly}
          isFullySigned={isFullySigned}
          onComplete={onCompleteMilestone}
          onVerify={onVerifyMilestone}
        />
      )}

      {/* ── Conditions ──────────────────────────── */}
      {doc.terms.conditions.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Conditions
          </h3>
          <div className="space-y-1.5">
            {doc.terms.conditions.map((c, i) => (
              <CriterionCheckbox key={i} label={c} checked={isFullySigned} />
            ))}
          </div>
        </section>
      )}

      {/* ── Signatures ──────────────────────────── */}
      <SignaturesSection
        doc={doc}
        readOnly={readOnly}
        alreadySigned={alreadySigned}
        onSign={onSign}
      />

      {/* ── Raw Document Toggle ─────────────────── */}
      <section className="border-t border-separator pt-4">
        <button
          type="button"
          aria-expanded={showRawDoc}
          className="flex items-center gap-2 text-xs text-text-tertiary transition-colors hover:text-text-secondary"
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
      </section>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────

function PaymentBreakdown({
  doc,
  currency,
}: {
  doc: LegalDocument;
  currency: string;
}) {
  const immediate = doc.terms.lineItems
    .filter((li) => li.type === "immediate")
    .reduce((sum, li) => sum + li.amount, 0);
  const escrow = doc.terms.lineItems
    .filter((li) => li.type === "escrow" || li.type === "conditional")
    .reduce((sum, li) => sum + (li.maxAmount ?? li.amount), 0);

  if (immediate === 0 && escrow === 0) return null;

  return (
    <div className="flex gap-3">
      {immediate > 0 && (
        <div className="flex-1 rounded-lg border border-accent-green/20 bg-accent-green/5 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-accent-green">
            Due on signing
          </p>
          <p className="mt-0.5 text-lg font-bold text-accent-green">
            {currency}
            {(immediate / 100).toFixed(2)}
          </p>
        </div>
      )}
      {escrow > 0 && (
        <div className="flex-1 rounded-lg border border-accent-blue/20 bg-accent-blue/5 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-accent-blue">
            Held in escrow
          </p>
          <p className="mt-0.5 text-lg font-bold text-accent-blue">
            {currency}
            {(escrow / 100).toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}

function ContractHeader({
  doc,
  currency,
}: {
  doc: LegalDocument;
  currency: string;
}) {
  const date = new Date(doc.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const statusConfig = {
    draft: { label: "Draft", color: "text-text-tertiary", bg: "bg-gray-5" },
    pending_signatures: {
      label: "Awaiting Signatures",
      color: "text-accent-orange",
      bg: "bg-accent-orange/10",
    },
    fully_signed: {
      label: "Signed",
      color: "text-accent-green",
      bg: "bg-accent-green/10",
    },
  } as const;

  const status = statusConfig[doc.status];

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
              status.bg,
              status.color,
            )}
          >
            {status.label}
          </span>
          <span className="text-xs text-text-tertiary">{date}</span>
        </div>
        <h2 className="mt-1 text-lg font-bold text-text-primary">
          {doc.terms.summary || doc.title}
        </h2>
      </div>
      <div className="text-right">
        <p className="text-xs text-text-tertiary">Total</p>
        <p className="text-xl font-bold text-text-primary">
          {currency}
          {(doc.terms.totalAmount / 100).toFixed(2)}
        </p>
      </div>
    </div>
  );
}

const PARTY_COLORS = [
  "bg-accent-blue",
  "bg-accent-green",
  "bg-accent-orange",
  "bg-accent-purple",
] as const;

function PartiesSection({ doc }: { doc: LegalDocument }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-separator bg-surface-tertiary p-3">
      <Users className="size-4 shrink-0 text-text-tertiary" />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {doc.parties.map((p, i) => (
          <div key={p.userId} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[10px] font-bold text-white",
                PARTY_COLORS[i % PARTY_COLORS.length],
              )}
            >
              {p.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <span className="text-sm font-medium text-text-primary">
                {p.name}
              </span>
              <span className="ml-1.5 text-xs text-text-tertiary">
                {p.role}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineItemsSection({
  doc,
  currency,
}: {
  doc: LegalDocument;
  currency: string;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
        Line Items
      </h3>
      <div className="space-y-2">
        {doc.terms.lineItems.map((li, i) => {
          const typeConfig =
            PAYMENT_TYPE_CONFIG[li.type as keyof typeof PAYMENT_TYPE_CONFIG] ??
            PAYMENT_TYPE_CONFIG.immediate;
          const hasRange =
            li.minAmount !== undefined && li.maxAmount !== undefined;

          return (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-separator bg-surface-tertiary p-3"
            >
              <CreditCard className="size-4 shrink-0 text-text-tertiary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary">
                  {li.description}
                </p>
                {li.condition && (
                  <p className="mt-0.5 text-[11px] text-text-tertiary">
                    {li.condition}
                  </p>
                )}
                {li.factors && li.factors.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {li.factors.map((f, fi) => (
                      <span
                        key={fi}
                        className="inline-flex items-center rounded bg-surface-primary px-1.5 py-0.5 text-[10px] text-text-tertiary"
                        title={f.description}
                      >
                        {f.name}
                        <span
                          className={cn(
                            "ml-1",
                            f.impact === "increases"
                              ? "text-accent-red"
                              : f.impact === "decreases"
                                ? "text-accent-green"
                                : "text-text-tertiary/60",
                          )}
                        >
                          {f.impact === "increases"
                            ? "\u2191"
                            : f.impact === "decreases"
                              ? "\u2193"
                              : "\u2194"}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right">
                <span
                  className={cn(
                    "mb-0.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                    typeConfig.bg,
                    typeConfig.color,
                  )}
                >
                  {typeConfig.label}
                </span>
                <p className="text-sm font-semibold text-text-primary">
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
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MilestonesSection({
  milestones,
  currency,
  readOnly,
  isFullySigned,
  onComplete,
  onVerify,
}: {
  milestones: Milestone[];
  currency: string;
  readOnly: boolean;
  isFullySigned: boolean;
  onComplete?: (id: string) => void;
  onVerify?: (id: string) => void;
}) {
  const completed = milestones.filter((m) => m.status === "completed").length;
  const total = milestones.length;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Milestones
        </h3>
        <span className="text-xs text-text-tertiary">
          {completed}/{total} complete
        </span>
      </div>
      {/* Progress bar */}
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-separator">
        <div
          className="h-full rounded-full bg-accent-green transition-all duration-500"
          style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
        />
      </div>
      <div className="space-y-3">
        {milestones.map((ms) => (
          <MilestoneCard
            key={ms.id}
            milestone={ms}
            currency={currency}
            readOnly={readOnly}
            isFullySigned={isFullySigned}
            onComplete={onComplete}
            onVerify={onVerify}
          />
        ))}
      </div>
    </section>
  );
}

function MilestoneCard({
  milestone: ms,
  currency,
  readOnly,
  isFullySigned,
  onComplete,
  onVerify,
}: {
  milestone: Milestone;
  currency: string;
  readOnly: boolean;
  isFullySigned: boolean;
  onComplete?: (id: string) => void;
  onVerify?: (id: string) => void;
}) {
  const status = MILESTONE_STATUS[ms.status] ?? MILESTONE_STATUS.pending;
  const StatusIcon = status.icon;

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        ms.status === "completed"
          ? "border-accent-green/20 bg-accent-green/5"
          : ms.status === "failed"
            ? "border-accent-red/20 bg-accent-red/5"
            : ms.status === "disputed"
              ? "border-accent-orange/20 bg-accent-orange/5"
              : "border-separator bg-surface-tertiary",
      )}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <StatusIcon className={cn("mt-0.5 size-4 shrink-0", status.color)} />
          <div>
            <p className="text-sm font-semibold text-text-primary">
              {ms.description}
            </p>
            {ms.expectedTimeline && (
              <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-text-tertiary">
                <Clock className="size-3" />
                {ms.expectedTimeline}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
              status.bg,
              status.color,
            )}
          >
            {status.label}
          </span>
          <p className="mt-0.5 text-sm font-bold text-text-primary">
            {currency}
            {(ms.amount / 100).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Deliverables */}
      {ms.deliverables && ms.deliverables.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
            Deliverables
          </p>
          <ul className="space-y-1">
            {ms.deliverables.map((d, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs text-text-secondary"
              >
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-text-tertiary" />
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Completion Criteria — tickable checkboxes */}
      {ms.completionCriteria && ms.completionCriteria.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
            Completion Criteria
          </p>
          <div className="space-y-1.5">
            {ms.completionCriteria.map((c, i) => (
              <CriterionCheckbox
                key={i}
                label={c}
                checked={ms.status === "completed"}
              />
            ))}
          </div>
        </div>
      )}

      {/* Fallback: just show condition if no structured criteria */}
      {(!ms.completionCriteria || ms.completionCriteria.length === 0) &&
        ms.condition && (
          <div className="mt-3">
            <CriterionCheckbox
              label={ms.condition}
              checked={ms.status === "completed"}
            />
          </div>
        )}

      {/* Verification method tag */}
      {ms.verificationMethod && (
        <div className="mt-3 flex items-center gap-1.5">
          <Shield className="size-3 text-text-tertiary" />
          <span className="text-[11px] text-text-tertiary">
            Verification: {ms.verificationMethod}
          </span>
        </div>
      )}

      {/* Action buttons */}
      {ms.status === "pending" && isFullySigned && (
        <div className="mt-3 flex gap-2">
          {!readOnly && onComplete && (
            <Button
              size="sm"
              className="bg-accent-green text-white hover:bg-accent-green/90"
              onClick={() => onComplete(ms.id)}
            >
              <CheckCircle2 className="mr-1.5 size-3.5" />
              Mark Complete
            </Button>
          )}
          {onVerify && (
            <Button
              size="sm"
              variant="outline"
              className="border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10"
              onClick={() => onVerify(ms.id)}
            >
              <Shield className="mr-1.5 size-3.5" />
              Verify
            </Button>
          )}
        </div>
      )}

      {/* Verification result */}
      {ms.verificationResult && (
        <VerificationResultBadge
          result={ms.verificationResult}
          currency={currency}
        />
      )}
    </div>
  );
}

function SignaturesSection({
  doc,
  readOnly,
  alreadySigned,
  onSign,
}: {
  doc: LegalDocument;
  readOnly: boolean;
  alreadySigned: boolean;
  onSign?: () => void;
}) {
  const isFullySigned = doc.status === "fully_signed";

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
        Signatures
      </h3>
      <div className="space-y-2">
        {doc.parties.map((party, i) => {
          const sig = doc.signatures.find((s) => s.userId === party.userId);
          const signed = !!sig;

          return (
            <div
              key={party.userId}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3",
                signed
                  ? "border-accent-green/20 bg-accent-green/5"
                  : "border-separator bg-surface-tertiary",
              )}
            >
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-[11px] font-bold text-white",
                  signed
                    ? "bg-accent-green"
                    : PARTY_COLORS[i % PARTY_COLORS.length],
                )}
              >
                {signed ? (
                  <svg
                    className="size-3.5"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                ) : (
                  party.name.charAt(0).toUpperCase()
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary">
                  {party.name}
                </p>
                <p className="text-xs text-text-tertiary">{party.role}</p>
              </div>
              {signed ? (
                <span className="text-xs font-medium text-accent-green">
                  Signed{" "}
                  {new Date(sig!.signedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              ) : (
                <span className="text-xs text-text-tertiary">
                  Awaiting signature
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Sign button */}
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
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-accent-green/20 bg-accent-green/5 p-3">
          <CheckCircle2 className="size-4 text-accent-green" />
          <p className="text-sm font-medium text-accent-green">
            Agreement fully signed and active
          </p>
        </div>
      )}
    </section>
  );
}

// ── Verification result inline badge ─────────────────

function VerificationResultBadge({
  result,
  currency,
}: {
  result: NonNullable<Milestone["verificationResult"]>;
  currency: string;
}) {
  const cfg = OUTCOME_CONFIG[result.outcome];

  return (
    <div className={cn("mt-3 rounded-lg border p-3", cfg.bg, cfg.border)}>
      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-bold uppercase", cfg.color)}>
          {cfg.label}
        </span>
        {result.verifiedAmount !== undefined && (
          <span className="text-xs font-medium text-text-primary">
            {currency}
            {(result.verifiedAmount / 100).toFixed(2)}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-text-secondary">{result.reasoning}</p>
      {result.evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {result.evidence.map((item, i) => (
            <li
              key={i}
              className="text-[11px] text-text-tertiary before:mr-1.5 before:content-['\u2022']"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
