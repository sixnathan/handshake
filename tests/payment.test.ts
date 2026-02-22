import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentService } from "../src/services/payment.js";

describe("PaymentService Module", () => {
  let payment: PaymentService;
  let stripeMock: any;

  beforeEach(() => {
    payment = new PaymentService({
      secretKey: "sk_test_123",
      platformAccountId: "acct_platform",
    });

    // Override the internal stripe instance with a mock
    stripeMock = {
      paymentIntents: {
        create: vi.fn().mockResolvedValue({
          id: "pi_test_123",
          transfer_data: { destination: "acct_bob" },
        }),
        capture: vi.fn().mockResolvedValue({ id: "pi_test_123" }),
        cancel: vi.fn().mockResolvedValue({ id: "pi_test_123" }),
      },
    };
    (payment as any).stripe = stripeMock;
  });

  describe("validateRequest", () => {
    it("should reject amount <= 0", async () => {
      const result = await payment.executePayment({
        amount: 0,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("amount must be greater than 0");
    });

    it("should reject negative amount", async () => {
      const result = await payment.executePayment({
        amount: -100,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty currency", async () => {
      const result = await payment.executePayment({
        amount: 1000,
        currency: "",
        description: "Test",
        recipientAccountId: "acct_bob",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("currency is required");
    });

    it("should reject empty recipientAccountId", async () => {
      const result = await payment.executePayment({
        amount: 1000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("recipientAccountId is required");
    });
  });

  describe("executePayment", () => {
    it("should call stripe.paymentIntents.create with correct params", async () => {
      const result = await payment.executePayment({
        amount: 15000,
        currency: "gbp",
        description: "Boiler repair",
        recipientAccountId: "acct_bob",
      });

      expect(result.success).toBe(true);
      expect(result.paymentIntentId).toBe("pi_test_123");
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
        {
          amount: 15000,
          currency: "gbp",
          description: "Boiler repair",
          transfer_data: { destination: "acct_bob" },
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
          confirm: true,
        },
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      );
    });

    it("should handle Stripe API errors gracefully", async () => {
      stripeMock.paymentIntents.create.mockRejectedValueOnce(
        new Error("Card declined"),
      );
      const result = await payment.executePayment({
        amount: 1000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Card declined");
    });
  });

  describe("createEscrowHold", () => {
    it("should create escrow with manual capture", async () => {
      const hold = await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Parts deposit",
        recipientAccountId: "acct_bob",
      });

      expect(hold.holdId).toBe("pi_test_123");
      expect(hold.amount).toBe(5000);
      expect(hold.status).toBe("held");
      expect(hold.currency).toBe("gbp");

      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          capture_method: "manual",
          description: "Escrow: Parts deposit",
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      );
    });

    it("should throw on invalid escrow request", async () => {
      await expect(
        payment.createEscrowHold({
          amount: -100,
          currency: "gbp",
          description: "Test",
          recipientAccountId: "acct_bob",
        }),
      ).rejects.toThrow("amount must be greater than 0");
    });

    it("should store escrow hold for later capture", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });

      const result = await payment.captureEscrow("pi_test_123");
      expect(result.success).toBe(true);
    });
  });

  describe("captureEscrow", () => {
    it("should capture full amount", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });

      const result = await payment.captureEscrow("pi_test_123");
      expect(result.success).toBe(true);
      expect(stripeMock.paymentIntents.capture).toHaveBeenCalledWith(
        "pi_test_123",
        {},
      );
    });

    it("should support partial capture", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });

      const result = await payment.captureEscrow("pi_test_123", 3000);
      expect(result.success).toBe(true);
      expect(stripeMock.paymentIntents.capture).toHaveBeenCalledWith(
        "pi_test_123",
        {
          amount_to_capture: 3000,
        },
      );
    });

    it("should return error for non-existent hold", async () => {
      const result = await payment.captureEscrow("pi_nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return error for already captured hold", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });
      await payment.captureEscrow("pi_test_123");

      const result = await payment.captureEscrow("pi_test_123");
      expect(result.success).toBe(false);
      expect(result.error).toContain("already captured");
    });

    it("should handle Stripe capture failure", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });

      stripeMock.paymentIntents.capture.mockRejectedValueOnce(
        new Error("Capture expired"),
      );

      const result = await payment.captureEscrow("pi_test_123");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Capture expired");
    });
  });

  describe("releaseEscrow", () => {
    it("should release held escrow", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });

      const result = await payment.releaseEscrow("pi_test_123");
      expect(result.success).toBe(true);
      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith(
        "pi_test_123",
      );
    });

    it("should return error for non-existent hold", async () => {
      const result = await payment.releaseEscrow("pi_nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return error for already released hold", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });
      await payment.releaseEscrow("pi_test_123");

      const result = await payment.releaseEscrow("pi_test_123");
      expect(result.success).toBe(false);
      expect(result.error).toContain("already released");
    });

    it("should not release already captured hold", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });
      await payment.captureEscrow("pi_test_123");

      const result = await payment.releaseEscrow("pi_test_123");
      expect(result.success).toBe(false);
      expect(result.error).toContain("already captured");
    });

    it("should handle Stripe cancel failure", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });

      stripeMock.paymentIntents.cancel.mockRejectedValueOnce(
        new Error("Network error"),
      );

      const result = await payment.releaseEscrow("pi_test_123");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });

  describe("escrow state transitions", () => {
    it("should return error on double-capture of same hold", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });

      const first = await payment.captureEscrow("pi_test_123");
      expect(first.success).toBe(true);

      const second = await payment.captureEscrow("pi_test_123");
      expect(second.success).toBe(false);
      expect(second.error).toContain("already captured");
    });

    it("should return error on double-release of same hold", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });

      const first = await payment.releaseEscrow("pi_test_123");
      expect(first.success).toBe(true);

      const second = await payment.releaseEscrow("pi_test_123");
      expect(second.success).toBe(false);
      expect(second.error).toContain("already released");
    });

    it("should return error when capturing after release", async () => {
      await payment.createEscrowHold({
        amount: 5000,
        currency: "gbp",
        description: "Test",
        recipientAccountId: "acct_bob",
      });

      const release = await payment.releaseEscrow("pi_test_123");
      expect(release.success).toBe(true);

      const capture = await payment.captureEscrow("pi_test_123");
      expect(capture.success).toBe(false);
      expect(capture.error).toContain("already released");
    });

    it("should call Stripe with correct amount for very large payment", async () => {
      const result = await payment.executePayment({
        amount: 99999999,
        currency: "gbp",
        description: "Very large payment",
        recipientAccountId: "acct_bob",
      });

      expect(result.success).toBe(true);
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 99999999,
          currency: "gbp",
          description: "Very large payment",
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      );
    });
  });
});
