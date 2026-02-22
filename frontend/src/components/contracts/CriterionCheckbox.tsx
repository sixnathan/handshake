import { cn } from "@/lib/utils";

interface CriterionCheckboxProps {
  label: string;
  checked: boolean;
  size?: "sm" | "md";
}

export function CriterionCheckbox({
  label,
  checked,
  size = "md",
}: CriterionCheckboxProps) {
  const boxSize = size === "sm" ? "size-3.5" : "size-4";
  const iconSize = size === "sm" ? "size-2.5" : "size-3";

  return (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          "mt-0.5 flex shrink-0 items-center justify-center rounded border transition-colors",
          boxSize,
          checked
            ? "border-accent-green bg-accent-green text-white"
            : "border-separator bg-surface-primary",
        )}
      >
        {checked && (
          <svg
            className={iconSize}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </span>
      <span
        className={cn(
          "text-xs leading-relaxed transition-colors",
          checked ? "text-text-tertiary line-through" : "text-text-secondary",
        )}
      >
        {label}
      </span>
    </div>
  );
}
