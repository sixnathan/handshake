import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SettingsValues {
  role: string;
  negStyle: string;
  currency: string;
  maxApprove: string;
  escrowPref: string;
  escrowThreshold: string;
  trade: string;
  experienceYears: string;
  certifications: string;
  rateMin: string;
  rateMax: string;
  rateUnit: string;
  serviceArea: string;
  customInstructions: string;
  stripeId: string;
  monzoToken: string;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
      {children}
    </h3>
  );
}

export function SettingsCard({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-separator bg-surface-secondary p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-text-secondary">{icon}</span>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      {description && (
        <p className="mt-1.5 text-xs text-text-tertiary">{description}</p>
      )}
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

export function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0">
        <span className="text-sm text-text-secondary">{label}</span>
        {description && (
          <p className="text-[11px] text-text-tertiary">{description}</p>
        )}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function CurrencyInput({
  symbol,
  value,
  onChange,
  placeholder,
}: {
  symbol: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex">
      <span className="flex items-center rounded-l-md border border-r-0 border-separator bg-surface-tertiary px-2 text-sm text-text-secondary">
        {symbol}
      </span>
      <Input
        type="number"
        min={0}
        step={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-l-none border-separator bg-surface-tertiary text-text-primary"
      />
    </div>
  );
}
