import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MonzoService } from "../src/services/monzo.js";

describe("MonzoService Module", () => {
  let monzo: MonzoService;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    monzo = new MonzoService();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("authentication", () => {
    it("should not be authenticated initially", () => {
      expect(monzo.isAuthenticated()).toBe(false);
    });

    it("should be authenticated after setting token", () => {
      monzo.setAccessToken("test-token");
      expect(monzo.isAuthenticated()).toBe(true);
    });

    it("should throw on API call without token", async () => {
      await expect(monzo.getBalance()).rejects.toThrow(
        "Monzo not authenticated",
      );
    });
  });

  describe("getBalance", () => {
    it("should fetch balance with correct auth header", async () => {
      monzo.setAccessToken("my-token");

      // Mock accounts call
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accounts: [{ id: "acc_123", type: "uk_retail" }],
        }),
      });

      // Mock balance call
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balance: 150000,
          total_balance: 150000,
          currency: "GBP",
          spend_today: -5000,
        }),
      });

      const balance = await monzo.getBalance();
      expect(balance.balance).toBe(150000);
      expect(balance.currency).toBe("GBP");
      expect(balance.spend_today).toBe(-5000);

      // Check auth header on both calls
      expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe(
        "Bearer my-token",
      );
      expect(fetchSpy.mock.calls[1][1].headers.Authorization).toBe(
        "Bearer my-token",
      );
    });

    it("should cache account ID after first call", async () => {
      monzo.setAccessToken("token");

      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accounts: [{ id: "acc_1", type: "uk_retail" }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            balance: 100,
            total_balance: 100,
            currency: "GBP",
            spend_today: 0,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            balance: 200,
            total_balance: 200,
            currency: "GBP",
            spend_today: 0,
          }),
        });

      await monzo.getBalance();
      await monzo.getBalance();

      // accounts endpoint should only be called once (first call)
      const accountsCalls = fetchSpy.mock.calls.filter((c: any[]) =>
        c[0].includes("/accounts"),
      );
      expect(accountsCalls).toHaveLength(1);
    });

    it("should prefer uk_retail account", async () => {
      monzo.setAccessToken("token");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accounts: [
            { id: "acc_prepaid", type: "uk_prepaid" },
            { id: "acc_retail", type: "uk_retail" },
          ],
        }),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balance: 100,
          total_balance: 100,
          currency: "GBP",
          spend_today: 0,
        }),
      });

      await monzo.getBalance();

      // Balance call should use retail account
      expect(fetchSpy.mock.calls[1][0]).toContain("acc_retail");
    });

    it("should fallback to first account if no uk_retail", async () => {
      monzo.setAccessToken("token");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accounts: [{ id: "acc_prepaid", type: "uk_prepaid" }],
        }),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balance: 100,
          total_balance: 100,
          currency: "GBP",
          spend_today: 0,
        }),
      });

      await monzo.getBalance();
      expect(fetchSpy.mock.calls[1][0]).toContain("acc_prepaid");
    });

    it("should throw if no accounts found", async () => {
      monzo.setAccessToken("token");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [] }),
      });

      await expect(monzo.getBalance()).rejects.toThrow(
        "No Monzo accounts found",
      );
    });

    it("should throw on API error", async () => {
      monzo.setAccessToken("token");

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      await expect(monzo.getBalance()).rejects.toThrow("Monzo API error 403");
    });

    it("should clear cached account ID when token changes", async () => {
      monzo.setAccessToken("token-1");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [{ id: "acc_1", type: "uk_retail" }] }),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balance: 100,
          total_balance: 100,
          currency: "GBP",
          spend_today: 0,
        }),
      });
      await monzo.getBalance();

      // Change token — should re-fetch accounts
      monzo.setAccessToken("token-2");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [{ id: "acc_2", type: "uk_retail" }] }),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          balance: 200,
          total_balance: 200,
          currency: "GBP",
          spend_today: 0,
        }),
      });
      await monzo.getBalance();

      // Should have called accounts twice
      const accountsCalls = fetchSpy.mock.calls.filter((c: any[]) =>
        c[0].includes("/accounts"),
      );
      expect(accountsCalls).toHaveLength(2);
    });
  });

  describe("getTransactions", () => {
    it("should fetch transactions with correct params", async () => {
      monzo.setAccessToken("token");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [{ id: "acc_1", type: "uk_retail" }] }),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transactions: [
            {
              id: "tx_1",
              amount: -5000,
              currency: "GBP",
              description: "Coffee",
              created: "2026-02-21T10:00:00Z",
              merchant: { name: "Starbucks", category: "eating_out" },
              category: "eating_out",
            },
          ],
        }),
      });

      const txns = await monzo.getTransactions(7);
      expect(txns).toHaveLength(1);
      expect(txns[0].id).toBe("tx_1");
      expect(txns[0].amount).toBe(-5000);
      expect(txns[0].merchant?.name).toBe("Starbucks");
      expect(txns[0].category).toBe("eating_out");
    });

    it("should handle transactions without merchant", async () => {
      monzo.setAccessToken("token");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [{ id: "acc_1", type: "uk_retail" }] }),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transactions: [
            {
              id: "tx_2",
              amount: 10000,
              currency: "GBP",
              description: "Transfer",
              created: "2026-02-21",
              merchant: null,
              category: "income",
            },
          ],
        }),
      });

      const txns = await monzo.getTransactions();
      expect(txns[0].merchant).toBeUndefined();
    });

    it("should default to 30 days", async () => {
      monzo.setAccessToken("token");

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [{ id: "acc_1", type: "uk_retail" }] }),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transactions: [] }),
      });

      await monzo.getTransactions();

      const txnCall = fetchSpy.mock.calls[1][0] as string;
      expect(txnCall).toContain("since=");
      // Check the since date is roughly 30 days ago
      const sinceParam = txnCall.match(/since=([^&]+)/)?.[1];
      expect(sinceParam).toBeDefined();
      const sinceDate = new Date(sinceParam!);
      const daysAgo = (Date.now() - sinceDate.getTime()) / 86_400_000;
      expect(daysAgo).toBeCloseTo(30, 0);
    });
  });
});
