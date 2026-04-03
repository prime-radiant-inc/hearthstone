import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { SignJWT } from "jose";
import { authenticateOwner } from "../../src/middleware/owner-auth";

async function createOwnerJwt(personId: string, householdId: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  return new SignJWT({ personId, householdId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(encoder.encode(secret));
}

describe("owner auth middleware", () => {
  let db: Database.Database;
  const secret = "test-secret";

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "owner@test.com", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
  });

  it("returns person and household for valid JWT", async () => {
    const token = await createOwnerJwt("p1", "h1", secret);
    const result = await authenticateOwner(db, `Bearer ${token}`, secret);
    expect(result.personId).toBe("p1");
    expect(result.householdId).toBe("h1");
  });

  it("throws for missing Authorization header", async () => {
    expect(authenticateOwner(db, undefined, secret)).rejects.toThrow("unauthorized");
  });

  it("throws for invalid JWT", async () => {
    expect(authenticateOwner(db, "Bearer garbage", secret)).rejects.toThrow("unauthorized");
  });
});
