// src/services/passkey.ts
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server/script/deps";
import { config } from "../config";

const rpName = "Hearthstone";
const rpID = config.webauthnRpId;
const origin = config.appBaseUrl;

// In-memory challenge store, keyed by personId or email
// Good enough for v1; swap for Redis/DB in production
const challengeStore = new Map<string, string>();

export async function getRegistrationOptions(personId: string, email: string) {
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: email,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  challengeStore.set(personId, options.challenge);
  return options;
}

export async function verifyRegistration(
  personId: string,
  credential: RegistrationResponseJSON,
  expectedChallenge?: string
) {
  const challenge = expectedChallenge ?? challengeStore.get(personId);
  if (!challenge) throw new Error("no_challenge");

  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  challengeStore.delete(personId);
  return verification;
}

export async function getAuthenticationOptions(
  email: string,
  credentials: Array<{ credential_id: string; transports?: string }>
) {
  const allowCredentials = credentials.map((c) => ({
    id: c.credential_id,
    transports: c.transports
      ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
      : undefined,
  }));

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: "preferred",
  });

  challengeStore.set(email, options.challenge);
  return options;
}

export async function verifyAuthentication(
  email: string,
  credential: AuthenticationResponseJSON,
  storedCredential: {
    credential_id: string;
    public_key: string;
    counter: number;
  },
  expectedChallenge?: string
) {
  const challenge = expectedChallenge ?? challengeStore.get(email);
  if (!challenge) throw new Error("no_challenge");

  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: storedCredential.credential_id,
      publicKey: new Uint8Array(
        Buffer.from(storedCredential.public_key, "base64")
      ),
      counter: storedCredential.counter,
    },
  });

  challengeStore.delete(email);
  return verification;
}
