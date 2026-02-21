# Prompt 08 — Monzo, Insights, and Emotion Services

**Phase:** 2 (services — parallelizable)
**Depends on:** 01-types-and-interfaces
**Blocks:** Phase 3 (agent/tools)

## Task

Create three services: MonzoService (banking API), InsightsEngine (spending analysis), and EmotionAnalyzer (prosodic analysis from word timestamps).

---

## File 1: src/services/monzo.ts

### Class: MonzoService

REST API client for Monzo banking.

**Private state:**
```ts
private accessToken: string | null = null;
private baseUrl = "https://api.monzo.com";
```

**`setAccessToken(token: string): void`**
- Store token

**`isAuthenticated(): boolean`**
- Return `this.accessToken !== null`

**Private helper: `request(method: string, path: string, body?: Record<string, unknown>)`**
- Throw if no accessToken
- Use `fetch(this.baseUrl + path, { method, headers: { Authorization: "Bearer " + this.accessToken, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })`
- Parse JSON response
- If response not ok, throw with status and body

**`getBalance(): Promise<MonzoBalance>`**
- GET `/balance?account_id=${accountId}`
- Note: For simplicity, use the first account. You may need to call GET `/accounts` first to get the account_id, or accept it as optional constructor param.
- Return the response as MonzoBalance

**`getTransactions(days?: number): Promise<MonzoTransaction[]>`**
- Default days = 30
- Calculate `since` as ISO string: `new Date(Date.now() - days * 86400000).toISOString()`
- GET `/transactions?account_id=${accountId}&since=${since}&expand[]=merchant`
- Return `response.transactions`

**`createFeedItem(title: string, body: string, url?: string): Promise<void>`**
- POST `/feed` with form-encoded body (Monzo uses form encoding for some endpoints):
  ```
  account_id, type: "basic", url (optional),
  params[title], params[body], params[image_url] (optional)
  ```
- For simplicity, use JSON and adjust if Monzo requires form encoding

**`depositToPot(potId: string, amount: number): Promise<void>`**
- PUT `/pots/${potId}/deposit` with `{ amount, dedupe_id: crypto.randomUUID() }`

**`withdrawFromPot(potId: string, amount: number): Promise<void>`**
- PUT `/pots/${potId}/withdraw` with `{ amount, dedupe_id: crypto.randomUUID() }`

**`listPots(): Promise<MonzoPot[]>`**
- GET `/pots`
- Return `response.pots`

**`getOrCreateEscrowPot(): Promise<MonzoPot>`**
- Call `listPots()`
- Find pot with name "Handshake Escrow"
- If not found, create one (note: Monzo API may not support pot creation via API — if so, throw with instructions to create manually)
- Return the pot

### Imports
```ts
import crypto from "node:crypto";
import type { MonzoBalance, MonzoTransaction, MonzoPot } from "../types.js";
```

---

## File 2: src/services/insights.ts

### Class: InsightsEngine

Spending analysis from Monzo transaction data.

**Constructor args:**
- `monzo: MonzoService`

**`getSpendingInsights(days?: number): Promise<{ categories: Record<string, number>; total: number }>`**
1. Call `monzo.getTransactions(days)`
2. Group transactions by `category` field
3. Sum amounts per category (amounts are in pence, negative = spending)
4. Calculate total spending
5. Return `{ categories, total }`

**`getPeerHistory(peerId: string): Promise<MonzoTransaction[]>`**
1. Call `monzo.getTransactions(90)` (last 90 days)
2. Filter transactions where description contains peerId or merchant name matches
3. Return filtered array

**`checkAffordability(amount: number): Promise<{ affordable: boolean; remainingAfter: number; assessment: string }>`**
1. Call `monzo.getBalance()`
2. Calculate `remainingAfter = balance.balance - amount`
3. Determine assessment:
   - remainingAfter > 10000 (£100 in pence) → "comfortable"
   - remainingAfter > 0 → "tight"
   - remainingAfter <= 0 → "unaffordable"
4. Return `{ affordable: remainingAfter > 0, remainingAfter, assessment }`

### Imports
```ts
import type { MonzoService } from "./monzo.js";
import type { MonzoTransaction } from "../types.js";
```

---

## File 3: src/services/emotion.ts

### Class: EmotionAnalyzer

Derives emotional state from word-level timestamps provided by ElevenLabs Scribe v2. Zero API cost — uses prosodic features only.

**`analyzeSegment(words: WordTimestamp[]): { state: EmotionState; metrics: EmotionMetrics }`**

1. If words.length < 3, return `{ state: "neutral", metrics: { wpm: 0, avgPauseDuration: 0, silenceRatio: 0, avgConfidence: 0 } }`

2. Calculate metrics:

   **WPM (words per minute):**
   - totalDuration = last word's end - first word's start (in seconds)
   - wpm = (words.length / totalDuration) * 60
   - If totalDuration is 0, set wpm to 0

   **Average pause duration:**
   - For each consecutive pair of words, calculate gap = word[i+1].start - word[i].end
   - Average all gaps
   - If no gaps, avgPauseDuration = 0

   **Silence ratio:**
   - Total pause time = sum of all gaps between words
   - silenceRatio = totalPauseTime / totalDuration
   - If totalDuration is 0, silenceRatio = 0

   **Average confidence:**
   - Mean of all word.confidence values

3. Classify emotion state using thresholds:

   ```
   IF wpm > 180 AND avgPauseDuration < 0.3:
     state = "urgent"
   ELSE IF wpm < 100 OR avgPauseDuration > 0.8:
     state = "hesitant"
   ELSE IF avgConfidence > 0.95 AND wpm >= 100 AND wpm <= 180:
     state = "confident"
   ELSE:
     state = "neutral"
   ```

4. Return `{ state, metrics: { wpm, avgPauseDuration, silenceRatio, avgConfidence } }`

### Imports
```ts
import type { WordTimestamp, EmotionState, EmotionMetrics } from "../types.js";
```

---

## Verification

- MonzoService: all REST endpoints hit correct Monzo API paths
- InsightsEngine: categories are summed correctly, affordability uses £100 buffer
- EmotionAnalyzer: minimum 3 words, correct threshold classifications
- EmotionAnalyzer returns "neutral" for short segments
- All services handle edge cases (empty data, missing auth)
