# W3F — MonzoService

**File to create:** `src/services/monzo.ts`
**Depends on:** `src/types.ts`, `src/interfaces.ts` (both already exist)
**Depended on by:** Tools (agent uses check_balance), RoomManager (wires to agent)

---

## Purpose

Read-only Monzo banking API client. The agent can check balance and recent transactions for context during negotiations (e.g., "you have £500 available").

Simplified from original — removed feed items, pots, deposits/withdrawals, escrow pot. Just balance + transactions.

---

## Imports

```ts
import type { MonzoBalance, MonzoTransaction } from "../types.js";
import type { IMonzoService } from "../interfaces.js";
```

---

## Class: MonzoService

```ts
export class MonzoService implements IMonzoService
```

### Private State

```ts
private accessToken: string | null = null;
private readonly baseUrl = "https://api.monzo.com";
private accountId: string | null = null;
```

### Methods

**`setAccessToken(token: string): void`**
- `this.accessToken = token`
- `this.accountId = null` (reset — will be fetched lazily)

**`isAuthenticated(): boolean`**
- Return `this.accessToken !== null`

**`getBalance(): Promise<MonzoBalance>`**
1. `const accountId = await this.resolveAccountId()`
2. `const data = await this.request("GET", `/balance?account_id=${accountId}`)`
3. Return:
   ```ts
   {
     balance: data.balance,
     total_balance: data.total_balance,
     currency: data.currency,
     spend_today: data.spend_today,
   }
   ```

**`getTransactions(days = 30): Promise<MonzoTransaction[]>`**
1. `const accountId = await this.resolveAccountId()`
2. `const since = new Date(Date.now() - days * 86_400_000).toISOString()`
3. `const data = await this.request("GET", `/transactions?account_id=${accountId}&since=${since}&expand[]=merchant`)`
4. Return mapped array:
   ```ts
   data.transactions.map((t: Record<string, unknown>) => ({
     id: String(t.id),
     amount: Number(t.amount),
     currency: String(t.currency),
     description: String(t.description),
     created: String(t.created),
     merchant: t.merchant ? { name: String((t.merchant as Record<string, unknown>).name), category: (t.merchant as Record<string, unknown>).category as string | undefined } : undefined,
     category: String(t.category),
   }))
   ```

### Private Methods

**`private async resolveAccountId(): Promise<string>`**
1. If `this.accountId` is set, return it
2. `const data = await this.request("GET", "/accounts")`
3. Find first account with `type === "uk_retail"` (or fall back to first account)
4. `this.accountId = data.accounts[0].id`
5. Return `this.accountId`
6. If no accounts found, throw `Error("No Monzo accounts found")`

**`private async request(method: string, path: string): Promise<Record<string, unknown>>`**
1. If `!this.accessToken`, throw `Error("Monzo not authenticated")`
2. Call `fetch`:
   ```ts
   const res = await fetch(`${this.baseUrl}${path}`, {
     method,
     headers: { Authorization: `Bearer ${this.accessToken}` },
   });
   ```
3. If `!res.ok`:
   - `const body = await res.text()`
   - Throw `Error(`Monzo API error ${res.status}: ${body}`)`
4. Return `await res.json()` as `Record<string, unknown>`

---

## Edge Cases

- `getBalance()`/`getTransactions()` called without access token: throws immediately
- Account ID cached after first resolution (avoid repeated `/accounts` calls)
- Monzo API returns non-200: error includes status code and body for debugging

---

## Verification

```bash
npx tsc --noEmit  # zero errors
```

- Implements `IMonzoService` interface
- Read-only: only GET requests
- Lazy account ID resolution
- Proper error handling for auth and API failures
