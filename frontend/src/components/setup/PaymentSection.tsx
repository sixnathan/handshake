import { CreditCard } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SettingsCard, FieldRow, type SettingsValues } from "./shared";

interface PaymentSectionProps {
  values: SettingsValues;
  onChange: (field: keyof SettingsValues, value: string) => void;
}

export function PaymentSection({ values, onChange }: PaymentSectionProps) {
  return (
    <SettingsCard icon={<CreditCard className="size-4" />} title="Payment">
      <FieldRow label="Stripe ID" description="Your Connect account">
        <Input
          placeholder="acct_..."
          value={values.stripeId}
          onChange={(e) => onChange("stripeId", e.target.value)}
          className="border-separator bg-surface-tertiary text-text-primary"
        />
      </FieldRow>

      <FieldRow label="Monzo token" description="For balance checks (optional)">
        <Input
          type="password"
          placeholder="Access token"
          value={values.monzoToken}
          onChange={(e) => onChange("monzoToken", e.target.value)}
          className="border-separator bg-surface-tertiary text-text-primary"
        />
      </FieldRow>
    </SettingsCard>
  );
}
