import { useSessionStore } from "@/stores/session-store";

export function PulseRing() {
  const sessionStatus = useSessionStore((s) => s.sessionStatus);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      {/* Animated rings */}
      <div className="relative flex size-[120px] items-center justify-center rounded-full border-2 border-accent-blue">
        <div className="absolute inset-0 animate-[pulse-ring_2.5s_ease-out_infinite] rounded-full border border-accent-blue" />
        <div className="absolute inset-0 animate-[pulse-ring_2.5s_ease-out_1.25s_infinite] rounded-full border border-accent-blue" />
        <div className="size-3 rounded-full bg-accent-blue" />
      </div>

      {/* Status text */}
      <p className="text-base tracking-wide text-text-secondary">
        {sessionStatus}
      </p>
    </div>
  );
}
