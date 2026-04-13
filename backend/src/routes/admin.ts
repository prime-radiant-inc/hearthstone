import type { Database } from "bun:sqlite";
import { statSync } from "fs";
import QRCode from "qrcode";
import { generateId } from "../utils";
import { createAuthPin } from "../services/pins";
import { renderAdminPage } from "../html/admin-page";

export function handleAdminAuth(
  tokenFromQuery: string | null,
  validToken: string | null
): { status: number; headers: Record<string, string> } {
  if (!tokenFromQuery || !validToken || tokenFromQuery !== validToken) {
    return { status: 401, headers: {} };
  }
  return {
    status: 302,
    headers: {
      "Set-Cookie": `hadm=${validToken}; HttpOnly; Secure; SameSite=Strict; Path=/`,
      Location: "/admin",
    },
  };
}

export function handleAdminPage(): { status: number; body: string } {
  return { status: 200, body: renderAdminPage() };
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
  body: { name: string },
  publicUrl: string
): Promise<{ status: number; body: any }> {
  if (!body?.name || !body.name.trim()) {
    return { status: 422, body: { message: "Name is required" } };
  }

  const houseId = generateId();
  const name = body.name.trim();
  const now = new Date().toISOString();

  // Create a synthetic placeholder person for the first owner PIN.
  // When the PIN is redeemed, the real person record is created/updated.
  // The sentinel prefix `__placeholder__` is filtered out of every API
  // response by `publicEmail` in utils.ts — see routes/pin-auth, routes/owners,
  // and the /me handler in index.ts. The row itself stays in the DB because
  // the persons.email column is UNIQUE NOT NULL and auth_pins.person_id FKs
  // against it; we can't clear it without risking collisions on multiple
  // pending placeholder houses.
  const placeholderEmail = `__placeholder__-${houseId}@local`;
  const personId = generateId();
  db.prepare("INSERT INTO persons (id, email, name, created_at) VALUES (?, ?, ?, ?)")
    .run(personId, placeholderEmail, "", now);

  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)")
    .run(houseId, personId, name, now);
  db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)")
    .run(generateId(), houseId, personId, now);

  const { pin } = createAuthPin(db, { role: "owner", personId, householdId: houseId });
  const joinUrl = `${publicUrl}/join/${pin}`;

  // Server-side QR render. See docs/superpowers/specs/2026-04-11-multi-server-app-design.md
  // for why this must not call an external service.
  const qrSvg = await QRCode.toString(joinUrl, {
    type: "svg",
    margin: 1,
    width: 220,
    errorCorrectionLevel: "M",
    color: { dark: "#3d3529", light: "#faf9f6" },
  });

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
