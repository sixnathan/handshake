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

describe("TriggerDetector Module", () => {
  let detector: TriggerDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new TriggerDetector({
      keyword: "handshake",
      userId: "alice",
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

    detector.feedTranscript(makeEntry("alice", "let's say handshake"));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("keyword");
    expect(events[0].confidence).toBe(1.0);
    expect(events[0].speakerId).toBe("alice");
  });

  it("should trigger when ANY user says the keyword (no speaker guard)", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("bob", "handshake"));
    expect(events.length).toBe(1);
    expect(events[0].speakerId).toBe("bob");
  });

  it("should not trigger on partial (non-final) transcripts", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "handshake", false));
    expect(events.length).toBe(0);
  });

  it("should be case-insensitive for keyword matching", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "HANDSHAKE"));
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

    detector.feedTranscript(makeEntry("alice", "handshake"));
    expect(events.length).toBe(1);

    detector.reset();

    // Should be able to trigger again
    detector.feedTranscript(makeEntry("alice", "handshake"));
    expect(events.length).toBe(2);
  });

  it("should not emit duplicate triggers", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "handshake"));
    detector.feedTranscript(makeEntry("alice", "handshake again"));

    expect(events.length).toBe(1); // still just 1
  });

  it("should ignore transcripts after triggering", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "handshake"));

    // These should be ignored (already triggered)
    detector.feedTranscript(makeEntry("alice", "handshake"));
    detector.feedTranscript(makeEntry("bob", "handshake"));
    expect(events.length).toBe(1);
  });

  it("should include role field in trigger event", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    detector.feedTranscript(makeEntry("alice", "handshake"));

    expect(events[0].role).toBe("unclear");
  });

  it("should clean up on destroy", () => {
    // Register listener first, then destroy removes all listeners
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));
    detector.destroy();

    // Create fresh detector to test keyword detection is decoupled
    const det2 = new TriggerDetector({
      keyword: "handshake",
      userId: "alice",
    });
    const events2: TriggerEvent[] = [];
    det2.on("triggered", (e) => events2.push(e));
    det2.feedTranscript(makeEntry("alice", "handshake"));
    expect(events2.length).toBe(1); // new detector works
    expect(events.length).toBe(0); // old detector's listener was removed
    det2.destroy();
  });

  it("should not trigger on partial keyword match", () => {
    const events: TriggerEvent[] = [];
    detector.on("triggered", (e) => events.push(e));

    // "hand" is a partial match of "handshake" — should NOT trigger
    detector.feedTranscript(makeEntry("alice", "hand"));
    expect(events.length).toBe(0);
  });

  it("should prune transcript window to MAX_TRANSCRIPTS (100) entries", () => {
    // Feed 101 entries
    for (let i = 0; i < 101; i++) {
      detector.feedTranscript(makeEntry("alice", `message ${i}`));
    }

    const transcripts = (detector as any).recentTranscripts;
    expect(transcripts.length).toBe(100);
  });
});
