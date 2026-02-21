# W4D — PaymentService

**File to create:** `src/services/payment.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts` (both already exist)
**Depended on by:** Tools (agent executes payments), RoomManager (wires to agent)

---

## Purpose

Stripe Connect payment service using platform-managed transfers with escrow via manual capture PaymentIntents. Simplified from original — no subscriptions, refunds, or split payments.

---

## Imports

```ts
import Stripe from "stripe";
import type { PaymentRequest, PaymentResult, EscrowHold } from "../types.js";
import type { IPaymentService } from "../interfaces.js";
```

---

## Class: PaymentService

```ts
export class PaymentService implements IPaymentService
```

### Constructor

```ts
constructor(private readonly config: {
  secretKey: string;
  platformAccountId: string;
})
```

### Private State

```ts
private readonly stripe: Stripe;
private escrowHolds = new Map<string, EscrowHold>();
```

Initialize in constructor: `this.stripe = new Stripe(config.secretKey)`

### Methods

**`executePayment(request: PaymentRequest): Promise<PaymentResult>`**
1. Validate: amount > 0, currency non-empty, recipientAccountId non-empty
   - If invalid: return `{ success: false, error: "Invalid payment request: <reason>" }`
2. Create PaymentIntent with transfer:
   ```ts
   const pi = await this.stripe.paymentIntents.create({
     amount: request.amount,
     currency: request.currency,
     description: request.description,
     transfer_data: {
       destination: request.recipientAccountId,
     },
     automatic_payment_methods: {
       enabled: true,
       allow_redirects: "never",
     },
     confirm: true,
   });
   ```
3. Return `{ success: true, paymentIntentId: pi.id, transferId: pi.transfer_data?.destination }`
4. Catch errors:
   ```ts
   catch (err) {
     const message = err instanceof Error ? err.message : String(err);
     return { success: false, error: `Payment failed: ${message}` };
   }
   ```

**`createEscrowHold(request: PaymentRequest): Promise<EscrowHold>`**
1. Validate same as `executePayment`
   - If invalid: throw `Error("Invalid escrow request: <reason>")`
2. Create PaymentIntent with `capture_method: "manual"`:
   ```ts
   const pi = await this.stripe.paymentIntents.create({
     amount: request.amount,
     currency: request.currency,
     description: `Escrow: ${request.description}`,
     transfer_data: {
       destination: request.recipientAccountId,
     },
     capture_method: "manual",
     automatic_payment_methods: {
       enabled: true,
       allow_redirects: "never",
     },
     confirm: true,
   });
   ```
3. Build hold object:
   ```ts
   const hold: EscrowHold = {
     holdId: pi.id,
     amount: request.amount,
     currency: request.currency,
     status: "held",
     paymentIntentId: pi.id,
     recipientAccountId: request.recipientAccountId,
     createdAt: Date.now(),
   };
   ```
4. Store: `this.escrowHolds.set(hold.holdId, hold)`
5. Return hold

**`captureEscrow(holdId: string, amount?: number): Promise<PaymentResult>`**
1. `const hold = this.escrowHolds.get(holdId)`
2. If `!hold`: return `{ success: false, error: "Escrow hold not found" }`
3. If `hold.status !== "held"`: return `{ success: false, error: "Escrow already ${hold.status}" }`
4. Build capture params:
   ```ts
   const params: Stripe.PaymentIntentCaptureParams = {};
   if (amount !== undefined) {
     params.amount_to_capture = amount;  // partial capture
   }
   ```
5. `await this.stripe.paymentIntents.capture(holdId, params)`
6. Update hold status: `this.escrowHolds.set(holdId, { ...hold, status: "captured" })`
7. Return `{ success: true, paymentIntentId: holdId }`
8. Catch: return `{ success: false, error: ... }`

**`releaseEscrow(holdId: string): Promise<PaymentResult>`**
1. `const hold = this.escrowHolds.get(holdId)`
2. If `!hold`: return `{ success: false, error: "Escrow hold not found" }`
3. If `hold.status !== "held"`: return `{ success: false, error: "Escrow already ${hold.status}" }`
4. `await this.stripe.paymentIntents.cancel(holdId)`
5. Update hold status: `this.escrowHolds.set(holdId, { ...hold, status: "released" })`
6. Return `{ success: true, paymentIntentId: holdId }`
7. Catch: return `{ success: false, error: ... }`

---

## Stripe Connect Notes

- **Platform-managed transfers**: The platform (Handshake) charges the customer, Stripe automatically transfers to the connected account specified in `transfer_data.destination`
- **Manual capture**: `capture_method: "manual"` authorizes the amount but doesn't charge. Call `capture` later to complete. Call `cancel` to release.
- **Partial capture**: Pass `amount_to_capture` less than the original amount. Stripe refunds the difference automatically.
- **Example flow** (plumber scenario):
  1. `createEscrowHold({ amount: 50000, ... })` — holds £500
  2. Job done, actual cost £350
  3. `captureEscrow(holdId, 35000)` — captures £350, refunds £150

---

## Edge Cases

- Payment to non-existent Connect account: Stripe returns error, caught and returned
- Double capture: checked via hold status map, returns error
- Partial capture exceeding hold amount: Stripe returns error, caught
- Network failure: Stripe SDK retries internally, ultimate failure caught

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `IPaymentService` interface
- `executePayment` uses `transfer_data` for Connect routing
- `createEscrowHold` uses `capture_method: "manual"`
- `captureEscrow` supports partial capture via `amount_to_capture`
- `releaseEscrow` cancels the PaymentIntent
- All methods handle errors gracefully
- Escrow hold status tracked in memory
- Immutable updates to hold status (spread + set)
