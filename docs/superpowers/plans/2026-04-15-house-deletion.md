# House Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement v1 house deletion — admin can delete houses via admin UI, iOS clients detect the deletion cleanly via HTTP 410.

**Architecture:** Single `deleteHouseholdCascade` helper handles all deletion logic inside a SQLite transaction. Server-side `assertHouseholdExists` pre-check on authenticated routes returns 410 Gone. iOS detects 410 and removes the dead session from SessionStore.

**Tech Stack:** TypeScript/Bun backend, bun:sqlite, sqlite-vec, SwiftUI iOS client

**Spec:** `docs/superpowers/specs/2026-04-13-house-deletion-design.md`

---

## File Structure

**Create:**
- `backend/src/services/household-deletion.ts` — `deleteHouseholdCascade(db, houseId)`

**Modify (backend):**
- `backend/src/db/schema.ts` — remove `owner_id` from households CREATE TABLE
- `backend/src/db/migrations.ts` — add owner_id data migration + DROP COLUMN
- `backend/src/routes/household-create.ts` — remove owner_id from INSERT
- `backend/src/routes/admin.ts` — remove owner_id from INSERT, add `handleAdminDeleteHouse`
- `backend/src/routes/owners.ts` — change last-owner guard from 422 to 409 with household_name
- `backend/src/index.ts` — wire DELETE /admin/houses/:id, add 410 error mapper for HouseholdGoneError
- `backend/src/html/admin-page.ts` — add delete button + confirmation modal
- `backend/tests/helpers.ts` — update seedOwner to omit owner_id
- `backend/tests/api-contract.test.ts` — add cascade, 410, last-owner, admin-delete tests

**Modify (iOS):**
- `ios/Hearthstone/Services/APIClient.swift` — detect 410, post .houseDeleted notification
- `ios/Hearthstone/HearthstoneApp.swift` — AppRouter subscribes to .houseDeleted

---

### Task 1: Schema migration — drop households.owner_id

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/migrations.ts`
- Modify: `backend/src/routes/household-create.ts`
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/tests/helpers.ts`
- Modify: `backend/tests/api-contract.test.ts`

- [ ] **Step 1: Remove owner_id from SCHEMA_SQL**

In `backend/src/db/schema.ts`, change the households table:

```ts
  CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
```

Remove the `owner_id TEXT NOT NULL REFERENCES persons(id),` line.

- [ ] **Step 2: Guard the owner_id migration in migrations.ts**

In `backend/src/db/migrations.ts`, wrap the existing owner_id migration (lines 42-53) in a column-existence check, and add the DROP COLUMN after:

```ts
  // Migrate owner_id → household_members, then drop the column
  const householdCols = db.prepare("PRAGMA table_info(households)").all() as any[];
  if (householdCols.some((c: any) => c.name === "owner_id")) {
    const households = db.prepare("SELECT id, owner_id, created_at FROM households").all() as any[];
    for (const h of households) {
      const exists = db.prepare(
        "SELECT id FROM household_members WHERE household_id = ? AND person_id = ?"
      ).get(h.id, h.owner_id);
      if (!exists) {
        db.prepare(
          "INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)"
        ).run(crypto.randomUUID(), h.id, h.owner_id, h.created_at);
      }
    }
    db.run("ALTER TABLE households DROP COLUMN owner_id");
  }
```

This replaces the existing lines 42-53. For fresh DBs (tests), the column doesn't exist so the block is skipped. For production, it migrates data then drops.

- [ ] **Step 3: Remove owner_id from INSERT statements**

In `backend/src/routes/household-create.ts` (line 17), change:

```ts
  db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(
    householdId, body.name.trim(), now
  );
```

In `backend/src/routes/admin.ts` (line 85), change:

```ts
  db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)")
    .run(houseId, name, now);
```

- [ ] **Step 4: Update test helpers**

In `backend/tests/helpers.ts`, update `seedOwner`:

```ts
function seedOwner(db: Database): string {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "owner@test.com", now);
  db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run("h1", "Test Home", now);
  db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)").run("hm1", "h1", "p1", now);
  return "h1";
}
```

In `backend/tests/api-contract.test.ts`, update the inline `seedOwner` at lines 42-48 with the same change (removing owner_id from the households INSERT).

- [ ] **Step 5: Run tests to verify migration works**

Run: `cd backend && bun test`
Expected: All existing tests pass. The schema change is backward-compatible because owner_id was never read for authorization.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/schema.ts backend/src/db/migrations.ts backend/src/routes/household-create.ts backend/src/routes/admin.ts backend/tests/helpers.ts backend/tests/api-contract.test.ts
git commit -m "schema: drop households.owner_id — authority lives in household_members"
```

---

### Task 2: deleteHouseholdCascade helper + contract tests

**Files:**
- Create: `backend/src/services/household-deletion.ts`
- Modify: `backend/tests/api-contract.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/api-contract.test.ts`:

```ts
import { deleteHouseholdCascade } from "../src/services/household-deletion";
```

At the end of the file:

```ts
// ============================================================
// HOUSEHOLD DELETION CASCADE
// ============================================================

describe("deleteHouseholdCascade", () => {
  let db: Database;
  beforeEach(() => { db = createTestDbWithVec(); });

  function seedFullHousehold(db: Database): string {
    const now = new Date().toISOString();
    // Person + household + member
    db.prepare("INSERT INTO persons (id, email, name, created_at) VALUES (?, ?, ?, ?)").run("p1", "owner@test.com", "Owner", now);
    db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run("h1", "Test Home", now);
    db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)").run("hm1", "h1", "p1", now);

    // Placeholder person (should be deleted)
    db.prepare("INSERT INTO persons (id, email, name, created_at) VALUES (?, ?, ?, ?)").run("p-ph", "__placeholder__-h1@local", "", now);
    db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)").run("hm-ph", "h1", "p-ph", now);

    // Guest + session token
    db.prepare("INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("g1", "h1", "Maria", "maria@test.com", "email", "active", now);
    db.prepare("INSERT INTO session_tokens (id, token, household_id, guest_id, created_at) VALUES (?, ?, ?, ?, ?)").run("st1", "tok1", "h1", "g1", now);

    // Auth pin
    db.prepare("INSERT INTO auth_pins (id, pin, role, person_id, household_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("ap1", "TESTPIN1", "owner", "p1", "h1", now, now);

    // Connection + document + chunk + embedding
    db.prepare("INSERT INTO connections (id, household_id, provider, refresh_token, email, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("c1", "h1", "google_drive", "refresh1", "owner@test.com", now);
    db.prepare("INSERT INTO documents (id, household_id, connection_id, drive_file_id, title, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("d1", "h1", "c1", "drive1", "House Ops", "ready", now);
    db.prepare("INSERT INTO chunks (id, document_id, household_id, chunk_index, heading, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("ch1", "d1", "h1", 0, "Ops", "Content here", now);

    // Embedding (vec0 virtual table)
    const zeros = new Float32Array(1536);
    db.prepare("INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)").run("ch1", Buffer.from(zeros.buffer));

    // Suggestion
    db.prepare("INSERT INTO suggestions (id, household_id, chips, created_at) VALUES (?, ?, ?, ?)").run("s1", "h1", '["What time is bedtime?"]', now);

    return "h1";
  }

  it("removes all referencing rows for the household", () => {
    seedFullHousehold(db);
    deleteHouseholdCascade(db, "h1");

    expect(db.prepare("SELECT COUNT(*) as c FROM households WHERE id = 'h1'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM household_members WHERE household_id = 'h1'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM guests WHERE household_id = 'h1'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM session_tokens WHERE household_id = 'h1'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM auth_pins WHERE household_id = 'h1'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM connections WHERE household_id = 'h1'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM documents WHERE household_id = 'h1'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM chunks WHERE household_id = 'h1'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM suggestions WHERE household_id = 'h1'").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM chunk_embeddings WHERE chunk_id = 'ch1'").get()).toEqual({ c: 0 });
  });

  it("preserves non-placeholder person rows", () => {
    seedFullHousehold(db);
    deleteHouseholdCascade(db, "h1");

    const real = db.prepare("SELECT id FROM persons WHERE id = 'p1'").get();
    expect(real).toBeTruthy();
  });

  it("deletes placeholder person rows", () => {
    seedFullHousehold(db);
    deleteHouseholdCascade(db, "h1");

    const placeholder = db.prepare("SELECT id FROM persons WHERE id = 'p-ph'").get();
    expect(placeholder).toBeNull();
  });

  it("does not affect other households", () => {
    seedFullHousehold(db);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p2", "other@test.com", now);
    db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run("h2", "Other Home", now);
    db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)").run("hm2", "h2", "p2", now);

    deleteHouseholdCascade(db, "h1");

    expect(db.prepare("SELECT COUNT(*) as c FROM households WHERE id = 'h2'").get()).toEqual({ c: 1 });
    expect(db.prepare("SELECT COUNT(*) as c FROM household_members WHERE household_id = 'h2'").get()).toEqual({ c: 1 });
  });
});
```

Note: use `createTestDbWithVec` (not `createTestDb`) because the cascade deletes from `chunk_embeddings` which requires sqlite-vec.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test tests/api-contract.test.ts`
Expected: FAIL — `deleteHouseholdCascade` not found.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/household-deletion.ts`:

```ts
import type { Database } from "bun:sqlite";

export function deleteHouseholdCascade(db: Database, houseId: string): void {
  db.transaction(() => {
    const chunkIds = db.prepare(
      "SELECT id FROM chunks WHERE household_id = ?"
    ).all(houseId) as Array<{ id: string }>;
    for (const { id } of chunkIds) {
      db.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?").run(id);
    }
    db.prepare("DELETE FROM chunks           WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM documents        WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM connections      WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM suggestions      WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM session_tokens   WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM auth_pins        WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM guests           WHERE household_id = ?").run(houseId);

    const placeholderIds = db.prepare(`
      SELECT p.id FROM household_members hm
      JOIN persons p ON p.id = hm.person_id
      WHERE hm.household_id = ? AND p.email LIKE '__placeholder__-%'
    `).all(houseId) as Array<{ id: string }>;

    db.prepare("DELETE FROM household_members WHERE household_id = ?").run(houseId);
    db.prepare("DELETE FROM households        WHERE id = ?").run(houseId);

    for (const { id } of placeholderIds) {
      db.prepare("DELETE FROM persons WHERE id = ?").run(id);
    }
  })();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && bun test tests/api-contract.test.ts`
Expected: All tests pass including the new cascade tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/household-deletion.ts backend/tests/api-contract.test.ts
git commit -m "feat: add deleteHouseholdCascade helper with contract tests"
```

---

### Task 3: Harden authenticateOwner + assertHouseholdExists + 410 error handling

**Files:**
- Modify: `backend/src/middleware/owner-auth.ts` — throw HouseholdGoneError when JWT names a deleted household (see spec "Hardening authenticateOwner" section)
- Modify: `backend/src/index.ts` — wire 410 error mapper, thread assertHouseholdExists as defense-in-depth
- Modify: `backend/src/services/household-deletion.ts` — add HouseholdGoneError + assertHouseholdExists
- Modify: `backend/tests/api-contract.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/api-contract.test.ts`:

```ts
// ============================================================
// 410 GONE — HOUSEHOLD DELETED
// ============================================================

describe("410 Gone after household deletion", () => {
  let db: Database;
  beforeEach(() => { db = createTestDbWithVec(); });

  it("assertHouseholdExists throws HouseholdGoneError when household is missing", () => {
    expect(() => assertHouseholdExists(db, "nonexistent")).toThrow();
  });

  it("assertHouseholdExists succeeds when household exists", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "a@b.com", now);
    db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run("h1", "Home", now);
    expect(() => assertHouseholdExists(db, "h1")).not.toThrow();
  });
});
```

Add the import at the top:

```ts
import { assertHouseholdExists, HouseholdGoneError } from "../src/services/household-deletion";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test tests/api-contract.test.ts`
Expected: FAIL — `assertHouseholdExists` not found.

- [ ] **Step 3: Add assertHouseholdExists to household-deletion.ts**

Append to `backend/src/services/household-deletion.ts`:

```ts
export class HouseholdGoneError extends Error {
  constructor() {
    super("house_deleted");
    this.name = "HouseholdGoneError";
  }
}

export function assertHouseholdExists(db: Database, householdId: string): void {
  const row = db.prepare("SELECT id FROM households WHERE id = ?").get(householdId);
  if (!row) throw new HouseholdGoneError();
}
```

- [ ] **Step 4: Wire 410 into the fetch handler error path in index.ts**

In `backend/src/index.ts`, add the import:

```ts
import { deleteHouseholdCascade, assertHouseholdExists, HouseholdGoneError } from "./services/household-deletion";
```

In the `tracedFetch` function's catch block (around line 574), add before the existing `throw err`:

```ts
  } catch (err: any) {
    if (err instanceof HouseholdGoneError) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "house_deleted" });
      span.end();
      return json({ message: "house_deleted" }, 410);
    }
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message || "unknown" });
```

- [ ] **Step 5: Thread assertHouseholdExists into owner-scoped routes**

In `backend/src/index.ts`, after each `authenticateOwner(...)` call, add:

```ts
assertHouseholdExists(getDb(), owner.householdId);
```

This applies to: GET /me, PATCH /me, POST /household, PATCH /household, GET /guests, POST /guests, POST /guests/:id/reinvite, POST /guests/:id/revoke, DELETE /guests/:id, GET /household/owners, POST /household/owners, DELETE /household/owners/:id, GET /connections, POST /connections/google-drive, GET /documents, POST /documents, POST /documents/upload, DELETE /documents/:id, GET /documents/:id/content, POST /chat, GET /suggestions, POST /chat/preview.

For guest-scoped routes (routes using `authenticateGuest`), thread it after the guest auth resolves the householdId.

- [ ] **Step 6: Run tests**

Run: `cd backend && bun test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/household-deletion.ts backend/src/index.ts backend/tests/api-contract.test.ts
git commit -m "feat: add assertHouseholdExists, return 410 Gone for deleted houses"
```

---

### Task 4: Last-owner self-removal guard (409)

**Files:**
- Modify: `backend/src/routes/owners.ts`
- Modify: `backend/tests/api-contract.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/api-contract.test.ts`:

```ts
// ============================================================
// LAST-OWNER GUARD
// ============================================================

describe("API Contract: DELETE /household/owners/:id — last-owner guard", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });

  it("returns 409 with last_owner and household_name when removing the only owner", () => {
    const hid = seedOwner(db);
    const result = handleRemoveOwner(db, hid, "p1");
    expect(result.status).toBe(409);
    hasExactKeys(result.body, ["message", "household_name"]);
    expect(result.body.message).toBe("last_owner");
    expect(result.body.household_name).toBe("Test Home");
  });

  it("returns 204 when removing a non-last owner", () => {
    const hid = seedOwner(db);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p2", "other@test.com", now);
    db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)").run("hm2", hid, "p2", now);

    const result = handleRemoveOwner(db, hid, "p1");
    expect(result.status).toBe(204);
  });
});
```

Add `handleRemoveOwner` to the existing import from `"../src/routes/owners"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test tests/api-contract.test.ts`
Expected: FAIL — the first test gets 422 instead of 409.

- [ ] **Step 3: Update handleRemoveOwner**

In `backend/src/routes/owners.ts`, change lines 92-98:

```ts
  if (count.count <= 1) {
    const house = db.prepare("SELECT name FROM households WHERE id = ?").get(householdId) as { name: string };
    return { status: 409, body: { message: "last_owner", household_name: house.name } };
  }
```

- [ ] **Step 4: Run tests**

Run: `cd backend && bun test tests/api-contract.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/owners.ts backend/tests/api-contract.test.ts
git commit -m "feat: last-owner guard returns 409 with household_name instead of 422"
```

---

### Task 5: DELETE /admin/houses/:id endpoint

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/tests/api-contract.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/api-contract.test.ts`:

```ts
import { handleAdminDeleteHouse } from "../src/routes/admin";
```

(Add `handleAdminDeleteHouse` to the existing admin import.)

```ts
// ============================================================
// ADMIN DELETE HOUSE
// ============================================================

describe("API Contract: DELETE /admin/houses/:id", () => {
  let db: Database;
  beforeEach(() => { db = createTestDbWithVec(); });

  it("returns 204 and removes all household data", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "owner@test.com", now);
    db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run("h1", "Test Home", now);
    db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)").run("hm1", "h1", "p1", now);
    db.prepare("INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("g1", "h1", "Maria", "m@t.com", "email", "active", now);

    const result = handleAdminDeleteHouse(db, "h1");
    expect(result.status).toBe(204);
    expect(db.prepare("SELECT COUNT(*) as c FROM households").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) as c FROM guests").get()).toEqual({ c: 0 });
  });

  it("returns 404 for nonexistent house", () => {
    const result = handleAdminDeleteHouse(db, "nonexistent");
    expect(result.status).toBe(404);
    expect(result.body.message).toBe("House not found");
  });

  it("preserves non-placeholder person rows", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run("p1", "owner@test.com", now);
    db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run("h1", "Test Home", now);
    db.prepare("INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)").run("hm1", "h1", "p1", now);

    handleAdminDeleteHouse(db, "h1");
    expect(db.prepare("SELECT id FROM persons WHERE id = 'p1'").get()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test tests/api-contract.test.ts`
Expected: FAIL — `handleAdminDeleteHouse` not exported.

- [ ] **Step 3: Add handleAdminDeleteHouse to admin.ts**

Add to `backend/src/routes/admin.ts`:

```ts
import { deleteHouseholdCascade } from "../services/household-deletion";

export function handleAdminDeleteHouse(
  db: Database,
  houseId: string,
): { status: number; body: any } {
  const house = db.prepare("SELECT id FROM households WHERE id = ?").get(houseId);
  if (!house) return { status: 404, body: { message: "House not found" } };
  deleteHouseholdCascade(db, houseId);
  return { status: 204, body: null };
}
```

- [ ] **Step 4: Wire route in index.ts**

In `backend/src/index.ts`, add `handleAdminDeleteHouse` to the admin import. Then after the existing `/admin/houses/:id/owner-invite` block (around line 295), add:

```ts
      {
        const params = parsePathParams("/admin/houses/:id", pathname);
        if (method === "DELETE" && params) {
          if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
          const result = handleAdminDeleteHouse(getDb(), params.id);
          if (result.body === null) return new Response(null, { status: 204 });
          return json(result.body, result.status);
        }
      }
```

- [ ] **Step 5: Run tests**

Run: `cd backend && bun test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/index.ts backend/tests/api-contract.test.ts
git commit -m "feat: add DELETE /admin/houses/:id endpoint"
```

---

### Task 6: Admin UI — delete button + confirmation modal

**Files:**
- Modify: `backend/src/html/admin-page.ts`

- [ ] **Step 1: Read the current admin-page.ts**

Read the full file to understand the existing HTML structure, CSS, and JavaScript patterns before modifying.

- [ ] **Step 2: Add delete button CSS**

Add to the existing `<style>` section:

```css
    button.danger {
      background: white; color: #a23a2a; border: 1.5px solid #a23a2a;
      padding: 0.45rem 0.9rem; border-radius: 8px; font-size: 0.85rem;
      cursor: pointer; font-weight: 500;
    }
    button.danger:hover { background: #a23a2a; color: white; }
    button.danger:disabled { opacity: 0.4; cursor: not-allowed; }
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal {
      background: white; border-radius: 14px; padding: 1.5rem 2rem;
      max-width: 420px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    }
    .modal h3 { margin-bottom: 0.75rem; }
    .modal p { font-size: 0.9rem; color: #6b6358; margin-bottom: 1rem; line-height: 1.5; }
    .modal input {
      width: 100%; padding: 0.6rem; border: 1.5px solid #e0dbd3; border-radius: 8px;
      font-size: 0.95rem; margin-bottom: 1rem;
    }
    .modal .actions { display: flex; justify-content: flex-end; gap: 0.75rem; }
    .modal .error { color: #a23a2a; font-size: 0.85rem; margin-bottom: 0.75rem; }
```

- [ ] **Step 3: Add delete button to house table rows**

In the JavaScript that renders house rows (the `loadHouses` function), add a delete button next to the existing "New owner link" button. Find the existing row-action button rendering and add:

```js
<button class="danger" onclick="openDeleteModal('${h.id}', '${h.name.replace(/'/g, "\\'")}')">Delete</button>
```

- [ ] **Step 4: Add the confirmation modal and delete logic**

Add to the JavaScript section:

```js
    let deleteModal = null;

    function openDeleteModal(houseId, houseName) {
      if (deleteModal) deleteModal.remove();
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = \`
        <div class="modal">
          <h3>Delete house "\${houseName}"?</h3>
          <p>This permanently removes the household, all of its guests, owners, connected documents, and chat history. Any connected iOS apps will be signed out of this house the next time they sync.</p>
          <p style="font-weight:500;">Type the house name to confirm:</p>
          <input id="deleteConfirmInput" placeholder="\${houseName}" oninput="checkDeleteConfirm(this, '\${houseName.replace(/'/g, "\\\\'")}')">
          <div class="error" id="deleteError" style="display:none"></div>
          <div class="actions">
            <button class="secondary" onclick="closeDeleteModal()">Cancel</button>
            <button class="danger" id="deleteConfirmBtn" disabled onclick="confirmDelete('\${houseId}')">Delete house</button>
          </div>
        </div>
      \`;
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDeleteModal(); });
      document.body.appendChild(overlay);
      deleteModal = overlay;
      document.getElementById('deleteConfirmInput').focus();
    }

    function closeDeleteModal() {
      if (deleteModal) { deleteModal.remove(); deleteModal = null; }
    }

    function checkDeleteConfirm(input, expected) {
      const btn = document.getElementById('deleteConfirmBtn');
      btn.disabled = input.value.trim().toLowerCase() !== expected.trim().toLowerCase();
    }

    async function confirmDelete(houseId) {
      const btn = document.getElementById('deleteConfirmBtn');
      const errEl = document.getElementById('deleteError');
      btn.disabled = true;
      btn.textContent = 'Deleting...';
      errEl.style.display = 'none';
      try {
        const res = await fetch('/admin/houses/' + houseId, { method: 'DELETE' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || 'Delete failed');
        }
        closeDeleteModal();
        loadHouses();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Delete house';
      }
    }
```

- [ ] **Step 5: Manually verify in browser**

Run: `cd backend && bun run dev`
Open the admin URL, verify the delete button appears on each house row, click it, verify the modal appears, type the name, verify the button enables, and confirm deletion works.

- [ ] **Step 6: Commit**

```bash
git add backend/src/html/admin-page.ts
git commit -m "feat: admin UI delete button with confirmation modal"
```

---

### Task 7: iOS — 410 detection + .houseDeleted notification

**Files:**
- Modify: `ios/Hearthstone/Services/APIClient.swift`
- Modify: `ios/Hearthstone/HearthstoneApp.swift`

- [ ] **Step 1: Add .houseDeleted notification to APIClient.swift**

In `ios/Hearthstone/Services/APIClient.swift`, add alongside the existing `.guestSessionRevoked`:

```swift
extension Notification.Name {
    static let houseDeleted = Notification.Name("houseDeleted")
}
```

- [ ] **Step 2: Add 410 detection in the request method**

In the `request()` method, after the existing 401 check, add 410 detection that **checks the body** (prevents false positives from other 410 usages like expired PINs):

```swift
if http.statusCode == 410 {
    if let serverErr = try? decoder.decode(ServerError.self, from: data),
       serverErr.message == "house_deleted" {
        NotificationCenter.default.post(name: .houseDeleted, object: nil)
    }
}
```

Also add the same 410 check to `uploadDocument()` (which bypasses `request()` and has its own HTTP handling). After the existing `guard (200...299).contains(...)` in uploadDocument, add a similar check for status 410.

- [ ] **Step 3: Add AppRouter subscriber for .houseDeleted**

In `ios/Hearthstone/HearthstoneApp.swift`, inside `AppRouter.init()`, add after the existing `.guestSessionRevoked` observer:

```swift
NotificationCenter.default.addObserver(forName: .houseDeleted, object: nil, queue: .main) { [weak self] _ in
    Task { @MainActor in
        guard let self else { return }
        if let active = self.store.activeSession {
            let name = active.householdName
            self.store.remove(id: active.id)
            self.showAccessRevoked = name
            self.syncState()
        }
    }
}
```

This reuses the existing `showAccessRevoked` property and `AccessRevokedView` — the user sees "`<name>` has been deleted" (or the existing revocation text, which is close enough for v1).

- [ ] **Step 4: Build to verify**

Run: `cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build`
Expected: BUILD SUCCEEDED

- [ ] **Step 5: Commit**

```bash
git add ios/Hearthstone/Services/APIClient.swift ios/Hearthstone/HearthstoneApp.swift
git commit -m "feat(ios): detect 410 Gone, remove dead house session from sidebar"
```

---

### Task 8: Update API spec + final verification

**Files:**
- Modify: `docs/api-spec.md`

- [ ] **Step 1: Add DELETE /admin/houses/:id to the API spec**

Add the endpoint definition to `docs/api-spec.md` in the admin section:

```markdown
### DELETE /admin/houses/:id

Delete a household and all associated data.

**Auth:** Admin cookie

**Response:** `204 No Content`

**Error responses:**
- `404 { "message": "House not found" }`
- `401 { "message": "Unauthorized" }`
```

- [ ] **Step 2: Document the 410 Gone response**

Add a general section or note about 410:

```markdown
### 410 Gone

Any authenticated endpoint may return `410 Gone` with body `{ "message": "house_deleted" }` if the household has been deleted since the client's last request. Clients should remove the session and stop retrying.
```

- [ ] **Step 3: Document the 409 last_owner response on DELETE /household/owners/:id**

Update the existing endpoint docs:

```markdown
**Error responses:**
- `409 { "message": "last_owner", "household_name": "<name>" }` — caller is the last owner; offer house deletion instead
- `404 { "message": "Owner not found" }`
```

- [ ] **Step 4: Fix stale "magic link" mention**

At line 543 of `docs/api-spec.md`, replace "magic link or QR code" with "PIN or QR code".

- [ ] **Step 5: Run full test suite**

Run: `cd backend && bun test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add docs/api-spec.md
git commit -m "docs: update API spec for house deletion (410, admin delete, last-owner 409)"
```
