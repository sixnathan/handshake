import { cn, formatTime } from "@/lib/utils";

interface TranscriptBubbleProps {
  text: string;
  timestamp: number;
  isLocal: boolean;
  isPartial: boolean;
  variant?: "column" | "chat";
  speaker?: string;
}

export function TranscriptBubble({
  text,
  timestamp,
  isLocal,
  isPartial,
  variant = "column",
  speaker,
}: TranscriptBubbleProps) {
  if (variant === "chat") {
    return (
      <div
        className={cn(
          "mb-3 flex flex-col",
          isLocal ? "items-end" : "items-start",
        )}
      >
        {speaker && !isPartial && (
          <span
            className={cn(
              "mb-0.5 px-1 text-[10px] font-medium uppercase tracking-wide",
              isLocal ? "text-accent-blue" : "text-accent-green",
            )}
          >
            {speaker}
          </span>
        )}
        <div
          className={cn(
            "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
            isPartial
              ? "bg-surface-primary italic text-text-tertiary"
              : isLocal
                ? "bg-accent-blue/15 text-text-primary"
                : "bg-surface-tertiary text-text-primary",
          )}
        >
          <span>{isPartial ? text + "..." : text}</span>
          {!isPartial && (
            <span className="ml-2 inline-block text-[10px] tabular-nums text-text-tertiary">
              {formatTime(timestamp)}
            </span>
          )}
        </div>
      </div>
    );
  }

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
