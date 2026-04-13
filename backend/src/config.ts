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
  jwtSecret: required("JWT_SECRET"),
  appBaseUrl: optional("APP_BASE_URL", "https://hearthstone.app"),
  hearthstonePublicUrl: required("HEARTHSTONE_PUBLIC_URL"),
  port: parseInt(optional("PORT", "3000"), 10),
};
