import { cn, formatTime } from "@/lib/utils";
import type { TimelineNodeType } from "@/stores/timeline-store";

interface TimelineNodeProps {
  type: TimelineNodeType;
  text: string;
  timestamp: number;
}

const DOT_COLORS: Record<TimelineNodeType, string> = {
  detect: "border-accent-orange bg-accent-orange/20",
  propose: "border-accent-blue bg-accent-blue/20",
  receive: "border-accent-blue bg-accent-blue/20",
  counter: "border-accent-orange bg-accent-orange/20",
  accept: "border-accent-green bg-accent-green/20",
  reject: "border-accent-red bg-accent-red/20",
  sign: "border-accent-green bg-accent-green/20",
  pay: "border-accent-green bg-accent-green/20",
  doc: "border-accent-purple bg-accent-purple/20",
  tool: "border-accent-purple bg-accent-purple/20",
  message: "border-gray-3 bg-surface-secondary",
};

export function TimelineNodeItem({ type, text, timestamp }: TimelineNodeProps) {
  return (
    <div className="relative pb-4 pl-5">
      <div
        className={cn(
          "absolute -left-[7px] top-[3px] size-3 rounded-full border-2",
          DOT_COLORS[type],
        )}
      />
      <p className="text-sm leading-snug text-text-primary">{text}</p>
      <p className="mt-0.5 text-[10px] tabular-nums text-text-tertiary">
        {formatTime(timestamp)}
      </p>
    </div>
  );
}
