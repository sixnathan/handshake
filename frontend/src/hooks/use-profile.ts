import { useCallback } from "react";

const PROFILE_KEY = "handshake_profile";

export interface ProfileData {
  displayName: string;
  role: string;
  customInstructions: string;
  preferences: {
    maxAutoApproveAmount: number;
    preferredCurrency: string;
    escrowPreference: string;
    escrowThreshold: number;
    negotiationStyle: string;
  };
  stripeAccountId?: string;
  monzoAccessToken?: string;
  trade?: string;
  experienceYears?: number;
  certifications?: string[];
  typicalRateRange?: { min: number; max: number; unit: string };
  serviceArea?: string;
  contextDocuments?: string[];
}

export function loadProfile(): Partial<ProfileData> {
  try {
    const saved = localStorage.getItem(PROFILE_KEY);
    if (saved) return JSON.parse(saved) as Partial<ProfileData>;
  } catch {
    /* ignore */
  }
  return {};
}

export function saveProfile(profile: ProfileData): void {
  const toSave = { ...profile };
  delete toSave.monzoAccessToken;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(toSave));
  } catch {
    /* localStorage full */
  }
}

export function useProfile() {
  const load = useCallback(loadProfile, []);
  const save = useCallback(saveProfile, []);
  return { loadProfile: load, saveProfile: save };
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// ── Contract persistence ──────────────────────

const CONTRACTS_KEY = "handshake_contracts";
const MAX_CONTRACTS = 10;
const MAX_CONTRACT_SIZE = 51200;

export function saveContract(
  doc: unknown,
  transcript?: { speaker: string; text: string; timestamp: number }[],
  paymentEvents?: unknown[],
): void {
  try {
    const contracts = JSON.parse(
      localStorage.getItem(CONTRACTS_KEY) ?? "[]",
    ) as Record<string, unknown>[];
    const docObj = doc as Record<string, unknown> & { id: string };

    // Attach transcript and payment events if provided
    const toSave = {
      ...docObj,
      ...(transcript && transcript.length > 0
        ? { conversationHistory: transcript }
        : {}),
      ...(paymentEvents && paymentEvents.length > 0 ? { paymentEvents } : {}),
    };

    const idx = contracts.findIndex(
      (c) => (c as { id: string }).id === docObj.id,
    );
    if (idx >= 0) {
      // Preserve existing fields on updates
      const existing = contracts[idx] as Record<string, unknown>;
      const merged = {
        ...toSave,
        conversationHistory:
          toSave.conversationHistory ?? existing.conversationHistory,
        paymentEvents: toSave.paymentEvents ?? existing.paymentEvents,
      };
      const serialized = JSON.stringify(merged);
      if (serialized.length > MAX_CONTRACT_SIZE) return;
      contracts[idx] = merged;
    } else {
      const serialized = JSON.stringify(toSave);
      if (serialized.length > MAX_CONTRACT_SIZE) return;
      contracts.unshift(toSave);
    }
    while (contracts.length > MAX_CONTRACTS) contracts.pop();
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify(contracts));
  } catch {
    /* localStorage full */
  }
}

export function loadContracts(): unknown[] {
  try {
    return JSON.parse(localStorage.getItem(CONTRACTS_KEY) ?? "[]") as unknown[];
  } catch {
    return [];
  }
}

export function clearContracts(): void {
  localStorage.removeItem(CONTRACTS_KEY);
}

/** Update a milestone's status in a saved contract (localStorage). */
export function updateMilestoneStatus(
  documentId: string,
  milestoneId: string,
  status: string,
): void {
  try {
    const contracts = JSON.parse(
      localStorage.getItem(CONTRACTS_KEY) ?? "[]",
    ) as Record<string, unknown>[];
    const idx = contracts.findIndex(
      (c) => (c as { id: string }).id === documentId,
    );
    if (idx < 0) return;

    const contract = contracts[idx] as Record<string, unknown>;
    const milestones = contract.milestones as
      | Array<{ id: string; status: string; completedAt?: number }>
      | undefined;
    if (!milestones) return;

    const msIdx = milestones.findIndex((m) => m.id === milestoneId);
    if (msIdx < 0) return;

    const existing = milestones[msIdx]!;
    milestones[msIdx] = {
      ...existing,
      id: existing.id,
      status,
      completedAt: Date.now(),
    };
    contracts[idx] = { ...contract, milestones };
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify(contracts));
  } catch {
    /* ignore */
  }
}
