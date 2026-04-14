function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

// HEARTHSTONE_PUBLIC_URL feeds every join_url the server hands out and the
// `server=` param in the hearthstone:// redirect. A value without a scheme
// (e.g. "hearthstone.bitplug.com" instead of "https://hearthstone.bitplug.com")
// produces links that iOS cannot route, and the failure surfaces as an
// opaque "Could not redeem this invite" in the app. Validate at boot so a
// misconfigured secret fails loudly instead of silently breaking redemption.
function requiredPublicUrl(name: string): string {
  const raw = required(name).trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `${name} must be a full URL including scheme, e.g. https://hearthstone.example.com (got: ${raw})`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${name} must use http or https scheme (got: ${parsed.protocol})`
    );
  }
  // Strip any trailing slash so callers can do `${publicUrl}/join/${pin}`
  // without doubling up.
  return raw.replace(/\/+$/, "");
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
  hearthstonePublicUrl: requiredPublicUrl("HEARTHSTONE_PUBLIC_URL"),
  port: parseInt(optional("PORT", "3000"), 10),
};
