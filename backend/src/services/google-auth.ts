// src/services/google-auth.ts
import { OAuth2Client } from "google-auth-library";
import { config } from "../config";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
];

function getClient(redirectUri?: string): OAuth2Client {
  return new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret,
    redirectUri ?? `${config.appBaseUrl}/auth/google/callback`
  );
}

export function getDriveAuthUrl(state: string, redirectUri: string): string {
  const client = getClient(redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state,
    prompt: "consent",
  });
}

export async function exchangeCodeForDrive(
  code: string,
  redirectUri: string
): Promise<{
  refreshToken: string;
  accessToken: string;
  email?: string;
}> {
  const client = getClient(redirectUri);
  const { tokens } = await client.getToken(code);

  // Try to get the email associated with the Google account for display
  let email: string | undefined;
  try {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${tokens.access_token}`
    );
    if (res.ok) {
      const info = (await res.json()) as { email?: string };
      email = info.email;
    }
  } catch {
    // email is optional, swallow errors
  }

  return {
    refreshToken: tokens.refresh_token!,
    accessToken: tokens.access_token!,
    email,
  };
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const client = getClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials.access_token!;
}
