import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env file
try {
  const envPath = resolve(process.cwd(), ".env");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  databaseUrl: optional("DATABASE_URL", "./hearthstone.db"),
  googleClientId: optional("GOOGLE_CLIENT_ID", ""),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET", ""),
  webauthnRpId: optional("WEBAUTHN_RP_ID", "localhost"),
  openaiApiKey: required("OPENAI_API_KEY"),
  embeddingProvider: optional("EMBEDDING_PROVIDER", "openai"),
  chatProvider: optional("CHAT_PROVIDER", "openai"),
  resendApiKey: optional("RESEND_API_KEY", ""),
  jwtSecret: required("JWT_SECRET"),
  appBaseUrl: optional("APP_BASE_URL", "https://hearthstone.app"),
  port: parseInt(optional("PORT", "3000"), 10),
};
