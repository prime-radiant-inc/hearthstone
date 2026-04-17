import type { Database } from "bun:sqlite";
import { statSync } from "fs";
import QRCode from "qrcode";
import { generateId } from "../utils";
import { createAuthPin } from "../services/pins";
import { deleteHouseholdCascade } from "../services/household-deletion";
import { renderAdminPage } from "../html/admin-page";
import type { RateLimiter } from "../middleware/rate-limit";

export function handleAdminAuth(
  tokenFromQuery: string | null,
  validToken: string | null,
  secure: boolean,
): { status: number; headers: Record<string, string> } {
  if (!tokenFromQuery || !validToken || tokenFromQuery !== validToken) {
    return { status: 401, headers: {} };
  }
  // `Secure` is only honored over HTTPS — on plain HTTP (localhost dev) the
  // browser silently drops any Secure cookie, leaving the admin redirect
  // unauthenticated. Callers pass `true` in production (public URL is https)
  // and `false` for local http dev.
  const secureFlag = secure ? " Secure;" : "";
  return {
    status: 302,
    headers: {
      "Set-Cookie": `hadm=${validToken}; HttpOnly;${secureFlag} SameSite=Strict; Path=/`,
      Location: "/admin",
    },
  };
}

export function handleAdminPage(): { status: number; body: string } {
  return { status: 200, body: renderAdminPage() };
}

// Server-side QR render. See docs/superpowers/specs/2026-04-11-multi-server-app-design.md
// for why this must not call an external service: the join URL contains a
// single-use PIN and can never leave this process.
async function renderJoinQR(joinUrl: string): Promise<string> {
  return QRCode.toString(joinUrl, {
    type: "svg",
    margin: 1,
    width: 220,
    errorCorrectionLevel: "M",
    color: { dark: "#3d3529", light: "#faf9f6" },
  });
}

export function handleAdminHouses(db: Database): { status: number; body: any } {
  const houses = db.prepare(`
    SELECT
      h.id, h.name, h.created_at,
      (SELECT COUNT(*) FROM household_members hm WHERE hm.household_id = h.id AND hm.role = 'owner') as owner_count,
      (SELECT COUNT(*) FROM guests g WHERE g.household_id = h.id) as guest_count,
      (SELECT COUNT(*) FROM documents d WHERE d.household_id = h.id) as document_count
    FROM households h
    ORDER BY h.created_at DESC
  `).all();
  return { status: 200, body: { houses } };
}

export async function handleAdminCreateHouse(
  db: Database,
  body: { name: string; owner_name?: string },
  publicUrl: string
): Promise<{ status: number; body: any }> {
  if (!body?.name || !body.name.trim()) {
    return { status: 422, body: { message: "Name is required" } };
  }

  const houseId = generateId();
  const name = body.name.trim();
  const ownerName = (body.owner_name ?? "").trim();
  const now = new Date().toISOString();

  // Create a synthetic placeholder person for the first owner PIN.
  // The placeholder's `name` is whatever the admin typed when creating
  // the house — when the owner redeems, that name is already on the
  // person row, so the dashboard never has to ask "what's your name?".
  // If the admin left it blank we store an empty string and fall back
  // to the dashboard's reactive prompt.
  // The sentinel prefix `__placeholder__` is filtered out of every API
  // response by `publicEmail` in utils.ts — see routes/pin-auth, routes/owners,
  // and the /me handler in index.ts. The row itself stays in the DB because
  // the persons.email column is UNIQUE NOT NULL and auth_pins.person_id FKs
  // against it; we can't clear it without risking collisions on multiple
  // pending placeholder houses.
  const placeholderEmail = `__placeholder__-${houseId}@local`;
  const personId = generateId();
  db.prepare("INSERT INTO persons (id, email, name, created_at) VALUES (?, ?, ?, ?)")
    .run(personId, placeholderEmail, ownerName, now);

  db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)")
    .run(houseId, name, now);
  db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)")
    .run(generateId(), houseId, personId, now);

  const { pin } = createAuthPin(db, { role: "owner", personId, householdId: houseId });
  const joinUrl = `${publicUrl}/join/${pin}`;
  const qrSvg = await renderJoinQR(joinUrl);

  return {
    status: 200,
    body: {
      house: { id: houseId, name, created_at: now },
      pin,
      join_url: joinUrl,
      qr_svg: qrSvg,
    },
  };
}

export async function handleAdminInviteOwner(
  db: Database,
  houseId: string,
  body: { owner_name?: string } | null,
  publicUrl: string
): Promise<{ status: number; body: any }> {
  const house = db.prepare(
    "SELECT id, name, created_at FROM households WHERE id = ?"
  ).get(houseId) as { id: string; name: string; created_at: string } | undefined;
  if (!house) return { status: 404, body: { message: "House not found" } };

  // Each re-invite mints its own placeholder person so we never reuse a
  // PIN and never mutate a redeemed owner's row. The placeholder is filtered
  // from API responses by `publicEmail`, same as the first-owner path.
  // owner_name is optional — when supplied, the redeeming owner skips the
  // "what's your name?" prompt because their person row already carries it.
  const ownerName = (body?.owner_name ?? "").trim();
  const now = new Date().toISOString();
  const personId = generateId();
  const placeholderEmail = `__placeholder__-${houseId}-${personId}@local`;
  db.prepare("INSERT INTO persons (id, email, name, created_at) VALUES (?, ?, ?, ?)")
    .run(personId, placeholderEmail, ownerName, now);
  db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)")
    .run(generateId(), houseId, personId, now);

  const { pin } = createAuthPin(db, { role: "owner", personId, householdId: houseId });
  const joinUrl = `${publicUrl}/join/${pin}`;
  const qrSvg = await renderJoinQR(joinUrl);

  return {
    status: 200,
    body: {
      house: { id: house.id, name: house.name, created_at: house.created_at },
      pin,
      join_url: joinUrl,
      qr_svg: qrSvg,
    },
  };
}

export function handleAdminInfo(
  db: Database,
  publicUrl: string,
  dbPath: string,
  version: string
): { status: number; body: any } {
  let size = 0;
  try { size = statSync(dbPath).size; } catch { /* ignore */ }
  return {
    status: 200,
    body: {
      public_url: publicUrl,
      db_file_size_bytes: size,
      version,
    },
  };
}

export function handleAdminDeleteHouse(
  db: Database,
  houseId: string,
): { status: number; body: any } {
  const house = db.prepare("SELECT id FROM households WHERE id = ?").get(houseId);
  if (!house) return { status: 404, body: { message: "House not found" } };
  deleteHouseholdCascade(db, houseId);
  return { status: 204, body: null };
}

export function handleAdminRateLimits(
  rl: RateLimiter,
): { status: number; body: any } {
  return { status: 200, body: rl.admin() };
}

export function handleAdminClearRateLimit(
  rl: RateLimiter,
  body: { key?: string } | null,
): { status: number; body: any } {
  const key = body?.key?.trim();
  if (!key) return { status: 422, body: { message: "key is required" } };
  rl.clear(key);
  return { status: 204, body: null };
}
