import { describe, it, expect, beforeEach } from "vitest";
import { ProfileManager } from "../src/services/profile-manager.js";
import type { AgentProfile } from "../src/types.js";

function validProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    displayName: "Alice",
    role: "plumber",
    customInstructions: "Be nice",
    preferences: {
      maxAutoApproveAmount: 5000,
      preferredCurrency: "gbp",
      escrowPreference: "above_threshold",
      escrowThreshold: 10000,
      negotiationStyle: "balanced",
    },
    ...overrides,
  };
}

describe("ProfileManager Module", () => {
  let pm: ProfileManager;

  beforeEach(() => {
    pm = new ProfileManager();
  });

  it("should store and retrieve a profile", () => {
    pm.setProfile("user-1", validProfile());
    const profile = pm.getProfile("user-1");
    expect(profile).toBeDefined();
    expect(profile!.displayName).toBe("Alice");
  });

  it("should return undefined for unknown user", () => {
    expect(pm.getProfile("unknown")).toBeUndefined();
  });

  it("should return defensive copy (immutable)", () => {
    pm.setProfile("user-1", validProfile());
    const copy1 = pm.getProfile("user-1");
    const copy2 = pm.getProfile("user-1");
    expect(copy1).not.toBe(copy2);
    expect(copy1).toEqual(copy2);
  });

  it("should generate default profile", () => {
    const profile = pm.getDefaultProfile("user-x");
    expect(profile.displayName).toBe("user-x");
    expect(profile.role).toBe("participant");
    expect(profile.preferences.negotiationStyle).toBe("balanced");
    expect(profile.preferences.maxAutoApproveAmount).toBe(5000);
  });

  it("should remove a profile", () => {
    pm.setProfile("user-1", validProfile());
    pm.removeProfile("user-1");
    expect(pm.getProfile("user-1")).toBeUndefined();
  });

  it("should throw on empty displayName", () => {
    expect(() =>
      pm.setProfile("user-1", validProfile({ displayName: "" })),
    ).toThrow("displayName is required");
  });

  it("should throw on whitespace-only displayName", () => {
    expect(() =>
      pm.setProfile("user-1", validProfile({ displayName: "   " })),
    ).toThrow("displayName is required");
  });

  it("should truncate displayName to 100 chars", () => {
    const longName = "a".repeat(200);
    pm.setProfile("user-1", validProfile({ displayName: longName }));
    expect(pm.getProfile("user-1")!.displayName.length).toBe(100);
  });

  it("should truncate customInstructions to 2000 chars", () => {
    const longInstructions = "a".repeat(3000);
    pm.setProfile(
      "user-1",
      validProfile({ customInstructions: longInstructions }),
    );
    expect(pm.getProfile("user-1")!.customInstructions.length).toBe(2000);
  });

  it("should default role to 'participant' when empty", () => {
    pm.setProfile("user-1", validProfile({ role: "" }));
    expect(pm.getProfile("user-1")!.role).toBe("participant");
  });

  it("should validate stripeAccountId format", () => {
    pm.setProfile("user-1", validProfile({ stripeAccountId: "acct_12345" }));
    expect(pm.getProfile("user-1")!.stripeAccountId).toBe("acct_12345");
  });

  it("should reject invalid stripeAccountId", () => {
    pm.setProfile("user-1", validProfile({ stripeAccountId: "invalid" }));
    expect(pm.getProfile("user-1")!.stripeAccountId).toBeUndefined();
  });

  it("should accept valid monzoAccessToken", () => {
    pm.setProfile("user-1", validProfile({ monzoAccessToken: "some-token" }));
    expect(pm.getProfile("user-1")!.monzoAccessToken).toBe("some-token");
  });

  it("should reject empty monzoAccessToken", () => {
    pm.setProfile("user-1", validProfile({ monzoAccessToken: "" }));
    expect(pm.getProfile("user-1")!.monzoAccessToken).toBeUndefined();
  });

  it("should validate preferredCurrency as 3-letter string", () => {
    pm.setProfile(
      "user-1",
      validProfile({
        preferences: {
          ...validProfile().preferences,
          preferredCurrency: "usd",
        },
      }),
    );
    expect(pm.getProfile("user-1")!.preferences.preferredCurrency).toBe("usd");
  });

  it("should default invalid preferredCurrency to 'gbp'", () => {
    pm.setProfile(
      "user-1",
      validProfile({
        preferences: {
          ...validProfile().preferences,
          preferredCurrency: "invalid-currency" as string,
        },
      }),
    );
    expect(pm.getProfile("user-1")!.preferences.preferredCurrency).toBe("gbp");
  });

  it("should validate escrowPreference enum", () => {
    pm.setProfile(
      "user-1",
      validProfile({
        preferences: {
          ...validProfile().preferences,
          escrowPreference: "always",
        },
      }),
    );
    expect(pm.getProfile("user-1")!.preferences.escrowPreference).toBe(
      "always",
    );
  });

  it("should default invalid escrowPreference to 'above_threshold'", () => {
    pm.setProfile(
      "user-1",
      validProfile({
        preferences: {
          ...validProfile().preferences,
          escrowPreference: "invalid" as "always",
        },
      }),
    );
    expect(pm.getProfile("user-1")!.preferences.escrowPreference).toBe(
      "above_threshold",
    );
  });

  it("should default negative maxAutoApproveAmount to 0", () => {
    pm.setProfile(
      "user-1",
      validProfile({
        preferences: {
          ...validProfile().preferences,
          maxAutoApproveAmount: -100,
        },
      }),
    );
    expect(pm.getProfile("user-1")!.preferences.maxAutoApproveAmount).toBe(0);
  });
});
