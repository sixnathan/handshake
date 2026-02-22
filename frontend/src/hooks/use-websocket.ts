import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useTranscriptStore } from "@/stores/transcript-store";
import {
  useTimelineStore,
  type TimelineNodeType,
} from "@/stores/timeline-store";
import {
  useDocumentStore,
  type LegalDocument,
  type Milestone,
} from "@/stores/document-store";
import {
  useVerificationStore,
  type VerificationResult,
} from "@/stores/verification-store";
import { derivePeerName, currencySymbol } from "@/lib/utils";
import { saveContract } from "@/hooks/use-profile";

// ── Timeline filter: only important events ────

function shouldIncludeAgentMessage(text: string): boolean {
  // Show key tool results, hide noisy ones
  if (/^\[Tool:/i.test(text)) {
    if (
      /^\[Tool: (send_message_to_user|analyze_and_propose|evaluate_proposal|generate_document|complete_milestone)\]/i.test(
        text,
      )
    )
      return true;
    return false;
  }
  // Show all free-text agent messages (reasoning, analysis, waiting, etc.)
  return true;
}

export function usePanelWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const userId = useSessionStore((s) => s.userId);
  const roomId = useSessionStore((s) => s.roomId);

  useEffect(() => {
    if (!userId || !roomId) return;

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws/panels?room=${encodeURIComponent(roomId)}&user=${encodeURIComponent(userId)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      const profile = useSessionStore.getState().displayName;

      // Send set_profile BEFORE join_room so the server initializes the agent correctly
      try {
        const saved = localStorage.getItem("handshake_profile");
        if (saved) {
          const profileData = JSON.parse(saved);
          ws.send(
            JSON.stringify({
              type: "set_profile",
              profile: { ...profileData, displayName: profile },
            }),
          );
        }
      } catch {
        /* ignore */
      }

      ws.send(JSON.stringify({ type: "join_room", roomId }));
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        handlePanelMessage(msg, userId);
      } catch {
        /* malformed */
      }
    });

    ws.addEventListener("close", () => {
      useTranscriptStore.getState().reset();
      useTimelineStore.getState().reset();
      useDocumentStore.getState().reset();
      useVerificationStore.getState().reset();
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [userId, roomId]);

  return wsRef;
}

function handlePanelMessage(
  msg: Record<string, unknown>,
  userId: string,
): void {
  const panel = msg.panel as string;

  switch (panel) {
    case "transcript":
      handleTranscript(msg, userId);
      break;
    case "agent":
      handleAgent(msg);
      break;
    case "negotiation":
      handleNegotiation(msg);
      break;
    case "document":
      handleDocument(msg);
      break;
    case "milestone":
      handleMilestoneMsg(msg);
      break;
    case "verification":
      handleVerification(msg);
      break;
    case "execution":
      handleExecution(msg);
      break;
    case "status":
      handleStatus(msg, userId);
      break;
    case "payment_receipt":
      handlePaymentReceipt(msg);
      break;
    case "error":
      handleError(msg);
      break;
  }
}

function handleTranscript(msg: Record<string, unknown>, userId: string): void {
  const entry = msg.entry as {
    speaker: string;
    text: string;
    timestamp?: number;
    isFinal: boolean;
    source?: string;
  };
  const isLocal = entry.speaker === userId;
  const timestamp = entry.timestamp ?? Date.now();

  if (!entry.isFinal) {
    useTranscriptStore.getState().setPartial(entry.speaker, {
      speaker: entry.speaker,
      text: entry.text,
      timestamp,
      isLocal,
      isFinal: false,
    });
    return;
  }

  useTranscriptStore.getState().addFinal({
    speaker: entry.speaker,
    text: entry.text,
    timestamp,
    isLocal,
    isFinal: true,
  });
}

function handleAgent(msg: Record<string, unknown>): void {
  const text = msg.text as string;

  if (!shouldIncludeAgentMessage(text)) return;

  const type: TimelineNodeType = "message";
  let displayText = text;

  if (displayText.length > 100) displayText = displayText.slice(0, 97) + "...";

  useTimelineStore.getState().addNode({
    type,
    text: displayText,
    timestamp: Date.now(),
  });
}

function handleNegotiation(msg: Record<string, unknown>): void {
  const neg = msg.negotiation as {
    status: string;
    rounds: unknown[];
    maxRounds: number;
    currentProposal?: { totalAmount: number };
  };

  const statusMap: Record<string, TimelineNodeType> = {
    proposed: "propose",
    countering: "counter",
    accepted: "accept",
    rejected: "reject",
    executing: "pay",
  };

  const type = statusMap[neg.status] ?? "message";
  const amount = neg.currentProposal
    ? ` \u00A3${(neg.currentProposal.totalAmount / 100).toFixed(2)}`
    : "";
  const text = `${neg.status.toUpperCase()} (Round ${neg.rounds.length}/${neg.maxRounds})${amount}`;

  useTimelineStore.getState().addNode({ type, text, timestamp: Date.now() });

  // Update session status text
  const statusTextMap: Record<string, string> = {
    proposed: "Negotiating...",
    countering: "Counter-proposal...",
    accepted: "Agreement reached",
    rejected: "Proposal rejected",
    executing: "Processing payment...",
  };
  const statusText = statusTextMap[neg.status];
  if (statusText) {
    useSessionStore.getState().setSessionStatus(statusText);
  }
}

function handleDocument(msg: Record<string, unknown>): void {
  const doc = msg.document as LegalDocument;
  const transcriptEntries = useTranscriptStore.getState().entries;
  const history = transcriptEntries.map((e) => ({
    speaker: e.speaker,
    text: e.text,
    timestamp: e.timestamp,
  }));
  saveContract(doc, history.length > 0 ? history : undefined);

  useTimelineStore.getState().addNode({
    type: "doc",
    text: `Document: ${doc.title}`,
    timestamp: Date.now(),
  });

  useDocumentStore.getState().setDocument(doc);
  useSessionStore.getState().setSessionStatus("Document ready for signing");
}

function handleMilestoneMsg(msg: Record<string, unknown>): void {
  const ms = msg.milestone as Milestone;
  useDocumentStore.getState().updateMilestone(ms);

  const isComplete = ms.status === "completed";
  const type: TimelineNodeType = isComplete ? "pay" : "message";
  const text = isComplete
    ? `Milestone complete: ${ms.description}`
    : `Milestone: ${ms.description} (pending)`;

  useTimelineStore.getState().addNode({
    type,
    text: text.length > 100 ? text.slice(0, 97) + "..." : text,
    timestamp: Date.now(),
  });
}

function handleVerification(msg: Record<string, unknown>): void {
  const status = msg.status as string;
  const store = useVerificationStore.getState();

  if (status === "in_progress") {
    const step = msg.step as string | undefined;
    if (step) {
      store.addStep({
        text: step,
        timestamp: Date.now(),
        status: "in_progress",
      });
    }
    return;
  }

  if (status === "completed") {
    const result = msg.result as VerificationResult | undefined;
    if (result) {
      store.setResult(result);
    }

    // Update the contract in localStorage with milestone status
    const milestoneId = msg.milestoneId as string | undefined;
    const documentId = msg.documentId as string | undefined;
    if (milestoneId && documentId && result) {
      const milestone = useDocumentStore.getState().milestones.get(milestoneId);
      if (milestone) {
        const statusMap: Record<string, Milestone["status"]> = {
          passed: "completed",
          failed: "failed",
          disputed: "disputed",
        };
        const updated: Milestone = {
          ...milestone,
          status: statusMap[result.outcome] ?? "pending",
          verificationId: msg.verificationId as string | undefined,
          verificationResult: result,
          completedAt: result.outcome === "passed" ? Date.now() : undefined,
        };
        useDocumentStore.getState().updateMilestone(updated);
      }
    }
    return;
  }

  if (status === "error") {
    const message = msg.message as string | undefined;
    store.setError(message ?? "Verification failed");
  }
}

function handleExecution(msg: Record<string, unknown>): void {
  const step = msg.step as string;
  const status = msg.status as string;
  const details = msg.details as string | undefined;

  const isSign = step.toLowerCase().includes("signature");
  const type: TimelineNodeType = isSign ? "sign" : "pay";
  let text = `${step}: ${status}${details ? " \u2014 " + details : ""}`;
  if (text.length > 100) text = text.slice(0, 97) + "...";

  useTimelineStore.getState().addNode({ type, text, timestamp: Date.now() });
}

function handlePaymentReceipt(msg: Record<string, unknown>): void {
  const amount = msg.amount as number;
  const status = msg.status as string;
  const description = (msg.description as string) ?? "Payment";
  const currency = (msg.currency as string) ?? "gbp";

  const symbol = currencySymbol(currency);
  const type: TimelineNodeType = status === "succeeded" ? "pay" : "reject";
  let text = `Payment ${status}: ${symbol}${(amount / 100).toFixed(2)} — ${description}`;
  if (text.length > 100) text = text.slice(0, 97) + "...";

  useTimelineStore.getState().addNode({ type, text, timestamp: Date.now() });
}

function handleStatus(msg: Record<string, unknown>, userId: string): void {
  const users = msg.users as string[] | undefined;

  if (users && users.length >= 2) {
    const peer = users.find((u) => u !== userId);
    if (peer) {
      const peerName = derivePeerName(peer);
      useSessionStore.getState().setPeer(peer, peerName);
    }
    useSessionStore.getState().setSessionStatus("Listening...");
  } else {
    useSessionStore.getState().clearPeer();
    useSessionStore.getState().setSessionStatus("Waiting...");
  }
}

function handleError(msg: Record<string, unknown>): void {
  const message = msg.message as string;
  useSessionStore.getState().setSessionStatus(`Error: ${message}`);
}
