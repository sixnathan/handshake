import { EventEmitter } from "eventemitter3";
import type {
  TranscriptEntry,
  TriggerEvent,
  DetectedTerm,
  UserId,
} from "../types.js";
import type { ITriggerDetector } from "../interfaces.js";
import type { ILLMProvider } from "../providers/provider.js";
import type { LLMContentBlock } from "../providers/types.js";

function buildSmartDetectionPrompt(
  userId: string,
  displayName: string,
): string {
  return `You are monitoring a live conversation on behalf of ${displayName} (${userId}).
You will see transcript lines labeled with speaker IDs.

Your user is: ${userId}
The other person is: whoever else appears in the transcript.

Determine if there is a financial agreement, deal, or offer being discussed
that your user should act on — either as the person offering/paying or
the person receiving/being paid.

Look for:
- Explicit amounts ("£500", "two hundred pounds", "$50")
- Payment language ("I'll pay you", "you owe me", "let's split it", "that'll cost")
- Agreement language ("deal", "agreed", "sounds good", "let's do it", "we have a deal")
- Service/work agreements ("I'll fix your...", "can you do X for Y")
- Conditional terms ("when the job is done", "after delivery", "once you finish")

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "triggered": true/false,
  "confidence": 0.0-1.0,
  "role": "proposer" | "responder" | "unclear",
  "summary": "brief description of what's being agreed",
  "terms": [
    { "term": "the detected phrase", "confidence": 0.0-1.0, "context": "surrounding sentence" }
  ]
}

"role" indicates whether your user (${displayName}) is the one proposing/paying ("proposer") or the one receiving/being paid ("responder"). Use "unclear" if you can't determine this.

If there's no financial agreement being discussed, respond with:
{ "triggered": false, "confidence": 0.0, "role": "unclear", "summary": "", "terms": [] }`;
}

export class TriggerDetector extends EventEmitter implements ITriggerDetector {
  private keyword: string;
  private recentTranscripts: TranscriptEntry[] = [];
  private smartDetectionTimer: ReturnType<typeof setInterval> | null = null;
  private lastSmartCheckIndex = 0;
  private triggered = false;
  private readonly SMART_CHECK_INTERVAL_MS = 10_000;
  private readonly SMART_CONFIDENCE_THRESHOLD = 0.7;
  private smartDetectionRunning = false;

  constructor(
    private readonly config: {
      keyword: string;
      smartDetectionEnabled: boolean;
      llmProvider: ILLMProvider;
      llmModel: string;
      userId: string;
      displayName: string;
    },
  ) {
    super();
    this.keyword = config.keyword.toLowerCase();

    if (config.smartDetectionEnabled) {
      this.smartDetectionTimer = setInterval(
        () => this.runSmartDetection(),
        this.SMART_CHECK_INTERVAL_MS,
      );
    }
  }

  private readonly MAX_TRANSCRIPTS = 100;

  feedTranscript(entry: TranscriptEntry): void {
    if (this.triggered) return;

    this.recentTranscripts.push(entry);

    if (this.recentTranscripts.length > this.MAX_TRANSCRIPTS) {
      const excess = this.recentTranscripts.length - this.MAX_TRANSCRIPTS;
      this.recentTranscripts = this.recentTranscripts.slice(excess);
      this.lastSmartCheckIndex = Math.max(0, this.lastSmartCheckIndex - excess);
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
    this.lastSmartCheckIndex = 0;
  }

  destroy(): void {
    if (this.smartDetectionTimer) {
      clearInterval(this.smartDetectionTimer);
    }
    this.removeAllListeners();
  }

  private checkKeywordTrigger(latestSpeaker: UserId): void {
    // Per-user keyword detection: fire when THIS user says the keyword
    if (latestSpeaker !== this.config.userId) return;

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

  private async runSmartDetection(): Promise<void> {
    if (this.triggered || this.smartDetectionRunning) return;
    this.smartDetectionRunning = true;

    try {
      const newTranscripts = this.recentTranscripts.slice(
        this.lastSmartCheckIndex,
      );
      if (newTranscripts.length === 0) return;

      this.lastSmartCheckIndex = this.recentTranscripts.length;

      const window = this.recentTranscripts.slice(-20);
      const text = window.map((t) => `${t.speaker}: ${t.text}`).join("\n");

      this.emit("smart:check", {
        transcriptLines: window.length,
        inputPreview: text.slice(0, 200),
        timestamp: Date.now(),
      });

      const smartPrompt = buildSmartDetectionPrompt(
        this.config.userId,
        this.config.displayName,
      );

      const response = await this.config.llmProvider.createMessage({
        model: this.config.llmModel,
        maxTokens: 500,
        system: smartPrompt,
        messages: [{ role: "user", content: text }],
      });

      const { triggered, confidence, terms, role, summary } =
        this.parseSmartDetectionResponse(response.content);

      this.emit("smart:result", {
        triggered,
        confidence,
        terms,
        role,
        summary,
        timestamp: Date.now(),
      });

      if (triggered && confidence >= this.SMART_CONFIDENCE_THRESHOLD) {
        this.triggered = true;
        this.emit("triggered", {
          type: "smart",
          confidence,
          matchedText: terms.map((t) => t.term).join(", "),
          detectedTerms: terms,
          timestamp: Date.now(),
          speakerId: this.config.userId as UserId,
          role,
          summary,
        } satisfies TriggerEvent);
      }
    } catch (err) {
      console.warn("[TriggerDetector] Smart detection LLM error:", err);
      this.emit("smart:result", {
        triggered: false,
        confidence: 0,
        terms: [],
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
    } finally {
      this.smartDetectionRunning = false;
    }
  }

  private parseSmartDetectionResponse(content: LLMContentBlock[]): {
    triggered: boolean;
    confidence: number;
    terms: DetectedTerm[];
    role: "proposer" | "responder" | "unclear";
    summary: string;
  } {
    const fallback = {
      triggered: false,
      confidence: 0,
      terms: [] as DetectedTerm[],
      role: "unclear" as const,
      summary: "",
    };

    const textBlock = content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return fallback;
    }

    try {
      const parsed = JSON.parse(textBlock.text);
      const role = parsed.role;
      return {
        triggered: Boolean(parsed.triggered),
        confidence: Number(parsed.confidence) || 0,
        terms: Array.isArray(parsed.terms)
          ? parsed.terms.map((t: Record<string, unknown>) => ({
              term: String(t.term ?? ""),
              confidence: Number(t.confidence) || 0,
              context: String(t.context ?? ""),
            }))
          : [],
        role: role === "proposer" || role === "responder" ? role : "unclear",
        summary: String(parsed.summary ?? ""),
      };
    } catch {
      console.warn(
        "[TriggerDetector] Failed to parse smart detection response",
      );
      return fallback;
    }
  }
}
