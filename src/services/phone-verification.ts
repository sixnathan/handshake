import type {
  PhoneVerificationRequest,
  PhoneVerificationResult,
} from "../types.js";

const ELEVENLABS_BASE = "https://api.elevenlabs.io";
const POLL_INTERVAL_MS = 3_000;
const CALL_TIMEOUT_MS = 180_000; // 3 minutes

interface PhoneVerificationConfig {
  apiKey: string;
  phoneNumberId?: string;
}

export class PhoneVerificationService {
  private readonly apiKey: string;
  private readonly phoneNumberId: string | undefined;

  constructor(config: PhoneVerificationConfig) {
    this.apiKey = config.apiKey;
    this.phoneNumberId = config.phoneNumberId;
  }

  isAvailable(): boolean {
    return !!this.phoneNumberId;
  }

  async verify(
    request: PhoneVerificationRequest,
  ): Promise<PhoneVerificationResult> {
    if (!this.phoneNumberId) {
      return this.simulateCall(request);
    }
    return this.executeCall(request);
  }

  private async executeCall(
    request: PhoneVerificationRequest,
  ): Promise<PhoneVerificationResult> {
    let agentId: string | undefined;

    try {
      // Create temporary conversational agent
      agentId = await this.createAgent(request);

      // Initiate outbound call
      const callId = await this.initiateCall(agentId, request.phoneNumber);

      // Poll for completion
      const result = await this.pollForCompletion(callId);

      return result;
    } catch (err) {
      return {
        success: false,
        confirmed: false,
        details: `Phone verification failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      // Clean up temporary agent
      if (agentId) {
        this.deleteAgent(agentId).catch((err) =>
          console.error("[phone-verify] Agent cleanup failed:", err),
        );
      }
    }
  }

  private async createAgent(
    request: PhoneVerificationRequest,
  ): Promise<string> {
    const questionsPrompt = request.questions
      .map((q, i) => `${i + 1}. ${q}`)
      .join("\n");

    const res = await fetch(`${ELEVENLABS_BASE}/v1/convai/agents/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": this.apiKey,
      },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            prompt: {
              prompt: `You are a verification agent calling to confirm the completion of work.

CONTEXT:
- You are calling ${request.contactName} to verify: "${request.milestoneDescription}"
- Completion condition: "${request.condition}"

INSTRUCTIONS:
1. Introduce yourself as calling from Handshake verification service
2. Ask the following questions:
${questionsPrompt}
3. Thank them for their time
4. End the call

Be professional, concise, and friendly. Record their responses accurately.`,
            },
            first_message: `Hello, this is the Handshake verification service calling for ${request.contactName}. I'm calling to verify the completion of some work. Do you have a moment?`,
          },
        },
        name: `verify-${Date.now()}`,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to create agent: ${res.status} ${body}`);
    }

    const data = (await res.json()) as { agent_id: string };
    return data.agent_id;
  }

  private async initiateCall(
    agentId: string,
    phoneNumber: string,
  ): Promise<string> {
    const res = await fetch(
      `${ELEVENLABS_BASE}/v1/convai/conversations/create-phone-call`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": this.apiKey,
        },
        body: JSON.stringify({
          agent_id: agentId,
          agent_phone_number_id: this.phoneNumberId,
          customer_phone_number: phoneNumber,
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to initiate call: ${res.status} ${body}`);
    }

    const data = (await res.json()) as { conversation_id: string };
    return data.conversation_id;
  }

  private async pollForCompletion(
    callId: string,
  ): Promise<PhoneVerificationResult> {
    const deadline = Date.now() + CALL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await this.sleep(POLL_INTERVAL_MS);

      const res = await fetch(
        `${ELEVENLABS_BASE}/v1/convai/conversations/${callId}`,
        {
          headers: { "xi-api-key": this.apiKey },
        },
      );

      if (!res.ok) continue;

      const data = (await res.json()) as {
        status: string;
        transcript?: string;
        analysis?: {
          call_successful?: boolean;
          data_collection_results?: Record<string, unknown>;
        };
      };

      if (data.status === "done" || data.status === "failed") {
        const confirmed = data.analysis?.call_successful ?? false;
        return {
          success: data.status === "done",
          callId,
          transcript: data.transcript,
          confirmed,
          details: confirmed
            ? "Phone verification completed — contact confirmed work completion"
            : "Phone verification completed — contact did not confirm completion",
        };
      }
    }

    return {
      success: false,
      callId,
      confirmed: false,
      details: "Phone verification timed out after 3 minutes",
    };
  }

  private async deleteAgent(agentId: string): Promise<void> {
    await fetch(`${ELEVENLABS_BASE}/v1/convai/agents/${agentId}`, {
      method: "DELETE",
      headers: { "xi-api-key": this.apiKey },
    });
  }

  private simulateCall(
    request: PhoneVerificationRequest,
  ): Promise<PhoneVerificationResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          callId: `sim_${Date.now()}`,
          transcript: `[Simulated call to ${request.contactName} at ${request.phoneNumber}]\nAgent: Hello, this is the Handshake verification service. I'm calling to verify: ${request.milestoneDescription}\n${request.contactName}: Yes, the work has been completed.\nAgent: Thank you for confirming.`,
          confirmed: true,
          details:
            "DEMO MODE: Simulated phone call — contact confirmed work completion",
        });
      }, 3_000);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
