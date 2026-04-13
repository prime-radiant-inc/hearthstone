/**
 * API Contract Tests
 *
 * These tests verify that every endpoint's response body matches the shape
 * defined in the API spec (.brainstorm/spec.md). They catch field name
 * mismatches, missing fields, and wrong types BEFORE they reach the iOS app.
 *
 * If you change a response shape, update the spec first, then update these tests.
 * If a test fails, the spec is the source of truth — fix the handler, not the test.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb } from "./helpers";
import { Database } from "bun:sqlite";

import { handleRegister, handleRegisterVerify, handleLoginEmail, handleLoginEmailVerify, handleInviteRedeem } from "../src/routes/auth";
import { handleCreateHousehold } from "../src/routes/household-create";
import { handleUpdateHousehold } from "../src/routes/household";
import { handleListGuests, handleCreateGuest, handleRevokeGuest, handleReinviteGuest, handleDeleteGuest } from "../src/routes/guests";
import { handleInviteOwner, handleListOwners } from "../src/routes/owners";
import { handleJoinPage } from "../src/routes/join";
import {
  handleAdminHouses,
  handleAdminCreateHouse,
  handleAdminInfo,
  handleAdminAuth,
} from "../src/routes/admin";
import { handleListDocuments, handleConnectDocument, handleDeleteDocument, handleGetContent } from "../src/routes/documents";
import { handleListConnections } from "../src/routes/connections";
import { handleGetSuggestions } from "../src/routes/chat";
import { generateInviteToken } from "../src/services/tokens";
import { handlePinRedeem } from "../src/routes/pin-auth";
import { createAuthPin } from "../src/services/pins";

// --- Helpers ---

function hasExactKeys(obj: any, keys: string[]) {
  const actual = Object.keys(obj).sort();
  const expected = keys.sort();
  expect(actual).toEqual(expected);
}

function seedOwner(db: Database): string {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "owner@test.com", now);
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run("h1", "p1", "Test Home", now);
  db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)").run("hm1", "h1", "p1", now);
  return "h1";
}

function seedGuest(db: Database, householdId: string, status = "active"): string {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("g1", householdId, "Maria", "maria@test.com", "email", status, now);
  return "g1";
}

function seedDocument(db: Database, householdId: string): string {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, chunk_count, last_synced, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("d1", householdId, "drive1", "House Ops", "# Ops\nContent", "ready", 3, now, now);
  return "d1";
}

// ============================================================
// AUTH
// ============================================================

describe("API Contract: POST /auth/register", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { message, email }", async () => {
    const result = await handleRegister(db, { email: "alice@test.com" });
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["message", "email"]);
    expect(typeof result.body.message).toBe("string");
    expect(typeof result.body.email).toBe("string");
  });
});

describe("API Contract: POST /auth/register/verify", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { token, person, household, is_new }", async () => {
    await handleRegister(db, { email: "alice@test.com" });
    const code = (db.prepare("SELECT code FROM email_verifications WHERE email = ?").get("alice@test.com") as any).code;
    const result = await handleRegisterVerify(db, { email: "alice@test.com", code });
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["token", "person", "household", "is_new"]);
    hasExactKeys(result.body.person, ["id", "email", "name"]);
    expect(typeof result.body.token).toBe("string");
  });
});

describe("API Contract: POST /auth/invite/redeem", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { session_token, guest: { id, name, household_id }, household_name }", async () => {
    const hid = seedOwner(db);
    seedGuest(db, hid, "pending");
    const invite = generateInviteToken(db, hid, "g1");

    const result = await handleInviteRedeem(db, { invite_token: invite.token });
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["session_token", "guest", "household_name"]);
    hasExactKeys(result.body.guest, ["id", "name", "household_id"]);
    expect(typeof result.body.session_token).toBe("string");
    expect(typeof result.body.household_name).toBe("string");
  });
});

// ============================================================
// HOUSEHOLD
// ============================================================

describe("API Contract: POST /household", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { id, name, created_at }", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "owner@test.com", now);
    const result = handleCreateHousehold(db, "p1", { name: "My Home" });
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["id", "name", "created_at"]);
  });
});

describe("API Contract: PATCH /household", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { id, name, created_at }", () => {
    seedOwner(db);
    const result = handleUpdateHousehold(db, "h1", { name: "New Name" });
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["id", "name", "created_at"]);
  });
});

// ============================================================
// GUESTS
// ============================================================

describe("API Contract: GET /guests", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { guests: [{ id, name, contact, contact_type, status, created_at }] }", () => {
    const hid = seedOwner(db);
    seedGuest(db, hid);
    const result = handleListGuests(db, hid);
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["guests"]);
    expect(result.body.guests).toHaveLength(1);
    hasExactKeys(result.body.guests[0], ["id", "name", "contact", "contact_type", "status", "created_at"]);
  });
});

describe("API Contract: POST /guests", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { guest: { id, name, status }, pin, join_url, expires_at }", async () => {
    const hid = seedOwner(db);
    const result = await handleCreateGuest(db, hid, "p1", { name: "Maria", email: "maria@test.com" }, "http://test.example");
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["guest", "pin", "join_url", "expires_at"]);
    hasExactKeys(result.body.guest, ["id", "name", "status"]);
    expect(result.body.pin).toMatch(/^\d{6}$/);
    expect(typeof result.body.join_url).toBe("string");
    expect(result.body.join_url).toContain(`/join/${result.body.pin}`);
  });
});

describe("API Contract: POST /guests/:id/revoke", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { guest_id, revoked_at }", () => {
    const hid = seedOwner(db);
    seedGuest(db, hid, "active");
    const result = handleRevokeGuest(db, hid, "g1");
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["guest_id", "revoked_at"]);
  });
});

describe("API Contract: POST /guests/:id/reinvite", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { pin, join_url, expires_at }", () => {
    const hid = seedOwner(db);
    seedGuest(db, hid, "pending");
    const result = handleReinviteGuest(db, hid, "p1", "g1", "http://test.example");
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["pin", "join_url", "expires_at"]);
    expect(result.body.pin).toMatch(/^\d{6}$/);
    expect(result.body.join_url).toContain(`/join/${result.body.pin}`);
  });
});

describe("API Contract: POST /household/owners", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { pin, join_url, expires_at }", () => {
    const hid = seedOwner(db);
    const result = handleInviteOwner(
      db,
      hid,
      "p1",
      { name: "Jamie", email: "jamie@test.com" },
      "http://test.example"
    );
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["pin", "join_url", "expires_at"]);
    expect(result.body.pin).toMatch(/^\d{6}$/);
    expect(result.body.join_url).toContain(`/join/${result.body.pin}`);
  });
});

// ============================================================
// DOCUMENTS
// ============================================================

describe("API Contract: GET /documents", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { documents: [{ id, title, drive_file_id, status, chunk_count, last_synced }] }", () => {
    const hid = seedOwner(db);
    seedDocument(db, hid);
    const result = handleListDocuments(db, hid);
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["documents"]);
    expect(result.body.documents).toHaveLength(1);
    hasExactKeys(result.body.documents[0], ["id", "title", "drive_file_id", "status", "chunk_count", "last_synced"]);
  });
});

describe("API Contract: GET /documents/:id/content", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { id, title, markdown, html }", () => {
    const hid = seedOwner(db);
    seedDocument(db, hid);
    const result = handleGetContent(db, hid, "d1");
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["id", "title", "markdown", "html"]);
  });
});

// ============================================================
// CONNECTIONS
// ============================================================

describe("API Contract: GET /connections", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { connections: [{ id, provider, email, created_at }] }", () => {
    const hid = seedOwner(db);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO connections (id, household_id, provider, refresh_token, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("c1", hid, "google_drive", "refresh_tok", "owner@gmail.com", now);
    const result = handleListConnections(db, hid);
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["connections"]);
    expect(result.body.connections).toHaveLength(1);
    hasExactKeys(result.body.connections[0], ["id", "provider", "email", "created_at"]);
  });
});

// ============================================================
// CHAT
// ============================================================

describe("API Contract: GET /chat/suggestions", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { suggestions: string[] }", () => {
    const hid = seedOwner(db);
    const result = handleGetSuggestions(db, hid);
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["suggestions"]);
    expect(Array.isArray(result.body.suggestions)).toBe(true);
  });
});

// ============================================================
// PIN AUTH
// ============================================================

describe("API Contract: POST /auth/pin/redeem (owner)", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { token, role, person, household }", async () => {
    const hid = seedOwner(db);
    const { pin } = createAuthPin(db, { role: "owner", personId: "p1", householdId: hid });
    const result = await handlePinRedeem(db, { pin }, "test-secret");
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["token", "role", "person", "household"]);
    expect(result.body.role).toBe("owner");
    hasExactKeys(result.body.person, ["id", "email", "name"]);
    hasExactKeys(result.body.household, ["id", "name", "created_at"]);
  });
});

describe("API Contract: POST /auth/pin/redeem (guest)", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { token, role, guest, household_name }", async () => {
    const hid = seedOwner(db);
    seedGuest(db, hid, "pending");
    const { pin } = createAuthPin(db, { role: "guest", personId: "p1", householdId: hid, guestId: "g1" });
    const result = await handlePinRedeem(db, { pin }, "test-secret");
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["token", "role", "guest", "household_name"]);
    expect(result.body.role).toBe("guest");
    hasExactKeys(result.body.guest, ["id", "name", "household_id"]);
  });
});

// ============================================================
// JOIN PAGE
// ============================================================

describe("Contract: GET /join/:pin", () => {
  it("returns HTML with embedded custom scheme for a 6-digit PIN", () => {
    const result = handleJoinPage("123456", "https://server.example");
    expect(result.status).toBe(200);
    expect(result.contentType).toContain("text/html");
    expect(result.body).toContain("hearthstone://join?");
    expect(result.body).toContain("server=https%3A%2F%2Fserver.example");
    expect(result.body).toContain("pin=123456");
    expect(result.body).toContain("Open in Hearthstone");
  });

  it("returns 404 for malformed PIN", () => {
    const result = handleJoinPage("abc", "https://server.example");
    expect(result.status).toBe(404);
  });
});

// ============================================================
// ADMIN
// ============================================================

describe("API Contract: GET /admin/houses", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { houses: [{ id, name, created_at, owner_count, guest_count, document_count }] }", () => {
    seedOwner(db);
    seedGuest(db, "h1");
    seedDocument(db, "h1");
    const result = handleAdminHouses(db);
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["houses"]);
    expect(result.body.houses).toHaveLength(1);
    hasExactKeys(result.body.houses[0], ["id", "name", "created_at", "owner_count", "guest_count", "document_count"]);
    expect(result.body.houses[0].owner_count).toBe(1);
    expect(result.body.houses[0].guest_count).toBe(1);
    expect(result.body.houses[0].document_count).toBe(1);
  });
});

describe("API Contract: POST /admin/houses", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { house: { id, name, created_at }, pin, join_url, qr_svg }", async () => {
    const result = await handleAdminCreateHouse(db, { name: "New Place" }, "http://test.example");
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["house", "pin", "join_url", "qr_svg"]);
    hasExactKeys(result.body.house, ["id", "name", "created_at"]);
    expect(result.body.pin).toMatch(/^\d{6}$/);
    expect(result.body.join_url).toBe(`http://test.example/join/${result.body.pin}`);
    expect(result.body.qr_svg).toMatch(/^<svg[\s\S]+<\/svg>\s*$/);
  });
});

describe("Placeholder email is never leaked through admin-create → redeem → list owners", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("pin redeem and owner list both return empty email, not the __placeholder__ sentinel", async () => {
    // 1. Admin creates a house. This inserts a synthetic persons row
    //    with a `__placeholder__-<houseId>@local` email.
    const created = await handleAdminCreateHouse(db, { name: "Placeholder Home" }, "http://test.example");
    expect(created.status).toBe(200);
    const pin = created.body.pin as string;
    const houseId = created.body.house.id as string;

    // Sanity: the raw row does carry the sentinel prefix.
    const rawPerson = db.prepare(
      "SELECT p.email FROM household_members hm JOIN persons p ON p.id = hm.person_id WHERE hm.household_id = ?"
    ).get(houseId) as any;
    expect(rawPerson.email).toMatch(/^__placeholder__/);

    // 2. Owner redeems the PIN. The response's person.email must be "".
    const redeemed = await handlePinRedeem(db, { pin }, "test-secret");
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.person.email).toBe("");
    expect(redeemed.body.person.email).not.toContain("__placeholder__");

    // 3. GET /household/owners must scrub the same row.
    const owners = handleListOwners(db, houseId);
    expect(owners.status).toBe(200);
    expect(owners.body.owners).toHaveLength(1);
    expect(owners.body.owners[0].email).toBe("");
    expect(owners.body.owners[0].email).not.toContain("__placeholder__");
    hasExactKeys(owners.body.owners[0], ["id", "name", "email", "created_at"]);
  });
});

describe("API Contract: GET /admin/info", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("response has { public_url, db_file_size_bytes, version }", () => {
    const result = handleAdminInfo(db, "http://test.example", "./nonexistent.db", "0.2.0");
    expect(result.status).toBe(200);
    hasExactKeys(result.body, ["public_url", "db_file_size_bytes", "version"]);
    expect(result.body.public_url).toBe("http://test.example");
    expect(result.body.version).toBe("0.2.0");
  });
});

describe("Admin auth flow", () => {
  it("handleAdminAuth rejects missing token", () => {
    const result = handleAdminAuth(null, "hadm_valid");
    expect(result.status).toBe(401);
  });

  it("handleAdminAuth rejects wrong token", () => {
    const result = handleAdminAuth("hadm_wrong", "hadm_valid");
    expect(result.status).toBe(401);
  });

  it("accepts both GET and POST on /admin/auth (routing contract)", () => {
    // The handler itself is a pure function of (queryToken, validToken) — it
    // doesn't look at the HTTP verb. The route dispatch in src/index.ts
    // registers the same handler for `GET /admin/auth` and
    // `POST /admin/auth` on purpose: operators click the admin URL from
    // `fly logs` (a GET) and curl/scripts use POST. If either branch gets
    // dropped, this will be the test that hangs the PR until it's put back.
    const indexSource = require("fs").readFileSync(
      require("path").join(__dirname, "..", "src", "index.ts"),
      "utf-8"
    ) as string;
    expect(indexSource).toContain('method === "POST" && pathname === "/admin/auth"');
    expect(indexSource).toContain('method === "GET" && pathname === "/admin/auth"');
  });

  it("handleAdminAuth 302s and sets cookie on match", () => {
    const result = handleAdminAuth("hadm_valid", "hadm_valid");
    expect(result.status).toBe(302);
    expect(result.headers["Set-Cookie"]).toContain("hadm=hadm_valid");
    expect(result.headers["Set-Cookie"]).toContain("HttpOnly");
    expect(result.headers["Set-Cookie"]).toContain("Secure");
    expect(result.headers["Set-Cookie"]).toContain("SameSite=Strict");
    expect(result.headers.Location).toBe("/admin");
  });
});
