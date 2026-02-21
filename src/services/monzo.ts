import type { MonzoBalance, MonzoTransaction } from "../types.js";
import type { IMonzoService } from "../interfaces.js";

export class MonzoService implements IMonzoService {
  private accessToken: string | null = null;
  private readonly baseUrl = "https://api.monzo.com";
  private accountId: string | null = null;

  setAccessToken(token: string): void {
    this.accessToken = token;
    this.accountId = null;
  }

  isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  async getBalance(): Promise<MonzoBalance> {
    const accountId = await this.resolveAccountId();
    const data = await this.request("GET", `/balance?account_id=${accountId}`);
    return {
      balance: data.balance as number,
      total_balance: data.total_balance as number,
      currency: data.currency as string,
      spend_today: data.spend_today as number,
    };
  }

  async getTransactions(days = 30): Promise<MonzoTransaction[]> {
    const accountId = await this.resolveAccountId();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const data = await this.request(
      "GET",
      `/transactions?account_id=${accountId}&since=${since}&expand[]=merchant`,
    );
    const transactions = data.transactions as Record<string, unknown>[];
    return transactions.map((t) => ({
      id: String(t.id),
      amount: Number(t.amount),
      currency: String(t.currency),
      description: String(t.description),
      created: String(t.created),
      merchant: t.merchant
        ? {
            name: String((t.merchant as Record<string, unknown>).name),
            category: (t.merchant as Record<string, unknown>).category as
              | string
              | undefined,
          }
        : undefined,
      category: String(t.category),
    }));
  }

  private async resolveAccountId(): Promise<string> {
    if (this.accountId) {
      return this.accountId;
    }
    const data = await this.request("GET", "/accounts");
    const accounts = data.accounts as Record<string, unknown>[];
    if (!accounts || accounts.length === 0) {
      throw new Error("No Monzo accounts found");
    }
    const ukRetail = accounts.find((a) => a.type === "uk_retail");
    const account = ukRetail ?? accounts[0];
    this.accountId = String(account.id);
    return this.accountId;
  }

  private async request(
    method: string,
    path: string,
  ): Promise<Record<string, unknown>> {
    if (!this.accessToken) {
      throw new Error("Monzo not authenticated");
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Monzo API error ${res.status}: ${body}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}
