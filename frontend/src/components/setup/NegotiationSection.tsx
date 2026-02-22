import { Scale } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { currencySymbol } from "@/lib/utils";
import {
  SettingsCard,
  FieldRow,
  CurrencyInput,
  type SettingsValues,
} from "./shared";

const STYLE_OPTIONS = [
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Aggressive" },
  { value: "conservative", label: "Conservative" },
] as const;

const CURRENCY_OPTIONS = [
  { value: "gbp", label: "GBP" },
  { value: "usd", label: "USD" },
  { value: "eur", label: "EUR" },
] as const;

const ESCROW_OPTIONS = [
  { value: "always", label: "Always" },
  { value: "above_threshold", label: "Above Threshold" },
  { value: "never", label: "Never" },
] as const;

interface NegotiationSectionProps {
  values: SettingsValues;
  onChange: (field: keyof SettingsValues, value: string) => void;
}

export function NegotiationSection({
  values,
  onChange,
}: NegotiationSectionProps) {
  const sym = currencySymbol(values.currency);

  return (
    <SettingsCard icon={<Scale className="size-4" />} title="Negotiation">
      <FieldRow label="Style" description="How your agent negotiates">
        <SegmentedControl
          value={values.negStyle}
          options={STYLE_OPTIONS}
          onChange={(v) => onChange("negStyle", v)}
        />
      </FieldRow>

      <FieldRow label="Currency" description="Default for proposals">
        <SegmentedControl
          value={values.currency}
          options={CURRENCY_OPTIONS}
          onChange={(v) => onChange("currency", v)}
        />
      </FieldRow>

      <FieldRow
        label="Max auto-approve"
        description="Agent can accept up to this"
      >
        <CurrencyInput
          symbol={sym}
          value={values.maxApprove}
          onChange={(v) => onChange("maxApprove", v)}
        />
      </FieldRow>

      <FieldRow label="Escrow" description="When to hold funds in escrow">
        <SegmentedControl
          value={values.escrowPref}
          options={ESCROW_OPTIONS}
          onChange={(v) => onChange("escrowPref", v)}
        />
      </FieldRow>

      {values.escrowPref === "above_threshold" && (
        <FieldRow
          label="Escrow threshold"
          description="Escrow above this amount"
        >
          <CurrencyInput
            symbol={sym}
            value={values.escrowThreshold}
            onChange={(v) => onChange("escrowThreshold", v)}
          />
        </FieldRow>
      )}
    </SettingsCard>
  );
}
