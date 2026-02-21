import { EventEmitter } from "eventemitter3";
import type { TranscriptEntry, SessionStatus } from "../types.js";
import type { ISessionService } from "../interfaces.js";

export class SessionService extends EventEmitter implements ISessionService {
  private status: SessionStatus = "discovering";
  private transcripts: TranscriptEntry[] = [];

  getStatus(): SessionStatus {
    return this.status;
  }

  setStatus(status: SessionStatus): void {
    this.status = status;
    this.emit("status_changed", status);
  }

  addTranscript(entry: TranscriptEntry): void {
    this.transcripts = [...this.transcripts, entry];
    this.emit("transcript", entry);
  }

  getTranscripts(): readonly TranscriptEntry[] {
    return this.transcripts;
  }

  getTranscriptText(): string {
    return this.transcripts
      .filter((t) => t.isFinal)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join("\n");
  }

  getRecentTranscriptText(windowMs: number): string {
    const cutoff = Date.now() - windowMs;
    return this.transcripts
      .filter((t) => t.isFinal && t.timestamp >= cutoff)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join("\n");
  }

  reset(): void {
    this.status = "discovering";
    this.transcripts = [];
    this.emit("status_changed", "discovering");
  }
}
