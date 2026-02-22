import { cn, formatTime } from "@/lib/utils";

interface TranscriptBubbleProps {
  text: string;
  timestamp: number;
  isLocal: boolean;
  isPartial: boolean;
}

export function TranscriptBubble({
  text,
  timestamp,
  isLocal,
  isPartial,
}: TranscriptBubbleProps) {
  return (
    <div
      className={cn(
        "mb-2 rounded-lg border-l-[3px] px-3 py-2 text-sm leading-relaxed",
        isPartial
          ? "border-gray-3 bg-surface-primary italic text-text-tertiary"
          : isLocal
            ? "border-accent-blue bg-surface-tertiary text-text-primary"
            : "border-accent-green bg-surface-tertiary text-text-primary",
      )}
    >
      <span>{isPartial ? text + "..." : text}</span>
      {!isPartial && (
        <span className="mt-1 block text-[10px] tabular-nums text-text-tertiary">
          {formatTime(timestamp)}
        </span>
      )}
    </div>
  );
}
