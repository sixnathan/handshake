import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("Config Module", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Set all required env vars
    process.env.ELEVENLABS_API_KEY = "test-eleven-key";
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_PLATFORM_ACCOUNT_ID = "acct_platform";
    process.env.LLM_API_KEY = "test-llm-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should load config with all required env vars", () => {
    const config = loadConfig();
    expect(config.elevenlabs.apiKey).toBe("test-eleven-key");
    expect(config.stripe.secretKey).toBe("sk_test_123");
    expect(config.stripe.platformAccountId).toBe("acct_platform");
    expect(config.llm.apiKey).toBe("test-llm-key");
  });

  it("should use default values for optional vars", () => {
    const config = loadConfig();
    expect(config.elevenlabs.region).toBe("us");
    expect(config.elevenlabs.language).toBe("en");
    expect(config.llm.provider).toBe("openrouter");
    expect(config.llm.model).toBe("anthropic/claude-sonnet-4");
    expect(config.trigger.keyword).toBe("chripbbbly");
    expect(config.trigger.smartDetectionEnabled).toBe(true);
    expect(config.port).toBe(3000);
  });

  it("should throw on missing required env var", () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(() => loadConfig()).toThrow(
      "Missing required env var: ELEVENLABS_API_KEY",
    );
  });

  it("should throw on missing STRIPE_SECRET_KEY", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => loadConfig()).toThrow(
      "Missing required env var: STRIPE_SECRET_KEY",
    );
  });

  it("should throw on missing LLM_API_KEY", () => {
    delete process.env.LLM_API_KEY;
    expect(() => loadConfig()).toThrow("Missing required env var: LLM_API_KEY");
  });

  it("should accept 'anthropic' as LLM_PROVIDER", () => {
    process.env.LLM_PROVIDER = "anthropic";
    const config = loadConfig();
    expect(config.llm.provider).toBe("anthropic");
  });

  it("should reject invalid LLM_PROVIDER", () => {
    process.env.LLM_PROVIDER = "invalid";
    expect(() => loadConfig()).toThrow(
      'Invalid value for LLM_PROVIDER: "invalid"',
    );
  });

  it("should parse PORT as integer", () => {
    process.env.PORT = "8080";
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  it("should throw on non-integer PORT", () => {
    process.env.PORT = "not-a-number";
    expect(() => loadConfig()).toThrow("Invalid integer for PORT");
  });

  it("should parse SMART_DETECTION_ENABLED flag", () => {
    process.env.SMART_DETECTION_ENABLED = "false";
    const config = loadConfig();
    expect(config.trigger.smartDetectionEnabled).toBe(false);
  });

  it("should parse flag with '1' as true", () => {
    process.env.SMART_DETECTION_ENABLED = "1";
    const config = loadConfig();
    expect(config.trigger.smartDetectionEnabled).toBe(true);
  });

  it("should load optional monzo access token", () => {
    process.env.MONZO_ACCESS_TOKEN = "monzo-token-123";
    const config = loadConfig();
    expect(config.monzo.accessToken).toBe("monzo-token-123");
  });

  it("should return undefined for missing optional monzo token", () => {
    delete process.env.MONZO_ACCESS_TOKEN;
    const config = loadConfig();
    expect(config.monzo.accessToken).toBeUndefined();
  });
});
