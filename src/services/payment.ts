import Stripe from "stripe";
import type { PaymentRequest, PaymentResult, EscrowHold } from "../types.js";
import type { IPaymentService } from "../interfaces.js";

export class PaymentService implements IPaymentService {
  private readonly stripe: Stripe;
  private escrowHolds = new Map<string, EscrowHold>();

  constructor(
    private readonly config: {
      secretKey: string;
      platformAccountId: string;
    },
  ) {
    this.stripe = new Stripe(config.secretKey);
  }

  async executePayment(request: PaymentRequest): Promise<PaymentResult> {
    const validationError = this.validateRequest(request);
    if (validationError) {
      return {
        success: false,
        error: `Invalid payment request: ${validationError}`,
      };
    }

    try {
      const params: Stripe.PaymentIntentCreateParams = {
        amount: request.amount,
        currency: request.currency,
        description: request.description,
        transfer_data: {
          destination: request.recipientAccountId,
        },
        confirm: true,
      };

      if (request.payerCustomerId) {
        params.customer = request.payerCustomerId;
        params.payment_method = "pm_card_visa";
      } else {
        params.automatic_payment_methods = {
          enabled: true,
          allow_redirects: "never",
        };
      }

      const idempotencyKey = `pay_${request.recipientAccountId}_${request.amount}_${Date.now()}`;
      const pi = await this.stripe.paymentIntents.create(params, {
        idempotencyKey,
      });

      return {
        success: true,
        paymentIntentId: pi.id,
        transferId: pi.transfer_data?.destination as string | undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Payment failed: ${message}` };
    }
  }

  async createEscrowHold(request: PaymentRequest): Promise<EscrowHold> {
    const validationError = this.validateRequest(request);
    if (validationError) {
      throw new Error(`Invalid escrow request: ${validationError}`);
    }

    const escrowParams: Stripe.PaymentIntentCreateParams = {
      amount: request.amount,
      currency: request.currency,
      description: `Escrow: ${request.description}`,
      transfer_data: {
        destination: request.recipientAccountId,
      },
      capture_method: "manual",
      confirm: true,
    };

    if (request.payerCustomerId) {
      escrowParams.customer = request.payerCustomerId;
      escrowParams.payment_method = "pm_card_visa";
    } else {
      escrowParams.automatic_payment_methods = {
        enabled: true,
        allow_redirects: "never",
      };
    }

    const escrowIdempotencyKey = `escrow_${request.recipientAccountId}_${request.amount}_${Date.now()}`;
    const pi = await this.stripe.paymentIntents.create(escrowParams, {
      idempotencyKey: escrowIdempotencyKey,
    });

    const hold: EscrowHold = {
      holdId: pi.id,
      amount: request.amount,
      currency: request.currency,
      status: "held",
      paymentIntentId: pi.id,
      recipientAccountId: request.recipientAccountId,
      createdAt: Date.now(),
    };

    this.escrowHolds.set(hold.holdId, hold);
    return hold;
  }

  async captureEscrow(holdId: string, amount?: number): Promise<PaymentResult> {
    const hold = this.escrowHolds.get(holdId);
    if (!hold) {
      return { success: false, error: "Escrow hold not found" };
    }
    if (hold.status !== "held") {
      return { success: false, error: `Escrow already ${hold.status}` };
    }

    try {
      const params: Stripe.PaymentIntentCaptureParams = {};
      if (amount !== undefined) {
        params.amount_to_capture = amount;
      }

      await this.stripe.paymentIntents.capture(holdId, params);
      this.escrowHolds.set(holdId, { ...hold, status: "captured" });
      return { success: true, paymentIntentId: holdId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Capture failed: ${message}` };
    }
  }

  async releaseEscrow(holdId: string): Promise<PaymentResult> {
    const hold = this.escrowHolds.get(holdId);
    if (!hold) {
      return { success: false, error: "Escrow hold not found" };
    }
    if (hold.status !== "held") {
      return { success: false, error: `Escrow already ${hold.status}` };
    }

    try {
      await this.stripe.paymentIntents.cancel(holdId);
      this.escrowHolds.set(holdId, { ...hold, status: "released" });
      return { success: true, paymentIntentId: holdId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Release failed: ${message}` };
    }
  }

  private validateRequest(request: PaymentRequest): string | null {
    if (request.amount <= 0) return "amount must be greater than 0";
    if (!request.currency) return "currency is required";
    if (!request.recipientAccountId) return "recipientAccountId is required";
    return null;
  }
}
