import type { PaymentEvent } from "@/stores/document-store";
import { cn, currencySymbol } from "@/lib/utils";
import { CreditCard, Lock, Zap } from "lucide-react";

interface PaymentsSectionProps {
  paymentEvents: PaymentEvent[];
}

/** Deduplicate events: prefer payment_receipt over execution for same PaymentIntent,
 *  and skip "processing" status if a final status exists for that ID. */
function deduplicateEvents(events: PaymentEvent[]): PaymentEvent[] {
  const byIntent = new Map<string, PaymentEvent>();
  const noIntent: PaymentEvent[] = [];

  for (const ev of events) {
    if (!ev.paymentIntentId) {
      noIntent.push(ev);
      continue;
    }

    const existing = byIntent.get(ev.paymentIntentId);
    if (!existing) {
      byIntent.set(ev.paymentIntentId, ev);
      continue;
    }

    // Prefer payment_receipt over execution
    if (ev.type !== "execution" && existing.type === "execution") {
      byIntent.set(ev.paymentIntentId, ev);
      continue;
    }

    // Prefer final status over processing
    if (existing.status === "processing" && ev.status !== "processing") {
      byIntent.set(ev.paymentIntentId, ev);
    }
  }

  return [...byIntent.values(), ...noIntent].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
}

const TYPE_CONFIG = {
  payment: {
    icon: Zap,
    label: "Payment",
    color: "text-accent-green",
    bg: "bg-accent-green/10",
  },
  escrow_hold: {
    icon: Lock,
    label: "Escrow Hold",
    color: "text-accent-blue",
    bg: "bg-accent-blue/10",
  },
  execution: {
    icon: CreditCard,
    label: "Execution",
    color: "text-accent-orange",
    bg: "bg-accent-orange/10",
  },
} as const;

const STATUS_STYLES: Record<string, { color: string; bg: string }> = {
  succeeded: { color: "text-accent-green", bg: "bg-accent-green/10" },
  requires_capture: { color: "text-accent-blue", bg: "bg-accent-blue/10" },
  processing: { color: "text-accent-orange", bg: "bg-accent-orange/10" },
  completed: { color: "text-accent-green", bg: "bg-accent-green/10" },
  failed: { color: "text-accent-red", bg: "bg-accent-red/10" },
};

function truncateId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 10)}...${id.slice(-4)}`;
}

export function PaymentsSection({ paymentEvents }: PaymentsSectionProps) {
  const events = deduplicateEvents(paymentEvents);

  if (events.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
        Payment Transactions
      </h3>
      <div className="space-y-2">
        {events.map((ev) => (
          <PaymentCard key={ev.id} event={ev} />
        ))}
      </div>
    </section>
  );
}

function PaymentCard({ event }: { event: PaymentEvent }) {
  const cfg = TYPE_CONFIG[event.type] ?? TYPE_CONFIG.execution;
  const Icon = cfg.icon;
  const statusStyle = STATUS_STYLES[event.status] ?? {
    color: "text-text-tertiary",
    bg: "bg-surface-tertiary",
  };
  const currency = event.currency ? currencySymbol(event.currency) : "";
  const time = new Date(event.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="rounded-lg border border-separator bg-surface-tertiary p-3">
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-4 shrink-0", cfg.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                cfg.bg,
                cfg.color,
              )}
            >
              {cfg.label}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                statusStyle.bg,
                statusStyle.color,
              )}
            >
              {event.status}
            </span>
            <span className="text-[10px] text-text-tertiary">{time}</span>
          </div>

          {/* Description or step */}
          <p className="mt-1 text-sm text-text-primary">
            {event.description ?? event.step ?? cfg.label}
          </p>

          {/* Details */}
          {event.details && (
            <p className="mt-0.5 text-xs text-text-tertiary">{event.details}</p>
          )}

          {/* Bottom row: stripe method + payment intent ID */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {event.stripeMethod && (
              <span className="inline-flex items-center rounded bg-surface-primary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                {event.stripeMethod}
              </span>
            )}
            {event.paymentIntentId && (
              <span
                className="font-mono text-[10px] text-text-tertiary"
                title={event.paymentIntentId}
              >
                {truncateId(event.paymentIntentId)}
              </span>
            )}
          </div>
        </div>

        {/* Amount */}
        {event.amount != null && (
          <p className="whitespace-nowrap text-sm font-semibold text-text-primary">
            {currency}
            {(event.amount / 100).toFixed(2)}
          </p>
        )}
      </div>
    </div>
  );
}
