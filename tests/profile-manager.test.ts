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

describe("ProfileManager — contextDocuments and optional fields", () => {
  let pm: ProfileManager;

  beforeEach(() => {
    pm = new ProfileManager();
  });

  it("should accept exactly 5 context documents at 5KB each (boundary)", () => {
    const docs = Array.from({ length: 5 }, (_, i) => "x".repeat(5120));
    pm.setProfile("user-1", validProfile({ contextDocuments: docs }));
    const profile = pm.getProfile("user-1")!;
    expect(profile.contextDocuments).toHaveLength(5);
    expect(profile.contextDocuments![0].length).toBe(5120);
  });

  it("should truncate to 5 context documents when 6 are provided", () => {
    const docs = Array.from({ length: 6 }, (_, i) => `Document ${i}`);
    pm.setProfile("user-1", validProfile({ contextDocuments: docs }));
    const profile = pm.getProfile("user-1")!;
    expect(profile.contextDocuments).toHaveLength(5);
    expect(profile.contextDocuments![4]).toBe("Document 4");
  });

  it("should discard typicalRateRange when min > max", () => {
    pm.setProfile(
      "user-1",
      validProfile({
        typicalRateRange: { min: 500, max: 100, unit: "hour" },
      }),
    );
    const profile = pm.getProfile("user-1")!;
    expect(profile.typicalRateRange).toBeUndefined();
  });

  it("should truncate very long trade string to 100 chars", () => {
    const longTrade = "a".repeat(10000);
    pm.setProfile("user-1", validProfile({ trade: longTrade }));
    const profile = pm.getProfile("user-1")!;
    expect(profile.trade).toBeDefined();
    expect(profile.trade!.length).toBe(100);
  });

  it("should preserve all optional fields when populated", () => {
    pm.setProfile(
      "user-1",
      validProfile({
        trade: "Electrician",
        experienceYears: 15,
        certifications: ["NVQ Level 3", "Part P"],
        typicalRateRange: { min: 4000, max: 8000, unit: "day" },
        serviceArea: "Greater London",
        contextDocuments: ["Prior work agreement", "Insurance certificate"],
        stripeAccountId: "acct_test_123",
        monzoAccessToken: "tok_abc",
      }),
    );
    const profile = pm.getProfile("user-1")!;
    expect(profile.trade).toBe("Electrician");
    expect(profile.experienceYears).toBe(15);
    expect(profile.certifications).toEqual(["NVQ Level 3", "Part P"]);
    expect(profile.typicalRateRange).toEqual({
      min: 4000,
      max: 8000,
      unit: "day",
    });
    expect(profile.serviceArea).toBe("Greater London");
    expect(profile.contextDocuments).toEqual([
      "Prior work agreement",
      "Insurance certificate",
    ]);
    expect(profile.stripeAccountId).toBe("acct_test_123");
    expect(profile.monzoAccessToken).toBe("tok_abc");
  });
});
