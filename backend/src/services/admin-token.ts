import { randomBytes } from "crypto";

// base32 RFC 4648 alphabet
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

let currentToken: string | null = null;

export function mintAdminToken(): string {
  currentToken = "hadm_" + base32(randomBytes(16));
  return currentToken;
}

export function getAdminToken(): string | null {
  return currentToken;
}

export function verifyAdminToken(candidate: string | null | undefined): boolean {
  if (!currentToken || !candidate) return false;
  if (candidate.length !== currentToken.length) return false;
  // Simple constant-time-ish compare
  let diff = 0;
  for (let i = 0; i < currentToken.length; i++) {
    diff |= currentToken.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return diff === 0;
}
