import { useState, useRef, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateRoomCode, generateUserId } from "@/lib/utils";
import { useSessionStore } from "@/stores/session-store";
import {
  type ProfileData,
  saveProfile,
  loadProfile,
} from "@/hooks/use-profile";
import { Check, Copy } from "lucide-react";

interface JoinFormProps {
  buildProfile: () => ProfileData;
}

export function JoinForm({ buildProfile }: JoinFormProps) {
  const [roomCode, setRoomCode] = useState(() => generateRoomCode());
  const [name, setName] = useState(() => loadProfile().displayName ?? "");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const startSession = useSessionStore((s) => s.startSession);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCopy() {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!roomCode.trim()) {
      setError("Room code is required");
      return;
    }

    const profile = buildProfile();
    profile.displayName = name.trim();
    saveProfile(profile);

    const userId = generateUserId(name.trim());
    startSession(userId, name.trim(), roomCode.trim());
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-[340px] flex-col gap-3"
    >
      <Input
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-12 border-separator bg-surface-secondary text-text-primary placeholder:text-text-tertiary"
      />
      <div className="flex gap-2">
        <Input
          placeholder="Room code"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          className="h-12 flex-1 border-separator bg-surface-secondary text-text-primary placeholder:text-text-tertiary"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleCopy}
          className="h-12 w-12 shrink-0 border-separator bg-surface-secondary text-text-secondary"
        >
          {copied ? (
            <Check className="size-4 text-accent-green" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
      </div>
      <Button
        type="submit"
        className="h-12 bg-accent-blue text-white hover:bg-accent-blue/90"
      >
        Join Room
      </Button>
      {error && <p className="text-center text-sm text-accent-red">{error}</p>}
    </form>
  );
}
