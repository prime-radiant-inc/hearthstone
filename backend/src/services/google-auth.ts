// src/services/google-auth.ts
import { OAuth2Client } from "google-auth-library";
import { config } from "../config";

const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive.readonly",
];

function getClient(): OAuth2Client {
  return new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret,
    `${config.appBaseUrl}/auth/google/callback`
  );
}

export function getAuthUrl(state: string): string {
  const client = getClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state,
    prompt: "consent",
  });
}

export async function exchangeCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  email: string;
  name: string;
}> {
  const client = getClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = (await res.json()) as { email: string; name: string };

  return {
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token!,
    email: userInfo.email,
    name: userInfo.name,
  };
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const client = getClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials.access_token!;
}
