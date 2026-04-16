// tests/integration.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../src/db/migrations";
import { handleCreateGuest, handleListGuests, handleRevokeGuest, handleDeleteGuest } from "../src/routes/guests";
import { handlePinRedeem } from "../src/routes/pin-auth";
import { handleUpdateHousehold } from "../src/routes/household";
import { handleGetSuggestions } from "../src/routes/chat";
import { handleListDocuments, handleDeleteDocument, handleGetContent } from "../src/routes/documents";

describe("integration: full guest lifecycle", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "owner@test.com", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(
      "h1", "Test Home", new Date().toISOString()
    );
    db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)").run(
      "hm1", "h1", "p1", new Date().toISOString()
    );
  });

  it("owner creates guest → guest redeems PIN → owner revokes → owner deletes", async () => {
    // 1. Owner creates guest
    const created = await handleCreateGuest(db, "h1", "p1", {
      name: "Maria",
      email: "maria@test.com",
    });
    expect(created.status).toBe(200);
    const guestId = created.body.guest.id;
    const pin = created.body.pin;

    // 2. Guest list shows pending
    const list1 = handleListGuests(db, "h1");
    expect(list1.body.guests[0].status).toBe("pending");

    // 3. Guest redeems PIN
    const redeemed = await handlePinRedeem(db, { pin }, "test-secret");
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.token).toBeTruthy();
    expect(redeemed.body.role).toBe("guest");

    // 4. Guest is now active
    const list2 = handleListGuests(db, "h1");
    expect(list2.body.guests[0].status).toBe("active");

    // 5. Owner revokes
    const revoked = handleRevokeGuest(db, "h1", guestId);
    expect(revoked.status).toBe(200);

    // 6. Guest is revoked
    const list3 = handleListGuests(db, "h1");
    expect(list3.body.guests[0].status).toBe("revoked");

    // 7. Owner deletes
    const deleted = handleDeleteGuest(db, "h1", guestId);
    expect(deleted.status).toBe(204);

    // 8. Guest list empty
    const list4 = handleListGuests(db, "h1");
    expect(list4.body.guests).toHaveLength(0);
  });

  it("household name update works", () => {
    const result = handleUpdateHousehold(db, "h1", { name: "The Anderson Home" });
    expect(result.status).toBe(200);
    expect(result.body.name).toBe("The Anderson Home");
  });

  it("suggestions return empty when no docs connected", () => {
    const result = handleGetSuggestions(db, "h1");
    expect(result.body.suggestions).toEqual([]);
  });

  it("document content returns cached markdown", () => {
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d1", "h1", "drive1", "House Rules", "## Rules\nNo shoes inside.", "ready", new Date().toISOString());

    const result = handleGetContent(db, "h1", "d1");
    expect(result.status).toBe(200);
    expect(result.body.markdown).toContain("No shoes inside");
  });
});
