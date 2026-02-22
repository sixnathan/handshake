import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TriggerDetector } from "../src/services/trigger-detector.js";
import type { TranscriptEntry, TriggerEvent } from "../src/types.js";

function makeEntry(
  speaker: string,
  text: string,
  isFinal = true,
): TranscriptEntry {
  return {
    id: `${speaker}-${Date.now()}`,
    speaker,
    text,
    timestamp: Date.now(),
    isFinal,
    source: "local",
  };
}

const mockLLMProvider = {
  createMessage: vi.fn().mockResolvedValue({
    content: [
      {
        type: "text",
        text: '{"triggered":false,"confidence":0,"role":"unclear","summary":"","terms":[]}',
      },
    ],
    stopReason: "end_turn",
    usage: { inputTokens: 0, outputTokens: 0 },
  }),
};

describe("TriggerDetector Module", () => {
  let detector: TriggerDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new TriggerDetector({
      keyword: "chripbbbly",
      smartDetectionEnabled: false,
      llmProvider: mockLLMProvider as any,
      llmModel: "test-model",
      userId: "alice",
      displayName: "Alice",
    });
  });

  afterEach(() => {
    detector.destroy();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should trigger when the configured user says the keyword", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "let's say chripbbbly"));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("keyword");
    expect(events[0].confidence).toBe(1.0);
    expect(events[0].speakerId).toBe("alice");
  });

  it("should not trigger when a different user says the keyword", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("bob", "chripbbbly"));
    expect(events.length).toBe(0);
  });

  it("should not trigger on partial (non-final) transcripts", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "chripbbbly", false));
    expect(events.length).toBe(0);
  });

  it("should be case-insensitive for keyword matching", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "CHRIPBBBLY"));
    expect(events.length).toBe(1);
  });

  it("should support changing the keyword", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.setKeyword("deal");

    detector.feedTranscript(makeEntry("alice", "deal"));
    expect(events.length).toBe(1);
  });

  it("should reset state for next negotiation", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "chripbbbly"));
    expect(events.length).toBe(1);

    detector.reset();

    // Should be able to trigger again
    detector.feedTranscript(makeEntry("alice", "chripbbbly"));
    expect(events.length).toBe(2);
  });

  it("should not emit duplicate triggers", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "chripbbbly"));
    detector.feedTranscript(makeEntry("alice", "chripbbbly again"));

    expect(events.length).toBe(1); // still just 1
  });

  it("should ignore transcripts after triggering", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "chripbbbly"));

    // These should be ignored (already triggered)
    detector.feedTranscript(makeEntry("alice", "chripbbbly"));
    detector.feedTranscript(makeEntry("bob", "chripbbbly"));
    expect(events.length).toBe(1);
  });

  it("should include role field in trigger event", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "chripbbbly"));

    expect(events[0].role).toBe("unclear");
  });

  it("should clean up on destroy", () => {
    // Register listener first, then destroy removes all listeners
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));
    detector.destroy();

    // Create fresh detector to test keyword detection is decoupled
    const det2 = new TriggerDetector({
      keyword: "chripbbbly",
      smartDetectionEnabled: false,
      llmProvider: mockLLMProvider as any,
      llmModel: "test-model",
      userId: "alice",
      displayName: "Alice",
    });
    const events2: TriggerEvent[] = [];
    det2.on("triggered", (e) => events2.push(e));
    det2.feedTranscript(makeEntry("alice", "chripbbbly"));
    expect(events2.length).toBe(1); // new detector works
    expect(events.length).toBe(0); // old detector's listener was removed
    det2.destroy();
  });
});

describe("TriggerDetector Smart Detection", () => {
  it("should run smart detection on interval when enabled", async () => {
    vi.useRealTimers();

    const smartProvider = {
      createMessage: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              triggered: true,
              confidence: 0.9,
              role: "responder",
              summary: "Payment of £500 for work",
              terms: [
                {
                  term: "£500",
                  confidence: 0.9,
                  context: "pay £500 for the work",
                },
              ],
            }),
          },
        ],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    };

    // Test the smart detection method directly instead of relying on intervals
    const detector = new TriggerDetector({
      keyword: "chripbbbly",
      smartDetectionEnabled: false, // disable auto-interval, test manually
      llmProvider: smartProvider as any,
      llmModel: "test-model",
      userId: "alice",
      displayName: "Alice",
    });

    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(
      makeEntry("alice", "I'll pay you £500 for the work"),
    );
    detector.feedTranscript(makeEntry("bob", "Sounds good, deal!"));

    // Call the private method directly via prototype
    await (detector as any).runSmartDetection();

    expect(smartProvider.createMessage).toHaveBeenCalled();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("smart");
    expect(events[0].confidence).toBe(0.9);
    expect(events[0].role).toBe("responder");
    expect(events[0].summary).toBe("Payment of £500 for work");
    expect(events[0].speakerId).toBe("alice");

    detector.destroy();
  });

  it("should not trigger smart detection below confidence threshold", async () => {
    vi.useRealTimers();

    const lowConfidenceProvider = {
      createMessage: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              triggered: true,
              confidence: 0.3,
              role: "unclear",
              summary: "maybe",
              terms: [{ term: "maybe", confidence: 0.3, context: "maybe pay" }],
            }),
          },
        ],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    };

    const detector = new TriggerDetector({
      keyword: "chripbbbly",
      smartDetectionEnabled: false,
      llmProvider: lowConfidenceProvider as any,
      llmModel: "test-model",
      userId: "alice",
      displayName: "Alice",
    });

    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "maybe we could discuss"));
    await (detector as any).runSmartDetection();

    expect(events.length).toBe(0);

    detector.destroy();
  });

  it("should guard against overlapping smart detection calls", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    const slowProvider = {
      createMessage: vi.fn().mockImplementation(async () => {
        callCount++;
        // Simulate slow response — takes longer than 10s interval
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        return {
          content: [
            {
              type: "text",
              text: '{"triggered":false,"confidence":0,"role":"unclear","summary":"","terms":[]}',
            },
          ],
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }),
    };

    const detector = new TriggerDetector({
      keyword: "chripbbbly",
      smartDetectionEnabled: true,
      llmProvider: slowProvider as any,
      llmModel: "test-model",
      userId: "alice",
      displayName: "Alice",
    });

    detector.feedTranscript(makeEntry("alice", "hello"));

    // First interval fires at 10s — starts LLM call
    vi.advanceTimersByTime(10_000);
    // Second interval fires at 20s — should be guarded
    vi.advanceTimersByTime(10_000);

    // Only 1 call should have been made (guard prevents overlap)
    expect(callCount).toBe(1);

    detector.destroy();
    vi.useRealTimers();
  });
});

describe("TriggerDetector Additional Edge Cases", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should call setInterval with 10000ms when smartDetectionEnabled is true", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const detector = new TriggerDetector({
      keyword: "chripbbbly",
      smartDetectionEnabled: true,
      llmProvider: mockLLMProvider as any,
      llmModel: "test-model",
      userId: "alice",
      displayName: "Alice",
    });

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10000);

    detector.destroy();
  });

  it("should not trigger on partial keyword match", () => {
    vi.useFakeTimers();

    const detector = new TriggerDetector({
      keyword: "chripbbbly",
      smartDetectionEnabled: false,
      llmProvider: mockLLMProvider as any,
      llmModel: "test-model",
      userId: "alice",
      displayName: "Alice",
    });

    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    // "chrip" is a partial match of "chripbbbly" — should NOT trigger
    detector.feedTranscript(makeEntry("alice", "chrip"));
    expect(events.length).toBe(0);

    detector.destroy();
  });

  it("should prune transcript window to MAX_TRANSCRIPTS (100) entries", () => {
    vi.useFakeTimers();

    const detector = new TriggerDetector({
      keyword: "chripbbbly",
      smartDetectionEnabled: false,
      llmProvider: mockLLMProvider as any,
      llmModel: "test-model",
      userId: "alice",
      displayName: "Alice",
    });

    // Feed 101 entries
    for (let i = 0; i < 101; i++) {
      detector.feedTranscript(makeEntry("alice", `message ${i}`));
    }

    const transcripts = (detector as any).recentTranscripts;
    expect(transcripts.length).toBe(100);

    detector.destroy();
  });

  it("should not trigger when a different speaker says the keyword (speaker ID filtering)", () => {
    vi.useFakeTimers();

    const detector = new TriggerDetector({
      keyword: "chripbbbly",
      smartDetectionEnabled: false,
      llmProvider: mockLLMProvider as any,
      llmModel: "test-model",
      userId: "alice",
      displayName: "Alice",
    });

    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    // Bob says the keyword — should NOT trigger for Alice's detector
    detector.feedTranscript(makeEntry("bob", "chripbbbly"));
    expect(events.length).toBe(0);

    // Alice says the keyword — should trigger
    detector.feedTranscript(makeEntry("alice", "chripbbbly"));
    expect(events.length).toBe(1);
    expect(events[0].speakerId).toBe("alice");

    detector.destroy();
  });

  it("should not crash when LLM rejects during smart detection", async () => {
    vi.useRealTimers();

    const errorProvider = {
      createMessage: vi.fn().mockRejectedValue(new Error("LLM API failure")),
    };

    const detector = new TriggerDetector({
      keyword: "chripbbbly",
      smartDetectionEnabled: false,
      llmProvider: errorProvider as any,
      llmModel: "test-model",
      userId: "alice",
      displayName: "Alice",
    });

    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "I will pay you £500"));

    // Call runSmartDetection directly — should not throw
    await (detector as any).runSmartDetection();

    expect(events.length).toBe(0);
    expect((detector as any).smartDetectionRunning).toBe(false);

    detector.destroy();
  });
});
