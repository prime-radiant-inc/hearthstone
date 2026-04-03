import { randomBytes } from "crypto";

// UUIDv7: time-sortable, index-friendly
// Structure: timestamp (48 bits) + version (4 bits) + random (12 bits) + variant (2 bits) + random (62 bits)
export function generateId(): string {
  const now = Date.now();
  const bytes = new Uint8Array(16);

  // Timestamp (48 bits, big-endian)
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Random bytes for the rest
  const rand = randomBytes(10);
  bytes.set(rand, 6);

  // Version 7
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  // Format as UUID string
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
