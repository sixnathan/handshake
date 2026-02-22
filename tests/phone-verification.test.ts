import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PhoneVerificationService } from "../src/services/phone-verification.js";

describe("PhoneVerificationService", () => {
  describe("isAvailable", () => {
    it("should return false when phoneNumberId is not configured", () => {
      const service = new PhoneVerificationService({ apiKey: "key" });
      expect(service.isAvailable()).toBe(false);
    });

    it("should return true when phoneNumberId is configured", () => {
      const service = new PhoneVerificationService({
        apiKey: "key",
        phoneNumberId: "pn_123",
      });
      expect(service.isAvailable()).toBe(true);
    });
  });

  describe("verify (demo mode)", () => {
    it("should return simulated result when phoneNumberId not configured", async () => {
      const service = new PhoneVerificationService({ apiKey: "key" });

      const result = await service.verify({
        phoneNumber: "+447123456789",
        contactName: "John",
        milestoneDescription: "Boiler repair",
        condition: "Boiler fully operational",
        questions: ["Has the boiler been repaired?"],
      });

      expect(result.success).toBe(true);
      expect(result.confirmed).toBe(true);
      expect(result.callId).toMatch(/^sim_/);
      expect(result.transcript).toContain("Simulated call");
      expect(result.transcript).toContain("John");
      expect(result.details).toContain("DEMO MODE");
    });

    it("should include milestone description in simulated transcript", async () => {
      const service = new PhoneVerificationService({ apiKey: "key" });

      const result = await service.verify({
        phoneNumber: "+447000000000",
        contactName: "Alice",
        milestoneDescription: "Plumbing complete",
        condition: "All pipes fixed",
        questions: ["Is the plumbing done?"],
      });

      expect(result.transcript).toContain("Plumbing complete");
      expect(result.transcript).toContain("Alice");
    });
  });

  describe("verify (live mode)", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("should create agent, initiate call, poll, and clean up", async () => {
      const service = new PhoneVerificationService({
        apiKey: "test-key",
        phoneNumberId: "pn_test",
      });

      // Mock create agent
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agent_id: "agent_abc" }),
      });

      // Mock initiate call
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conversation_id: "conv_xyz" }),
      });

      // Mock poll — first in progress, then done
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "done",
          transcript: "Agent: Hello\nContact: Yes",
          analysis: { call_successful: true },
        }),
      });

      // Mock delete agent
      fetchSpy.mockResolvedValueOnce({ ok: true });

      const result = await service.verify({
        phoneNumber: "+447123456789",
        contactName: "Bob",
        milestoneDescription: "Fix pipes",
        condition: "Pipes fixed",
        questions: ["Are the pipes fixed?"],
      });

      expect(result.success).toBe(true);
      expect(result.confirmed).toBe(true);
      expect(result.callId).toBe("conv_xyz");

      // Verify all API calls were made
      expect(fetchSpy).toHaveBeenCalledTimes(4);

      // Create agent call
      const createCall = fetchSpy.mock.calls[0];
      expect(createCall[0]).toContain("/v1/convai/agents/create");
      expect(createCall[1].headers["xi-api-key"]).toBe("test-key");

      // Initiate call
      const initiateCall = fetchSpy.mock.calls[1];
      expect(initiateCall[0]).toContain(
        "/v1/convai/conversations/create-phone-call",
      );

      // Delete agent (cleanup)
      const deleteCall = fetchSpy.mock.calls[3];
      expect(deleteCall[0]).toContain("/v1/convai/agents/agent_abc");
      expect(deleteCall[1].method).toBe("DELETE");
    });

    it("should return failure when agent creation fails", async () => {
      const service = new PhoneVerificationService({
        apiKey: "test-key",
        phoneNumberId: "pn_test",
      });

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const result = await service.verify({
        phoneNumber: "+447000000000",
        contactName: "Test",
        milestoneDescription: "Test",
        condition: "Test",
        questions: ["Test?"],
      });

      expect(result.success).toBe(false);
      expect(result.confirmed).toBe(false);
      expect(result.details).toContain("Phone verification failed");
    });

    it("should handle call not confirmed", async () => {
      const service = new PhoneVerificationService({
        apiKey: "test-key",
        phoneNumberId: "pn_test",
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ agent_id: "agent_def" }),
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conversation_id: "conv_not_confirmed" }),
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "done",
          transcript: "Agent: Hello\nContact: No, not done yet.",
          analysis: { call_successful: false },
        }),
      });

      fetchSpy.mockResolvedValueOnce({ ok: true });

      const result = await service.verify({
        phoneNumber: "+447000000000",
        contactName: "Test",
        milestoneDescription: "Test work",
        condition: "Work done",
        questions: ["Is the work done?"],
      });

      expect(result.success).toBe(true);
      expect(result.confirmed).toBe(false);
      expect(result.details).toContain("did not confirm");
    });
  });
});
