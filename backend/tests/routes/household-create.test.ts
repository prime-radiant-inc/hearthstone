import { describe, it, expect } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { handleCreateHousehold } from "../../src/routes/household-create";

describe("POST /household (create)", () => {
  it("creates a household for a person who has none", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "owner@test.com", new Date().toISOString()
    );

    const result = handleCreateHousehold(db, "p1", { name: "The Anderson Home" });
    expect(result.status).toBe(200);
    expect(result.body.name).toBe("The Anderson Home");
    expect(result.body.id).toBeTruthy();
  });

  it("returns 422 if name is empty", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
      "p1", "owner@test.com", new Date().toISOString()
    );

    const result = handleCreateHousehold(db, "p1", { name: "" });
    expect(result.status).toBe(422);
  });
});
