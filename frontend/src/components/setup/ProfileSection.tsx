import { User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { currencySymbol } from "@/lib/utils";
import {
  SettingsCard,
  FieldRow,
  CurrencyInput,
  type SettingsValues,
} from "./shared";

const RATE_UNIT_OPTIONS = [
  { value: "hour", label: "/hr" },
  { value: "day", label: "/day" },
  { value: "job", label: "/job" },
] as const;

interface ProfileSectionProps {
  values: SettingsValues;
  onChange: (field: keyof SettingsValues, value: string) => void;
}

export function ProfileSection({ values, onChange }: ProfileSectionProps) {
  const sym = currencySymbol(values.currency);

  return (
    <SettingsCard
      icon={<User className="size-4" />}
      title="Professional Profile"
    >
      <FieldRow label="Role">
        <Input
          placeholder="e.g., landlord, plumber, freelancer"
          value={values.role}
          onChange={(e) => onChange("role", e.target.value)}
          className="border-separator bg-surface-tertiary text-text-primary"
        />
      </FieldRow>

      <FieldRow label="Trade">
        <Input
          placeholder="e.g., plumber, electrician"
          value={values.trade}
          onChange={(e) => onChange("trade", e.target.value)}
          className="border-separator bg-surface-tertiary text-text-primary"
        />
      </FieldRow>

      <FieldRow label="Experience">
        <Input
          type="number"
          min={0}
          max={100}
          placeholder="Years"
          value={values.experienceYears}
          onChange={(e) => onChange("experienceYears", e.target.value)}
          className="border-separator bg-surface-tertiary text-text-primary"
        />
      </FieldRow>

      <FieldRow label="Certifications">
        <Input
          placeholder="Comma-separated"
          value={values.certifications}
          onChange={(e) => onChange("certifications", e.target.value)}
          className="border-separator bg-surface-tertiary text-text-primary"
        />
      </FieldRow>

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
          <SegmentedControl
            size="sm"
            value={values.rateUnit}
            options={RATE_UNIT_OPTIONS}
            onChange={(v) => onChange("rateUnit", v)}
          />
        </div>
      </FieldRow>

      <FieldRow label="Service area">
        <Input
          placeholder="e.g., London, SE England"
          value={values.serviceArea}
          onChange={(e) => onChange("serviceArea", e.target.value)}
          className="border-separator bg-surface-tertiary text-text-primary"
        />
      </FieldRow>
    </SettingsCard>
  );
}
