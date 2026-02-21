import { EventEmitter } from "eventemitter3";
import type {
  TranscriptEntry,
  TriggerEvent,
  KeywordState,
  DetectedTerm,
  UserId,
} from "../types.js";
import type { ITriggerDetector } from "../interfaces.js";
import type { ILLMProvider } from "../providers/provider.js";
import type { LLMContentBlock } from "../providers/types.js";

const SMART_DETECTION_PROMPT = `You are a financial agreement detector. Analyze the conversation transcript and determine if the speakers are making a financial agreement, deal, or commitment that involves money.

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
  "terms": [
    { "term": "the detected phrase", "confidence": 0.0-1.0, "context": "surrounding sentence" }
  ]
}

If there's no financial agreement being discussed, respond with:
{ "triggered": false, "confidence": 0.0, "terms": [] }`;

export class TriggerDetector extends EventEmitter implements ITriggerDetector {
  private keyword: string;
  private keywordStates: KeywordState[] = [];
  private recentTranscripts: TranscriptEntry[] = [];
  private smartDetectionTimer: ReturnType<typeof setInterval> | null = null;
  private lastSmartCheckIndex = 0;
  private triggered = false;
  private readonly KEYWORD_WINDOW_MS = 30_000;
  private readonly SMART_CHECK_INTERVAL_MS = 10_000;
  private readonly SMART_CONFIDENCE_THRESHOLD = 0.7;
  private smartDetectionRunning = false;

  constructor(
    private readonly config: {
      keyword: string;
      smartDetectionEnabled: boolean;
      llmProvider: ILLMProvider;
      llmModel: string;
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

  feedTranscript(entry: TranscriptEntry): void {
    if (this.triggered) return;

    this.recentTranscripts.push(entry);

    if (entry.isFinal && entry.text.toLowerCase().includes(this.keyword)) {
      this.keywordStates.push({
        userId: entry.speaker,
        detectedAt: Date.now(),
      });
      this.checkKeywordTrigger(entry.speaker);
    }
  }

  setKeyword(keyword: string): void {
    this.keyword = keyword.toLowerCase();
    this.keywordStates = [];
  }

  reset(): void {
    this.triggered = false;
    this.keywordStates = [];
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
    const now = Date.now();
    this.keywordStates = this.keywordStates.filter(
      (s) => now - s.detectedAt <= this.KEYWORD_WINDOW_MS,
    );

    const uniqueUsers = new Set(this.keywordStates.map((s) => s.userId));

    if (uniqueUsers.size >= 2) {
      this.triggered = true;
      this.emit("triggered", {
        type: "keyword",
        confidence: 1.0,
        matchedText: this.keyword,
        timestamp: Date.now(),
        speakerId: latestSpeaker,
      } satisfies TriggerEvent);
    }
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

      const response = await this.config.llmProvider.createMessage({
        model: this.config.llmModel,
        maxTokens: 500,
        system: SMART_DETECTION_PROMPT,
        messages: [{ role: "user", content: text }],
      });

      const { triggered, confidence, terms } = this.parseSmartDetectionResponse(
        response.content,
      );

      if (triggered && confidence >= this.SMART_CONFIDENCE_THRESHOLD) {
        this.triggered = true;
        this.emit("triggered", {
          type: "smart",
          confidence,
          matchedText: terms.map((t) => t.term).join(", "),
          detectedTerms: terms,
          timestamp: Date.now(),
          speakerId: newTranscripts[newTranscripts.length - 1].speaker,
        } satisfies TriggerEvent);
      }
    } catch (err) {
      console.warn("[TriggerDetector] Smart detection LLM error:", err);
    } finally {
      this.smartDetectionRunning = false;
    }
  }

  private parseSmartDetectionResponse(content: LLMContentBlock[]): {
    triggered: boolean;
    confidence: number;
    terms: DetectedTerm[];
  } {
    const textBlock = content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { triggered: false, confidence: 0, terms: [] };
    }

    try {
      const parsed = JSON.parse(textBlock.text);
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
      };
    } catch {
      console.warn(
        "[TriggerDetector] Failed to parse smart detection response",
      );
      return { triggered: false, confidence: 0, terms: [] };
    }
  }
}
