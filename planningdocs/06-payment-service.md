# Prompt 06 — Payment Service (Stripe)

**Phase:** 2 (services — parallelizable)
**Depends on:** 01-types-and-interfaces
**Blocks:** Phase 3 (agent/tools)

## Task

Create the PaymentService — a Stripe SDK wrapper for payments, escrow, subscriptions, refunds, and split payments.

---

## File: src/services/payment.ts

### Class: PaymentService

**Constructor args:**
```ts
{ stripeSecretKey: string; myStripeAccountId: string }
```

**Private state:**
```ts
private stripe: Stripe;
private myAccountId: string;
private savedPaymentMethod: string | null = null;
```

Create Stripe client: `new Stripe(stripeSecretKey)`

---

### Methods

**`savePaymentMethod(paymentMethodId: string): void`**
- Store as `this.savedPaymentMethod`

**`executePayment(request: PaymentRequest): Promise<PaymentResult>`**
1. Create PaymentIntent:
   ```ts
   stripe.paymentIntents.create({
     amount: request.amount,
     currency: request.currency,
     description: request.description,
     payment_method: request.paymentMethodId ?? this.savedPaymentMethod,
     confirm: true,
     transfer_data: {
       destination: request.recipientAccountId,
     },
     automatic_payment_methods: {
       enabled: true,
       allow_redirects: "never",
     },
   })
   ```
2. Return `{ success: true, paymentIntentId: pi.id }`
3. Catch errors → return `{ success: false, error: err.message }`

**`createEscrowHold(request: PaymentRequest): Promise<EscrowHold>`**
1. Create PaymentIntent with `capture_method: "manual"`:
   ```ts
   stripe.paymentIntents.create({
     amount: request.amount,
     currency: request.currency,
     description: `Escrow: ${request.description}`,
     payment_method: request.paymentMethodId ?? this.savedPaymentMethod,
     confirm: true,
     capture_method: "manual",
     transfer_data: {
       destination: request.recipientAccountId,
     },
     automatic_payment_methods: {
       enabled: true,
       allow_redirects: "never",
     },
   })
   ```
2. Return `EscrowHold`:
   ```ts
   { holdId: pi.id, amount: request.amount, currency: request.currency, status: "held", paymentIntentId: pi.id }
   ```

**`captureEscrow(holdId: string): Promise<PaymentResult>`**
1. Call `stripe.paymentIntents.capture(holdId)`
2. Return `{ success: true, paymentIntentId: holdId }`
3. Catch → `{ success: false, error: err.message }`

**`releaseEscrow(holdId: string): Promise<PaymentResult>`**
1. Call `stripe.paymentIntents.cancel(holdId)`
2. Return `{ success: true, paymentIntentId: holdId }`
3. Catch → `{ success: false, error: err.message }`

**`createSubscription(agreement: SubscriptionAgreement): Promise<{ subscriptionId: string }>`**
1. Create Product: `stripe.products.create({ name: agreement.description })`
2. Map interval: weekly→"week", monthly→"month", yearly→"year"
3. Create Price:
   ```ts
   stripe.prices.create({
     product: product.id,
     unit_amount: agreement.amount,
     currency: agreement.currency,
     recurring: { interval: mappedInterval },
   })
   ```
4. Create or find Customer (use a default test customer or create one)
5. Create Subscription:
   ```ts
   stripe.subscriptions.create({
     customer: customer.id,
     items: [{ price: price.id }],
   })
   ```
6. Return `{ subscriptionId: subscription.id }`

**`cancelSubscription(subscriptionId: string): Promise<void>`**
- Call `stripe.subscriptions.cancel(subscriptionId)`

**`requestRefund(paymentIntentId: string, reason?: string): Promise<PaymentResult>`**
1. Check for existing refunds: `stripe.refunds.list({ payment_intent: paymentIntentId })`
2. If refunds exist, return `{ success: false, error: "Already refunded" }`
3. Create refund: `stripe.refunds.create({ payment_intent: paymentIntentId, reason: reason as any })`
4. Return `{ success: true, paymentIntentId }`

**`executeSplitPayment(request: PaymentRequest, splits: Array<{ accountId: string; amount: number }>): Promise<PaymentResult[]>`**
1. `Promise.all(splits.map(split => ...))`
2. For each split, create a separate PaymentIntent:
   ```ts
   stripe.paymentIntents.create({
     amount: split.amount,
     currency: request.currency,
     description: `Split: ${request.description}`,
     payment_method: request.paymentMethodId ?? this.savedPaymentMethod,
     confirm: true,
     transfer_data: { destination: split.accountId },
     automatic_payment_methods: { enabled: true, allow_redirects: "never" },
   })
   ```
3. Map results to `PaymentResult[]`

---

### Imports

```ts
import Stripe from "stripe";
import type { PaymentRequest, PaymentResult, EscrowHold, SubscriptionAgreement } from "../types.js";
```

---

## Verification

- executePayment uses transfer_data for connected account routing
- createEscrowHold uses capture_method: "manual"
- captureEscrow calls paymentIntents.capture
- releaseEscrow calls paymentIntents.cancel
- Subscriptions create Product → Price → Subscription chain
- Refund checks for existing refunds before creating
- Split payments run in parallel via Promise.all
- All methods handle errors gracefully
