import { EventEmitter } from "eventemitter3";
import type { TranscriptEntry, TriggerEvent, UserId } from "../types.js";
import type { ITriggerDetector } from "../interfaces.js";

export class TriggerDetector extends EventEmitter implements ITriggerDetector {
  private keyword: string;
  private recentTranscripts: TranscriptEntry[] = [];
  private triggered = false;

  constructor(
    private readonly config: {
      keyword: string;
      userId: string;
    },
  ) {
    super();
    this.keyword = config.keyword.toLowerCase();
  }

  private readonly MAX_TRANSCRIPTS = 100;

  feedTranscript(entry: TranscriptEntry): void {
    if (this.triggered) return;

    this.recentTranscripts.push(entry);

    if (this.recentTranscripts.length > this.MAX_TRANSCRIPTS) {
      const excess = this.recentTranscripts.length - this.MAX_TRANSCRIPTS;
      this.recentTranscripts = this.recentTranscripts.slice(excess);
    }

    if (entry.isFinal && entry.text.toLowerCase().includes(this.keyword)) {
      this.checkKeywordTrigger(entry.speaker);
    }
  }

  setKeyword(keyword: string): void {
    this.keyword = keyword.toLowerCase();
  }

  reset(): void {
    this.triggered = false;
    this.recentTranscripts = [];
  }

  destroy(): void {
    this.removeAllListeners();
  }

  private checkKeywordTrigger(latestSpeaker: UserId): void {
    // Fire for ANY user saying the keyword — dual-keyword coordination
    // happens in RoomManager, not here.
    this.triggered = true;
    this.emit("triggered", {
      type: "keyword",
      confidence: 1.0,
      matchedText: this.keyword,
      timestamp: Date.now(),
      speakerId: latestSpeaker,
      role: "unclear" as const,
    } satisfies TriggerEvent);
  }
}
