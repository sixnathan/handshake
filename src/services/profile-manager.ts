import type { UserId, AgentProfile, AgentPreferences } from "../types.js";
import type { IProfileManager } from "../interfaces.js";

export class ProfileManager implements IProfileManager {
  private profiles = new Map<UserId, AgentProfile>();

  setProfile(userId: UserId, profile: AgentProfile): void {
    this.profiles.set(userId, this.validate(profile));
  }

  getProfile(userId: UserId): AgentProfile | undefined {
    const profile = this.profiles.get(userId);
    if (!profile) return undefined;
    return { ...profile, preferences: { ...profile.preferences } };
  }

  getDefaultProfile(userId: UserId): AgentProfile {
    return {
      displayName: userId,
      role: "participant",
      customInstructions: "",
      preferences: {
        maxAutoApproveAmount: 5000,
        preferredCurrency: "gbp",
        escrowPreference: "above_threshold",
        escrowThreshold: 10000,
        negotiationStyle: "balanced",
      },
    };
  }

  removeProfile(userId: UserId): void {
    this.profiles.delete(userId);
  }

  private validate(input: AgentProfile): AgentProfile {
    const displayName = (input.displayName ?? "").trim().slice(0, 100);
    if (!displayName) throw new Error("displayName is required");

    const role =
      (input.role ?? "participant").trim().slice(0, 100) || "participant";
    const customInstructions = (input.customInstructions ?? "").slice(0, 2000);

    const prefs: Partial<AgentPreferences> = input.preferences ?? {};
    const maxAutoApproveAmount =
      Number(prefs.maxAutoApproveAmount) >= 0
        ? Number(prefs.maxAutoApproveAmount)
        : 0;
    const preferredCurrency =
      typeof prefs.preferredCurrency === "string" &&
      prefs.preferredCurrency.length === 3
        ? prefs.preferredCurrency.toLowerCase()
        : "gbp";
    const escrowPreference = (
      ["always", "above_threshold", "never"] as const
    ).includes(prefs.escrowPreference as "always")
      ? (prefs.escrowPreference as AgentPreferences["escrowPreference"])
      : "above_threshold";
    const escrowThreshold =
      Number(prefs.escrowThreshold) >= 0 ? Number(prefs.escrowThreshold) : 0;
    const negotiationStyle = (
      ["aggressive", "balanced", "conservative"] as const
    ).includes(prefs.negotiationStyle as "balanced")
      ? (prefs.negotiationStyle as AgentPreferences["negotiationStyle"])
      : "balanced";

    const stripeAccountId =
      typeof input.stripeAccountId === "string" &&
      input.stripeAccountId.startsWith("acct_")
        ? input.stripeAccountId
        : undefined;

    const monzoAccessToken =
      typeof input.monzoAccessToken === "string" &&
      input.monzoAccessToken.length > 0
        ? input.monzoAccessToken
        : undefined;

    return {
      displayName,
      role,
      customInstructions,
      preferences: {
        maxAutoApproveAmount,
        preferredCurrency,
        escrowPreference,
        escrowThreshold,
        negotiationStyle,
      },
      stripeAccountId,
      monzoAccessToken,
    };
  }
}
