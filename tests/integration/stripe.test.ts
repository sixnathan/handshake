import { describe, it, expect, beforeAll } from "vitest";
import { PaymentService } from "../../src/services/payment.js";
import { loadConfig } from "../../src/config.js";
import type { AppConfig } from "../../src/types.js";

describe("Stripe Integration (real API)", () => {
  let payment: PaymentService;
  let config: AppConfig;

  beforeAll(() => {
    config = loadConfig();
    payment = new PaymentService({
      secretKey: config.stripe.secretKey,
      platformAccountId: config.stripe.platformAccountId,
    });
  });

  it("should validate that Stripe key is a test key", () => {
    expect(config.stripe.secretKey).toMatch(/^sk_test_/);
  });

  it("should reject payment with amount <= 0", async () => {
    const result = await payment.executePayment({
      amount: 0,
      currency: "gbp",
      description: "Test zero amount",
      recipientAccountId: "acct_test",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("amount must be greater than 0");
  });

  it("should reject payment with empty currency", async () => {
    const result = await payment.executePayment({
      amount: 1000,
      currency: "",
      description: "Test no currency",
      recipientAccountId: "acct_test",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("currency is required");
  });

  it("should reject payment with empty recipientAccountId", async () => {
    const result = await payment.executePayment({
      amount: 1000,
      currency: "gbp",
      description: "Test no recipient",
      recipientAccountId: "",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("recipientAccountId is required");
  });

  it("should fail gracefully with invalid recipient account", async () => {
    const result = await payment.executePayment({
      amount: 100,
      currency: "gbp",
      description: "Integration test",
      recipientAccountId: "acct_nonexistent_12345",
    });
    // Stripe will reject invalid account — should get error, not crash
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should reject escrow hold with invalid amount", async () => {
    await expect(
      payment.createEscrowHold({
        amount: -500,
        currency: "gbp",
        description: "Negative escrow",
        recipientAccountId: "acct_test",
      }),
    ).rejects.toThrow("amount must be greater than 0");
  });

  it("should return error for capturing nonexistent hold", async () => {
    const result = await payment.captureEscrow("pi_nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Escrow hold not found");
  });

  it("should return error for releasing nonexistent hold", async () => {
    const result = await payment.releaseEscrow("pi_nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Escrow hold not found");
  });
});
