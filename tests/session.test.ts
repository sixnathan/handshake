import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionService } from "../src/services/session.js";
import type { TranscriptEntry, SessionStatus } from "../src/types.js";

function makeEntry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: "test-1",
    speaker: "user-a",
    text: "hello world",
    timestamp: Date.now(),
    isFinal: true,
    source: "local",
    ...overrides,
  };
}

describe("SessionService Module", () => {
  let session: SessionService;

  beforeEach(() => {
    session = new SessionService();
  });

  it("should start with 'discovering' status", () => {
    expect(session.getStatus()).toBe("discovering");
  });

  it("should change status and emit event", () => {
    const statuses: SessionStatus[] = [];
    session.on("status_changed", (s) => statuses.push(s));

    session.setStatus("active");
    expect(session.getStatus()).toBe("active");
    expect(statuses).toEqual(["active"]);
  });

  it("should add transcript entries immutably", () => {
    const entry = makeEntry();
    session.addTranscript(entry);

    const transcripts = session.getTranscripts();
    expect(transcripts.length).toBe(1);
    expect(transcripts[0]).toEqual(entry);
  });

  it("should emit transcript event on addTranscript", () => {
    const entries: TranscriptEntry[] = [];
    session.on("transcript", (e) => entries.push(e));

    const entry = makeEntry();
    session.addTranscript(entry);
    expect(entries).toEqual([entry]);
  });

  it("should return readonly transcripts array", () => {
    session.addTranscript(makeEntry());
    const transcripts = session.getTranscripts();
    // TypeScript readonly check — runtime array is still JS array
    expect(Array.isArray(transcripts)).toBe(true);
  });

  it("should build transcript text from final entries only", () => {
    session.addTranscript(
      makeEntry({ text: "hello", speaker: "alice", isFinal: true }),
    );
    session.addTranscript(
      makeEntry({ text: "partial...", speaker: "bob", isFinal: false }),
    );
    session.addTranscript(
      makeEntry({ text: "goodbye", speaker: "bob", isFinal: true }),
    );

    const text = session.getTranscriptText();
    expect(text).toBe("alice: hello\nbob: goodbye");
  });

  it("should return recent transcript text within time window", () => {
    vi.useFakeTimers();
    const now = Date.now();

    session.addTranscript(
      makeEntry({ text: "old", speaker: "alice", timestamp: now - 60000 }),
    );
    session.addTranscript(
      makeEntry({ text: "new", speaker: "bob", timestamp: now }),
    );

    const recent = session.getRecentTranscriptText(30000);
    expect(recent).toBe("bob: new");
    expect(recent).not.toContain("old");

    vi.useRealTimers();
  });

  it("should reset to initial state", () => {
    session.addTranscript(makeEntry());
    session.setStatus("negotiating");

    const statuses: SessionStatus[] = [];
    session.on("status_changed", (s) => statuses.push(s));

    session.reset();
    expect(session.getStatus()).toBe("discovering");
    expect(session.getTranscripts().length).toBe(0);
    expect(statuses).toContain("discovering");
  });

  it("should handle multiple status transitions", () => {
    const statuses: SessionStatus[] = [];
    session.on("status_changed", (s) => statuses.push(s));

    session.setStatus("active");
    session.setStatus("negotiating");
    session.setStatus("signing");
    session.setStatus("completed");

    expect(statuses).toEqual(["active", "negotiating", "signing", "completed"]);
  });

  it("should return empty string for getTranscriptText with no entries", () => {
    expect(session.getTranscriptText()).toBe("");
  });
});
