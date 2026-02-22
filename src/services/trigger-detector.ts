import { EventEmitter } from "eventemitter3";
import type { TranscriptEntry, TriggerEvent, UserId } from "../types.js";
import type { ITriggerDetector } from "../interfaces.js";
import type { ILLMProvider } from "../providers/provider.js";

/**
 * Build a regex that matches the keyword and common STT variants.
 * For "handshake" this matches: handshake, hand shake, hand-shake,
 * hanshake, handshak, han shake, hantshake, etc.
 */
function buildFuzzyPattern(keyword: string): RegExp {
  if (keyword === "handshake") {
    // Targeted pattern for "handshake" covering STT mishearings
    return /\bhand[\s\-]?shake\b|\bhands[\s\-]?hake\b|\bhan[\s\-]?shake\b|\bhandshak\b|\bhantshake\b|\bhandchake\b|\bhanshake\b|\bhand[\s\-]?cheque\b|\bhandshook\b/i;
  }

  // Generic: match keyword with optional space/hyphen between each pair of chars
  // and allow the keyword as-is
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const chars = [...escaped];
  const flexPattern = chars.join("[\\s\\-]?");
  return new RegExp(`\\b${flexPattern}\\b|\\b${escaped}\\b`, "i");
}

export class TriggerDetector extends EventEmitter implements ITriggerDetector {
  private keyword: string;
  private keywordPattern: RegExp;
  private recentTranscripts: TranscriptEntry[] = [];
  private triggered = false;
  private smartInterval: ReturnType<typeof setInterval> | null = null;
  private smartCheckInFlight = false;
  private lastSmartCheckIndex = 0;

  constructor(
    private readonly config: {
      keyword: string;
      userId: string;
      llmProvider?: ILLMProvider;
      llmModel?: string;
    },
  ) {
    super();
    this.keyword = config.keyword.toLowerCase();
    this.keywordPattern = buildFuzzyPattern(this.keyword);
    this.startSmartDetection();
  }

  private readonly MAX_TRANSCRIPTS = 100;
  private readonly SMART_CHECK_INTERVAL_MS = 5_000;

  feedTranscript(entry: TranscriptEntry): void {
    console.log(
      `[trigger:${this.config.userId}] feedTranscript: "${entry.text}" (isFinal=${entry.isFinal}, speaker=${entry.speaker})`,
    );
    if (this.triggered) {
      console.log(
        `[trigger:${this.config.userId}] feedTranscript: skipping — already triggered`,
      );
      return;
    }

    this.recentTranscripts.push(entry);

    if (this.recentTranscripts.length > this.MAX_TRANSCRIPTS) {
      const excess = this.recentTranscripts.length - this.MAX_TRANSCRIPTS;
      this.recentTranscripts = this.recentTranscripts.slice(excess);
    }

    if (entry.isFinal) {
      const matched = this.keywordPattern.test(entry.text);
      console.log(
        `[trigger:${this.config.userId}] keyword check: pattern=${this.keywordPattern.source}, matched=${matched}`,
      );
      if (matched) {
        this.checkKeywordTrigger(entry.speaker);
      }
    }
  }

  setKeyword(keyword: string): void {
    this.keyword = keyword.toLowerCase();
    this.keywordPattern = buildFuzzyPattern(this.keyword);
  }

  reset(): void {
    this.triggered = false;
    this.recentTranscripts = [];
    this.lastSmartCheckIndex = 0;
    this.smartCheckInFlight = false;
    this.startSmartDetection();
  }

  destroy(): void {
    this.stopSmartDetection();
    this.removeAllListeners();
  }

  private checkKeywordTrigger(latestSpeaker: UserId): void {
    console.log(
      `[trigger:${this.config.userId}] KEYWORD MATCHED — emitting triggered event (speaker=${latestSpeaker})`,
    );
    // Fire for ANY user saying the keyword — dual-keyword coordination
    // happens in RoomManager, not here.
    this.triggered = true;
    this.stopSmartDetection();
    this.emit("triggered", {
      type: "keyword",
      confidence: 1.0,
      matchedText: this.keyword,
      timestamp: Date.now(),
      speakerId: latestSpeaker,
      role: "unclear" as const,
    } satisfies TriggerEvent);
  }

  // ── Smart Detection (LLM fallback every 5s) ──────────────

  private startSmartDetection(): void {
    if (!this.config.llmProvider || !this.config.llmModel) {
      console.log(
        `[trigger:${this.config.userId}] Smart detection skipped — no LLM provider/model`,
      );
      return;
    }
    this.stopSmartDetection();

    console.log(
      `[trigger:${this.config.userId}] Smart detection started (interval=${this.SMART_CHECK_INTERVAL_MS}ms)`,
    );
    this.smartInterval = setInterval(() => {
      void this.runSmartCheck();
    }, this.SMART_CHECK_INTERVAL_MS);
  }

  private stopSmartDetection(): void {
    if (this.smartInterval !== null) {
      clearInterval(this.smartInterval);
      this.smartInterval = null;
    }
  }

  private async runSmartCheck(): Promise<void> {
    if (
      this.triggered ||
      this.smartCheckInFlight ||
      !this.config.llmProvider ||
      !this.config.llmModel
    )
      return;

    // Only check if there are new transcripts since last check
    if (this.recentTranscripts.length <= this.lastSmartCheckIndex) return;

    // Need at least 2 transcripts from different speakers
    const speakers = new Set(this.recentTranscripts.map((t) => t.speaker));
    if (speakers.size < 2) {
      console.log(
        `[trigger:${this.config.userId}] Smart check skipped — only ${speakers.size} speaker(s)`,
      );
      return;
    }

    console.log(
      `[trigger:${this.config.userId}] Running smart check (${this.recentTranscripts.length} transcripts, ${speakers.size} speakers)`,
    );

    this.smartCheckInFlight = true;
    const checkIndex = this.recentTranscripts.length;

    try {
      // Build transcript text for the LLM
      const transcriptText = this.recentTranscripts
        .filter((t) => t.isFinal)
        .map((t) => `${t.speaker}: ${t.text}`)
        .join("\n");

      if (!transcriptText.trim()) return;

      const response = await this.config.llmProvider.createMessage({
        model: this.config.llmModel,
        maxTokens: 100,
        system: `You are a trigger word detector for the Handshake app. Your ONLY job is to determine if a specific speaker has said the trigger word "${this.keyword}" (or a very close variant) in the conversation transcript.

The trigger word "${this.keyword}" is how users activate the agreement process. When BOTH people in a conversation say "${this.keyword}", the system activates AI agents to negotiate on their behalf. Each speaker must say it independently.

You are checking for speaker: ${this.config.userId}

Respond with ONLY a JSON object: {"triggered": true} or {"triggered": false}
- triggered=true if speaker ${this.config.userId} has said "${this.keyword}" or a close phonetic/semantic match
- triggered=false otherwise

Be VERY generous with matching — speech-to-text often produces variants. Accept any of these as a match:
- Exact: "handshake", "Handshake", "HANDSHAKE"
- Spaced/hyphenated: "hand shake", "hand-shake", "hands hake"
- Partial/truncated: "handshak", "hanshake"
- In context: "let's handshake", "could we handshake on this", "handshake on it", "we handshake"
- Phonetic mishearings: "hantshake", "handchake", "hand cheque", "hans hake"
- Past tense: "handshook"
If in doubt, trigger=true.`,
        messages: [
          {
            role: "user",
            content: `Check if speaker "${this.config.userId}" has said the trigger word "${this.keyword}" in this transcript:\n\n${transcriptText}`,
          },
        ],
      });

      this.lastSmartCheckIndex = checkIndex;

      // Parse the response
      const text = response.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");

      const jsonMatch = text.match(
        /\{[^}]*"triggered"\s*:\s*(true|false)[^}]*\}/,
      );
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as { triggered: boolean };
        if (result.triggered && !this.triggered) {
          console.log(
            `[trigger:${this.config.userId}] Smart detection: trigger word detected by LLM`,
          );
          this.triggered = true;
          this.stopSmartDetection();
          this.emit("triggered", {
            type: "smart",
            confidence: 0.9,
            matchedText: this.keyword,
            timestamp: Date.now(),
            speakerId: this.config.userId,
            role: "unclear" as const,
          } satisfies TriggerEvent);
        }
      }
    } catch (err) {
      console.error(
        `[trigger:${this.config.userId}] Smart detection LLM call failed:`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.smartCheckInFlight = false;
    }
  }
}
