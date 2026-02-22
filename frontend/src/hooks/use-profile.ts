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
  delete toSave.contextDocuments;
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

// ── Contract persistence ──────────────────────

const CONTRACTS_KEY = "handshake_contracts";
const MAX_CONTRACTS = 10;
const MAX_CONTRACT_SIZE = 51200;

export function saveContract(
  doc: unknown,
  transcript?: { speaker: string; text: string; timestamp: number }[],
): void {
  try {
    const contracts = JSON.parse(
      localStorage.getItem(CONTRACTS_KEY) ?? "[]",
    ) as Record<string, unknown>[];
    const docObj = doc as Record<string, unknown> & { id: string };

    // Attach transcript if provided and not already present
    const toSave =
      transcript && transcript.length > 0
        ? { ...docObj, conversationHistory: transcript }
        : docObj;

    const idx = contracts.findIndex(
      (c) => (c as { id: string }).id === docObj.id,
    );
    if (idx >= 0) {
      // Preserve existing conversation history on updates
      const existing = contracts[idx] as Record<string, unknown>;
      const merged = {
        ...toSave,
        conversationHistory:
          toSave.conversationHistory ?? existing.conversationHistory,
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
