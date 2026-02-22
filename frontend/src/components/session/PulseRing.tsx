import { useSessionStore } from "@/stores/session-store";
import { useDocumentStore } from "@/stores/document-store";
import { cn } from "@/lib/utils";

function useRingColor(): { border: string; bg: string; text: string } {
  const status = useSessionStore((s) => s.sessionStatus);
  const hasDoc = useDocumentStore((s) => s.currentDocument !== null);
  const isFullySigned = useDocumentStore(
    (s) => s.currentDocument?.status === "fully_signed",
  );

  if (isFullySigned)
    return {
      border: "border-accent-green",
      bg: "bg-accent-green",
      text: "text-accent-green",
    };
  if (hasDoc)
    return {
      border: "border-accent-green",
      bg: "bg-accent-green",
      text: "text-accent-green",
    };
  if (status.startsWith("Error"))
    return {
      border: "border-accent-red",
      bg: "bg-accent-red",
      text: "text-accent-red",
    };
  if (
    status.includes("Negotiat") ||
    status.includes("Counter") ||
    status.includes("rejected")
  )
    return {
      border: "border-accent-orange",
      bg: "bg-accent-orange",
      text: "text-accent-orange",
    };
  if (status.includes("Agreement") || status.includes("Payment"))
    return {
      border: "border-accent-green",
      bg: "bg-accent-green",
      text: "text-accent-green",
    };
  return {
    border: "border-accent-blue",
    bg: "bg-accent-blue",
    text: "text-accent-blue",
  };
}

export function PulseRing() {
  const sessionStatus = useSessionStore((s) => s.sessionStatus);
  const { border, bg, text } = useRingColor();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      {/* Animated rings */}
      <div
        className={cn(
          "relative flex size-[120px] items-center justify-center rounded-full border-2 transition-colors duration-700",
          border,
        )}
      >
        <div
          className={cn(
            "absolute inset-0 animate-[pulse-ring_2.5s_ease-out_infinite] rounded-full border transition-colors duration-700",
            border,
          )}
        />
        <div
          className={cn(
            "absolute inset-0 animate-[pulse-ring_2.5s_ease-out_1.25s_infinite] rounded-full border transition-colors duration-700",
            border,
          )}
        />
        <div
          className={cn(
            "size-3 rounded-full transition-colors duration-700",
            bg,
          )}
        />
      </div>

      {/* Status text */}
      <p
        className={cn(
          "text-base tracking-wide transition-colors duration-700",
          text,
        )}
      >
        {sessionStatus}
      </p>
    </div>
  );
}
