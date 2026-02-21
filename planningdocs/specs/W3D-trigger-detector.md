# W3D — TriggerDetector

**File to create:** `src/services/trigger-detector.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts`, `src/providers/` (LLM for smart detection)
**Depended on by:** RoomManager (feeds transcripts, listens for "triggered" event)

---

## Purpose

Monitors transcripts from both users and detects when to trigger AI agent negotiation. Two detection modes:

1. **Keyword detection** — Both users must say the trigger word (e.g., "chripbbbly") within a 30-second window
2. **Smart detection** — Periodic LLM analysis of transcript for financial/agreement language (confidence threshold 0.7)

---

## Imports

```ts
import { EventEmitter } from "eventemitter3";
import type { TranscriptEntry, TriggerEvent, KeywordState, DetectedTerm, UserId } from "../types.js";
import type { ITriggerDetector } from "../interfaces.js";
import type { ILLMProvider } from "../providers/provider.js";
```

---

## Class: TriggerDetector

```ts
export class TriggerDetector extends EventEmitter implements ITriggerDetector
```

### Constructor

```ts
constructor(private readonly config: {
  keyword: string;
  smartDetectionEnabled: boolean;
  llmProvider: ILLMProvider;
  llmModel: string;
})
```

### Private State

```ts
private keyword: string;
private keywordStates: KeywordState[] = [];  // track who said keyword and when
private recentTranscripts: TranscriptEntry[] = [];
private smartDetectionTimer: ReturnType<typeof setInterval> | null = null;
private lastSmartCheckIndex = 0;  // avoid re-analyzing same transcripts
private triggered = false;  // prevent multiple triggers per session
private readonly KEYWORD_WINDOW_MS = 30_000;
private readonly SMART_CHECK_INTERVAL_MS = 10_000;
private readonly SMART_CONFIDENCE_THRESHOLD = 0.7;
```

### Initialization

In the constructor:
- `this.keyword = config.keyword.toLowerCase()`
- If `config.smartDetectionEnabled`:
  - Start the smart detection interval: `this.smartDetectionTimer = setInterval(() => this.runSmartDetection(), this.SMART_CHECK_INTERVAL_MS)`

### Methods

**`feedTranscript(entry: TranscriptEntry): void`**
1. If `this.triggered`, return (already triggered, don't re-trigger)
2. Push entry to `this.recentTranscripts`
3. If entry is final: check for keyword match
   - `if (entry.isFinal && entry.text.toLowerCase().includes(this.keyword))`:
     - Add to `keywordStates`: `{ userId: entry.speaker, detectedAt: Date.now() }`
     - Call `this.checkKeywordTrigger(entry.speaker)`

**`setKeyword(keyword: string): void`**
- `this.keyword = keyword.toLowerCase()`
- `this.keywordStates = []` (reset keyword tracking)

**`reset(): void`**
- `this.triggered = false`
- `this.keywordStates = []`
- `this.recentTranscripts = []`
- `this.lastSmartCheckIndex = 0`

**`destroy(): void`**
- If `this.smartDetectionTimer`: `clearInterval(this.smartDetectionTimer)`
- `this.removeAllListeners()`

### Private: Keyword Detection

**`private checkKeywordTrigger(latestSpeaker: UserId): void`**
1. Prune expired states: remove any `KeywordState` where `Date.now() - state.detectedAt > KEYWORD_WINDOW_MS`
2. Get unique user IDs from remaining states:
   ```ts
   const uniqueUsers = new Set(this.keywordStates.map(s => s.userId));
   ```
3. If `uniqueUsers.size >= 2`:
   - `this.triggered = true`
   - Emit `"triggered"` with:
     ```ts
     {
       type: "keyword",
       confidence: 1.0,
       matchedText: this.keyword,
       timestamp: Date.now(),
       speakerId: latestSpeaker,
     } satisfies TriggerEvent
     ```

### Private: Smart Detection

**`private async runSmartDetection(): Promise<void>`**
1. If `this.triggered`, return
2. Get new transcripts since last check:
   ```ts
   const newTranscripts = this.recentTranscripts.slice(this.lastSmartCheckIndex);
   ```
3. If `newTranscripts.length === 0`, return (nothing new to analyze)
4. `this.lastSmartCheckIndex = this.recentTranscripts.length`
5. Build the analysis text from the last 20 transcripts (or fewer):
   ```ts
   const window = this.recentTranscripts.slice(-20);
   const text = window.map(t => `${t.speaker}: ${t.text}`).join("\n");
   ```
6. Call LLM:
   ```ts
   const response = await this.config.llmProvider.createMessage({
     model: this.config.llmModel,
     maxTokens: 500,
     system: SMART_DETECTION_PROMPT,
     messages: [{ role: "user", content: text }],
   });
   ```
7. Parse the response (see prompt below). Extract `{ triggered: boolean, confidence: number, terms: DetectedTerm[] }`
8. If `triggered && confidence >= SMART_CONFIDENCE_THRESHOLD`:
   - `this.triggered = true`
   - Emit `"triggered"` with:
     ```ts
     {
       type: "smart",
       confidence,
       matchedText: terms.map(t => t.term).join(", "),
       detectedTerms: terms,
       timestamp: Date.now(),
       speakerId: newTranscripts[newTranscripts.length - 1].speaker,
     } satisfies TriggerEvent
     ```
9. Catch any LLM errors, log and continue (don't crash)

### Smart Detection LLM Prompt

```ts
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
```

### Response Parsing

```ts
private parseSmartDetectionResponse(content: LLMContentBlock[]): {
  triggered: boolean;
  confidence: number;
  terms: DetectedTerm[];
} {
  const textBlock = content.find(b => b.type === "text");
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
    return { triggered: false, confidence: 0, terms: [] };
  }
}
```

---

## Events Emitted

| Event | Payload | When |
|-------|---------|------|
| `"triggered"` | `TriggerEvent` | Keyword match (both users) or smart detection fires |

---

## Edge Cases

- Same user says keyword twice: only one `KeywordState` per user matters; need 2 DIFFERENT users
- Keyword states expire after 30s window
- Smart detection response is malformed JSON: returns `triggered: false`, logs warning
- LLM call fails: caught, logged, continues checking on next interval
- `triggered` flag prevents multiple emissions per session
- `reset()` allows re-triggering (useful if negotiation is rejected)

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `ITriggerDetector` interface
- Keyword detection requires 2 different users within 30s
- Smart detection runs every 10s, uses LLM
- Confidence threshold 0.7 for smart detection
- Only emits once per session (until reset)
- Clean destruction stops interval
