import dotenv from "dotenv";
import type { AppConfig } from "./types.js";

dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string): string | undefined;
function optional(key: string, fallback: string): string;
function optional(key: string, fallback?: string): string | undefined {
  return process.env[key] ?? fallback;
}

function oneOf<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const val = process.env[key] ?? fallback;
  if (!allowed.includes(val as T)) {
    throw new Error(
      `Invalid value for ${key}: "${val}". Must be one of: ${allowed.join(", ")}`,
    );
  }
  return val as T;
}

function flag(key: string, fallback = false): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  return val === "true" || val === "1";
}

function integer(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer for ${key}: "${val}"`);
  }
  return parsed;
}

export function loadConfig(): AppConfig {
  return {
    elevenlabs: {
      apiKey: required("ELEVENLABS_API_KEY"),
      region: optional("ELEVENLABS_REGION", "us"),
      language: optional("ELEVENLABS_LANGUAGE", "en"),
      phoneNumberId: optional("ELEVENLABS_PHONE_NUMBER_ID"),
    },
    stripe: {
      secretKey: required("STRIPE_SECRET_KEY"),
      platformAccountId: required("STRIPE_PLATFORM_ACCOUNT_ID"),
      customerIdForDemo: optional("STRIPE_CUSTOMER_ID"),
    },
    llm: {
      provider: oneOf(
        "LLM_PROVIDER",
        ["anthropic", "openrouter"] as const,
        "openrouter",
      ),
      apiKey: required("LLM_API_KEY"),
      model: optional("LLM_MODEL", "anthropic/claude-sonnet-4"),
    },
    trigger: {
      keyword: optional("TRIGGER_KEYWORD", "chripbbbly"),
      smartDetectionEnabled: flag("SMART_DETECTION_ENABLED", true),
    },
    monzo: {
      accessToken: optional("MONZO_ACCESS_TOKEN"),
    },
    port: integer("PORT", 3000),
  };
}
