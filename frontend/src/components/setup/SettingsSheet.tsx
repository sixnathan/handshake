import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currencySymbol } from "@/lib/utils";

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

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  values: SettingsValues;
  onChange: (field: keyof SettingsValues, value: string) => void;
}

export function SettingsSheet({
  open,
  onOpenChange,
  values,
  onChange,
}: SettingsSheetProps) {
  const sym = currencySymbol(values.currency);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[380px] max-w-[90vw] overflow-y-auto border-separator bg-surface-secondary"
      >
        <SheetHeader>
          <SheetTitle className="text-text-primary">Settings</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-1 pt-4">
          {/* Your Role */}
          <SectionLabel>Your Role</SectionLabel>
          <Input
            placeholder="e.g., landlord, plumber, freelancer"
            value={values.role}
            onChange={(e) => onChange("role", e.target.value)}
            className="border-separator bg-surface-tertiary text-text-primary"
          />

          <Separator className="bg-separator" />

          {/* Agent Preferences */}
          <SectionLabel>Agent Preferences</SectionLabel>

          <FieldRow label="Style">
            <Select
              value={values.negStyle}
              onValueChange={(v) => onChange("negStyle", v)}
            >
              <SelectTrigger className="border-separator bg-surface-tertiary text-text-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="aggressive">Aggressive</SelectItem>
                <SelectItem value="conservative">Conservative</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label="Currency">
            <Select
              value={values.currency}
              onValueChange={(v) => onChange("currency", v)}
            >
              <SelectTrigger className="border-separator bg-surface-tertiary text-text-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gbp">GBP</SelectItem>
                <SelectItem value="usd">USD</SelectItem>
                <SelectItem value="eur">EUR</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label="Max auto-approve">
            <CurrencyInput
              symbol={sym}
              value={values.maxApprove}
              onChange={(v) => onChange("maxApprove", v)}
            />
          </FieldRow>

          <FieldRow label="Escrow">
            <Select
              value={values.escrowPref}
              onValueChange={(v) => onChange("escrowPref", v)}
            >
              <SelectTrigger className="border-separator bg-surface-tertiary text-text-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="above_threshold">Above threshold</SelectItem>
                <SelectItem value="always">Always</SelectItem>
                <SelectItem value="never">Never</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow label="Escrow threshold">
            <CurrencyInput
              symbol={sym}
              value={values.escrowThreshold}
              onChange={(v) => onChange("escrowThreshold", v)}
            />
          </FieldRow>

          <Separator className="bg-separator" />

          {/* Professional Profile */}
          <SectionLabel>Professional Profile</SectionLabel>
          <Input
            placeholder="Trade (e.g., plumber, electrician)"
            value={values.trade}
            onChange={(e) => onChange("trade", e.target.value)}
            className="border-separator bg-surface-tertiary text-text-primary"
          />
          <FieldRow label="Experience (years)">
            <Input
              type="number"
              min={0}
              max={100}
              placeholder="0"
              value={values.experienceYears}
              onChange={(e) => onChange("experienceYears", e.target.value)}
              className="border-separator bg-surface-tertiary text-text-primary"
            />
          </FieldRow>
          <Input
            placeholder="Certifications (comma-separated)"
            value={values.certifications}
            onChange={(e) => onChange("certifications", e.target.value)}
            className="border-separator bg-surface-tertiary text-text-primary"
          />

          <FieldRow label="Rate range">
            <div className="flex items-center gap-2">
              <CurrencyInput
                symbol={sym}
                value={values.rateMin}
                onChange={(v) => onChange("rateMin", v)}
                placeholder="Min"
              />
              <span className="text-text-tertiary">&ndash;</span>
              <CurrencyInput
                symbol={sym}
                value={values.rateMax}
                onChange={(v) => onChange("rateMax", v)}
                placeholder="Max"
              />
              <Select
                value={values.rateUnit}
                onValueChange={(v) => onChange("rateUnit", v)}
              >
                <SelectTrigger className="w-20 border-separator bg-surface-tertiary text-text-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hour">/hr</SelectItem>
                  <SelectItem value="day">/day</SelectItem>
                  <SelectItem value="job">/job</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FieldRow>

          <Input
            placeholder="Service area (e.g., London, SE England)"
            value={values.serviceArea}
            onChange={(e) => onChange("serviceArea", e.target.value)}
            className="border-separator bg-surface-tertiary text-text-primary"
          />

          <Separator className="bg-separator" />

          {/* Instructions */}
          <SectionLabel>Instructions</SectionLabel>
          <Textarea
            placeholder="Tell your agent how to negotiate for you..."
            value={values.customInstructions}
            onChange={(e) => onChange("customInstructions", e.target.value)}
            className="min-h-[80px] border-separator bg-surface-tertiary text-text-primary"
          />

          <Separator className="bg-separator" />

          {/* Payment */}
          <SectionLabel>Payment</SectionLabel>
          <Input
            placeholder="Stripe Connect ID (acct_...)"
            value={values.stripeId}
            onChange={(e) => onChange("stripeId", e.target.value)}
            className="border-separator bg-surface-tertiary text-text-primary"
          />
          <Input
            type="password"
            placeholder="Monzo access token"
            value={values.monzoToken}
            onChange={(e) => onChange("monzoToken", e.target.value)}
            className="border-separator bg-surface-tertiary text-text-primary"
          />

          {/* Spacer for bottom padding */}
          <div className="h-6" />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
      {children}
    </h3>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm text-text-secondary">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function CurrencyInput({
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
