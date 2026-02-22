import { cn } from "@/lib/utils";

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedControlOption<T>[];
  onChange: (value: T) => void;
  size?: "default" | "sm";
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = "default",
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      data-slot="segmented-control"
      className={cn(
        "inline-flex rounded-lg bg-surface-tertiary p-1",
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-md text-sm font-medium transition-all duration-150",
              size === "default" && "px-3 py-1.5",
              size === "sm" && "px-2 py-1 text-xs",
              isActive
                ? "bg-surface-primary text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary",
              "focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
