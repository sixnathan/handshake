import { cn } from "@/lib/utils";
import { PAYMENT_TYPE_CONFIG } from "@/lib/milestone-config";

interface LineItemRowProps {
  description: string;
  amount: number;
  type: string;
  currency: string;
  minAmount?: number;
  maxAmount?: number;
}

export function LineItemRow({
  description,
  amount,
  type,
  currency,
  minAmount,
  maxAmount,
}: LineItemRowProps) {
  const typeConfig =
    PAYMENT_TYPE_CONFIG[type as keyof typeof PAYMENT_TYPE_CONFIG] ??
    PAYMENT_TYPE_CONFIG.immediate;
  const hasRange = minAmount !== undefined && maxAmount !== undefined;

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-secondary">{description}</span>
      <span className="flex items-center gap-1.5 font-medium text-text-primary">
        {hasRange ? (
          <>
            {currency}
            {(minAmount! / 100).toFixed(2)}&ndash;{currency}
            {(maxAmount! / 100).toFixed(2)}
          </>
        ) : (
          <>
            {currency}
            {(amount / 100).toFixed(2)}
          </>
        )}
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
            typeConfig.bg,
            typeConfig.color,
          )}
        >
          {typeConfig.label}
        </span>
      </span>
    </div>
  );
}
