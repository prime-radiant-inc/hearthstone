# Multi-Owner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let households have multiple owners with equal privileges. Add person names so the app can greet people properly.

**Architecture:** New `household_members` table replaces `households.owner_id`. Auth middleware queries membership instead of single FK. Owner invite reuses the existing PIN infrastructure. iOS gets an "Invite Owner" flow mirroring the guest invite.

**Tech Stack:** Bun/TypeScript, bun:sqlite, SwiftUI (iOS 17+)

**Spec:** `docs/superpowers/specs/2026-04-07-multi-owner-design.md`

---

## File Structure

### Backend
| File | Action | Responsibility |
|------|--------|---------------|
| `backend/src/db/schema.ts` | Modify | Add household_members table, name column on persons |
| `backend/src/db/migrations.ts` | Modify | Migrate owner_id data, drop column |
| `backend/src/middleware/owner-auth.ts` | Modify | Query household_members instead of owner_id |
| `backend/src/routes/household-create.ts` | Modify | Insert into household_members |
| `backend/src/routes/owners.ts` | Create | Invite, list, remove owner endpoints |
| `backend/src/routes/guests.ts` | Modify | Use household_members for personId lookup |
| `backend/src/routes/pin-auth.ts` | Modify | Insert into household_members on owner PIN redemption |
| `backend/src/index.ts` | Modify | Register new routes, update /me endpoint |
| `backend/tests/api-contract.test.ts` | Modify | Tests for new endpoints |

### iOS
| File | Action | Responsibility |
|------|--------|---------------|
| `ios/Hearthstone/Views/Owner/InviteOwnerView.swift` | Create | Name + email form for owner invite |
| `ios/Hearthstone/Views/Owner/DashboardView.swift` | Modify | Add invite owner action |
| `ios/Hearthstone/Services/APIClient.swift` | Modify | New endpoint methods |
| `ios/Hearthstone/Models/Person.swift` | Modify | Add name field |

---

### Task 1: Database Schema — household_members table and persons.name

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/migrations.ts`

- [ ] **Step 1: Add household_members to schema.ts**

In `backend/src/db/schema.ts`, add after the `households` CREATE TABLE block:

```sql
CREATE TABLE IF NOT EXISTS household_members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  person_id TEXT NOT NULL REFERENCES persons(id),
  role TEXT NOT NULL CHECK(role IN ('owner')),
  created_at TEXT NOT NULL,
  UNIQUE(household_id, person_id)
);
```

- [ ] **Step 2: Add migration to migrations.ts**

In `backend/src/db/migrations.ts`, add after the auth_pins migration block:

```typescript
// Add household_members table
db.run(`
  CREATE TABLE IF NOT EXISTS household_members (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    person_id TEXT NOT NULL REFERENCES persons(id),
    role TEXT NOT NULL CHECK(role IN ('owner')),
    created_at TEXT NOT NULL,
    UNIQUE(household_id, person_id)
  );
`);

// Migrate existing owner_id data into household_members
const households = db.prepare("SELECT id, owner_id, created_at FROM households").all() as any[];
for (const h of households) {
  const exists = db.prepare(
    "SELECT id FROM household_members WHERE household_id = ? AND person_id = ?"
  ).get(h.id, h.owner_id);
  if (!exists) {
    const { generateId } = require("../utils");
    db.prepare(
      "INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)"
    ).run(generateId(), h.id, h.owner_id, h.created_at);
  }
}

// Add name column to persons if not present
const personCols = db.prepare("PRAGMA table_info(persons)").all() as any[];
if (!personCols.some((c: any) => c.name === "name")) {
  db.run("ALTER TABLE persons ADD COLUMN name TEXT NOT NULL DEFAULT ''");
}
```

Note: We keep `owner_id` on the households table for now — removing it is a separate step after all queries are migrated. SQLite column drops require table recreation which is risky in a migration.

- [ ] **Step 3: Run tests**

```bash
cd backend && bun test
```
Expected: All 105 tests pass (schema changes are additive)

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.ts backend/src/db/migrations.ts
git commit -m "feat(backend): add household_members table and persons.name column"
```

---

### Task 2: Update authenticateOwner Middleware

**Files:**
- Modify: `backend/src/middleware/owner-auth.ts`

- [ ] **Step 1: Replace owner_id lookup with household_members query**

Replace the entire `authenticateOwner` function body in `backend/src/middleware/owner-auth.ts`:

```typescript
export async function authenticateOwner(
  db: Database,
  authHeader: string | undefined | null,
  jwtSecret: string
): Promise<OwnerContext> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("unauthorized");
  }

  const token = authHeader.slice(7);

  try {
    const encoder = new TextEncoder();
    const { payload } = await jwtVerify(token, encoder.encode(jwtSecret));
    const personId = payload.personId as string;
    const householdId = payload.householdId as string;

    if (!personId) throw new Error("unauthorized");

    const person = db.prepare("SELECT id FROM persons WHERE id = ?").get(personId);
    if (!person) throw new Error("unauthorized");

    // Check membership in the specific household from the JWT
    if (householdId) {
      const member = db.prepare(
        "SELECT id FROM household_members WHERE person_id = ? AND household_id = ? AND role = 'owner'"
      ).get(personId, householdId);
      if (member) return { personId, householdId };
    }

    // Fallback: find any household this person owns (for legacy JWTs without householdId)
    const member = db.prepare(
      "SELECT household_id FROM household_members WHERE person_id = ? AND role = 'owner' LIMIT 1"
    ).get(personId) as any;

    return { personId, householdId: member?.household_id ?? "" };
  } catch {
    throw new Error("unauthorized");
  }
}
```

- [ ] **Step 2: Run tests**

```bash
cd backend && bun test
```
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/owner-auth.ts
git commit -m "refactor(backend): authenticateOwner queries household_members"
```

---

### Task 3: Update Household Creation

**Files:**
- Modify: `backend/src/routes/household-create.ts`

- [ ] **Step 1: Insert into household_members on creation**

Replace `backend/src/routes/household-create.ts`:

```typescript
// src/routes/household-create.ts
import type { Database } from "bun:sqlite";
import { generateId } from "../utils";

export function handleCreateHousehold(
  db: Database,
  personId: string,
  body: { name: string }
): { status: number; body: any } {
  if (!body.name || !body.name.trim()) {
    return { status: 422, body: { message: "Household name is required" } };
  }

  const id = generateId();
  const now = new Date().toISOString();

  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    id, personId, body.name.trim(), now
  );

  db.prepare(
    "INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)"
  ).run(generateId(), id, personId, now);

  return {
    status: 200,
    body: { id, name: body.name.trim(), created_at: now },
  };
}
```

- [ ] **Step 2: Run tests**

```bash
cd backend && bun test
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/household-create.ts
git commit -m "feat(backend): insert household_members on household creation"
```

---

### Task 4: Update Guest Routes — Remove owner_id Dependency

**Files:**
- Modify: `backend/src/routes/guests.ts`

The `handleCreateGuest` and `handleReinviteGuest` functions query `SELECT owner_id FROM households` to get a `personId` for the PIN. With multi-owner, the requesting owner's `personId` comes from the auth context. Thread it through.

- [ ] **Step 1: Update handleCreateGuest**

In `backend/src/routes/guests.ts`, change `handleCreateGuest` to accept `personId` as a parameter:

```typescript
export async function handleCreateGuest(
  db: Database,
  householdId: string,
  personId: string,
  body: { name: string | null; email: string | null }
): Promise<{ status: number; body: any }> {
  if (!body.name || !body.name.trim()) {
    return { status: 422, body: { message: "Name is required" } };
  }

  const guestId = generateId();
  const contact = body.email?.trim() || "";
  const contactType = "email";
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
  ).run(guestId, householdId, body.name.trim(), contact, contactType, now);

  const { pin, expiresAt } = createAuthPin(db, {
    role: "guest",
    personId,
    householdId,
    guestId,
  });

  return {
    status: 200,
    body: {
      guest: { id: guestId, name: body.name.trim(), status: "pending" },
      pin,
      expires_at: expiresAt,
    },
  };
}
```

- [ ] **Step 2: Update handleReinviteGuest similarly**

```typescript
export function handleReinviteGuest(
  db: Database,
  householdId: string,
  personId: string,
  guestId: string
): { status: number; body: any } {
  const guest = db
    .prepare("SELECT * FROM guests WHERE id = ? AND household_id = ?")
    .get(guestId, householdId) as any;

  if (!guest) {
    return { status: 404, body: { message: "Guest not found" } };
  }

  if (guest.status === "revoked") {
    db.prepare("UPDATE guests SET status = 'pending' WHERE id = ?").run(guestId);
  }

  const { pin, expiresAt } = createAuthPin(db, {
    role: "guest",
    personId,
    householdId,
    guestId,
  });

  return {
    status: 200,
    body: { pin, expires_at: expiresAt },
  };
}
```

- [ ] **Step 3: Update call sites in index.ts**

In `backend/src/index.ts`, find the two routes that call these functions and pass `owner.personId`:

For `handleCreateGuest`:
```typescript
const result = await handleCreateGuest(getDb(), owner.householdId, owner.personId, body);
```

For `handleReinviteGuest`:
```typescript
const result = handleReinviteGuest(getDb(), owner.householdId, owner.personId, reinviteParams.id);
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/guests.ts backend/src/index.ts
git commit -m "refactor(backend): remove owner_id dependency from guest routes"
```

---

### Task 5: Owner Management Endpoints

**Files:**
- Create: `backend/src/routes/owners.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create owners.ts**

```typescript
// src/routes/owners.ts
import type { Database } from "bun:sqlite";
import { createAuthPin } from "../services/pins";
import { generateId } from "../utils";

export function handleListOwners(
  db: Database,
  householdId: string
): { status: number; body: any } {
  const owners = db.prepare(`
    SELECT p.id, p.name, p.email, hm.created_at
    FROM household_members hm
    JOIN persons p ON p.id = hm.person_id
    WHERE hm.household_id = ? AND hm.role = 'owner'
    ORDER BY hm.created_at
  `).all(householdId);

  return { status: 200, body: { owners } };
}

export function handleInviteOwner(
  db: Database,
  householdId: string,
  inviterPersonId: string,
  body: { name: string; email: string }
): { status: number; body: any } {
  if (!body.email || !body.email.trim()) {
    return { status: 422, body: { message: "Email is required" } };
  }

  const email = body.email.trim().toLowerCase();
  const name = body.name?.trim() || "";

  // Check if already an owner
  const existing = db.prepare(`
    SELECT hm.id FROM household_members hm
    JOIN persons p ON p.id = hm.person_id
    WHERE hm.household_id = ? AND p.email = ? AND hm.role = 'owner'
  `).get(householdId, email);

  if (existing) {
    return { status: 409, body: { message: "This person is already an owner" } };
  }

  // Find or create person
  let person = db.prepare("SELECT id, name FROM persons WHERE email = ?").get(email) as any;
  if (!person) {
    const personId = generateId();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO persons (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
      personId, email, name, now
    );
    person = { id: personId, name };
  } else if (name && !person.name) {
    db.prepare("UPDATE persons SET name = ? WHERE id = ?").run(name, person.id);
  }

  const { pin, expiresAt } = createAuthPin(db, {
    role: "owner",
    personId: person.id,
    householdId,
  });

  return {
    status: 200,
    body: { pin, expires_at: expiresAt },
  };
}

export function handleRemoveOwner(
  db: Database,
  householdId: string,
  targetPersonId: string
): { status: number; body: any } {
  const member = db.prepare(
    "SELECT id FROM household_members WHERE household_id = ? AND person_id = ? AND role = 'owner'"
  ).get(householdId, targetPersonId);

  if (!member) {
    return { status: 404, body: { message: "Owner not found" } };
  }

  // Cannot remove the last owner
  const count = db.prepare(
    "SELECT COUNT(*) as count FROM household_members WHERE household_id = ? AND role = 'owner'"
  ).get(householdId) as any;

  if (count.count <= 1) {
    return { status: 422, body: { message: "Cannot remove the last owner" } };
  }

  db.prepare(
    "DELETE FROM household_members WHERE household_id = ? AND person_id = ? AND role = 'owner'"
  ).run(householdId, targetPersonId);

  return { status: 204, body: null };
}
```

- [ ] **Step 2: Register routes in index.ts**

In `backend/src/index.ts`, add the import:

```typescript
import { handleListOwners, handleInviteOwner, handleRemoveOwner } from "./routes/owners";
```

Add these route handlers inside `handleRequest`, after the guest routes and before the connection routes:

```typescript
// --- Owner management routes ---
if (method === "GET" && pathname === "/household/owners") {
  const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
  const result = handleListOwners(getDb(), owner.householdId);
  return json(result.body, result.status);
}

if (method === "POST" && pathname === "/household/owners") {
  const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
  const body = await req.json();
  const result = handleInviteOwner(getDb(), owner.householdId, owner.personId, body);
  return json(result.body, result.status);
}

const removeOwnerParams = parsePathParams("/household/owners/:id", pathname);
if (method === "DELETE" && removeOwnerParams) {
  const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
  const result = handleRemoveOwner(getDb(), owner.householdId, removeOwnerParams.id);
  return json(result.body, result.status);
}
```

- [ ] **Step 3: Run tests**

```bash
cd backend && bun test
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/owners.ts backend/src/index.ts
git commit -m "feat(backend): add owner invite, list, and remove endpoints"
```

---

### Task 6: Update PIN Redemption — Add to household_members

**Files:**
- Modify: `backend/src/routes/pin-auth.ts`

- [ ] **Step 1: Insert into household_members when owner redeems PIN**

In `backend/src/routes/pin-auth.ts`, add after line 30 (`const token = await issueOwnerJwt(...)`) inside the `if (result.role === "owner")` block:

```typescript
// Ensure the person is a member of the household
db.prepare(`
  INSERT OR IGNORE INTO household_members (id, household_id, person_id, role, created_at)
  VALUES (?, ?, ?, 'owner', ?)
`).run(generateId(), result.householdId, result.personId, new Date().toISOString());
```

You'll need to add `generateId` to the imports at the top (it's already imported).

- [ ] **Step 2: Include person name in response**

Update the owner response to include name:

```typescript
const person = db.prepare("SELECT id, email, name FROM persons WHERE id = ?").get(result.personId) as any;
```

And in the response body:
```typescript
person: { id: person.id, email: person.email, name: person.name || "" },
```

- [ ] **Step 3: Run tests**

```bash
cd backend && bun test
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/pin-auth.ts
git commit -m "feat(backend): add household_members on owner PIN redemption, include name"
```

---

### Task 7: Update /me Endpoint

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Update /me to return person name and use household_members**

Find the `GET /me` route handler in `backend/src/index.ts` and replace it:

```typescript
if (method === "GET" && pathname === "/me") {
  const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
  const person = getDb().prepare("SELECT id, email, name FROM persons WHERE id = ?").get(owner.personId) as any;
  const household = getDb().prepare(
    "SELECT h.id, h.name, h.created_at FROM households h JOIN household_members hm ON hm.household_id = h.id WHERE hm.person_id = ? AND hm.role = 'owner' LIMIT 1"
  ).get(owner.personId) as any || null;
  return json({ person: { id: person.id, email: person.email, name: person.name || "" }, household });
}
```

- [ ] **Step 2: Run tests**

```bash
cd backend && bun test
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "refactor(backend): /me uses household_members, returns person name"
```

---

### Task 8: iOS — Person Name and Owner Invite API

**Files:**
- Modify: `ios/Hearthstone/Models/Person.swift`
- Modify: `ios/Hearthstone/Services/APIClient.swift`
- Modify: `ios/Hearthstone/Views/Auth/PINEntryView.swift`

- [ ] **Step 1: Add name to Person model**

Replace `ios/Hearthstone/Models/Person.swift`:

```swift
import Foundation

struct Person: Codable, Identifiable {
    let id: String
    let email: String
    let name: String?
}
```

- [ ] **Step 2: Update PINEntryView to prefer name over email**

In `ios/Hearthstone/Views/Auth/PINEntryView.swift`, in the `redeemPin()` method, change:

```swift
personName: response.person?.email,
```

To:

```swift
personName: response.person?.name?.isEmpty == false ? response.person?.name : response.person?.email,
```

- [ ] **Step 3: Add owner invite endpoints to APIClient**

In `ios/Hearthstone/Services/APIClient.swift`, add before the `// MARK: - Chat endpoints` section:

```swift
// MARK: - Owner endpoints

struct InviteOwnerResponse: Decodable {
    let pin: String
    let expiresAt: String
    enum CodingKeys: String, CodingKey {
        case pin
        case expiresAt = "expires_at"
    }
}

func inviteOwner(name: String, email: String) async throws -> InviteOwnerResponse {
    struct Body: Encodable { let name: String; let email: String }
    return try await call(method: "POST", path: "/household/owners", auth: .owner,
                          body: Body(name: name, email: email))
}
```

- [ ] **Step 4: Verify build**

```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add ios/Hearthstone/Models/Person.swift ios/Hearthstone/Services/APIClient.swift ios/Hearthstone/Views/Auth/PINEntryView.swift
git commit -m "feat(ios): person name field, owner invite API method"
```

---

### Task 9: iOS — Invite Owner View

**Files:**
- Create: `ios/Hearthstone/Views/Owner/InviteOwnerView.swift`
- Modify: `ios/Hearthstone/Views/Owner/DashboardView.swift`

- [ ] **Step 1: Create InviteOwnerView**

Create `ios/Hearthstone/Views/Owner/InviteOwnerView.swift` mirroring the AddGuestView pattern:

```swift
import SwiftUI

struct InviteOwnerView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var email = ""
    @State private var isLoading = false
    @State private var error: String?
    @State private var resultPin: String?
    @State private var resultExpiry: String?

    var body: some View {
        ZStack {
            Theme.cream.ignoresSafeArea()

            if let pin = resultPin, let expiry = resultExpiry {
                GuestPINView(
                    guestName: name,
                    pin: pin,
                    expiresAt: expiry
                ) {
                    dismiss()
                }
            } else {
                formView
            }
        }
    }

    private var formView: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Invite Owner")
                    .font(Theme.heading(22))
                    .foregroundColor(Theme.charcoal)

                Spacer()

                Button("Cancel") { dismiss() }
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Theme.hearth)
            }
            .padding(.horizontal, 24)
            .padding(.top, 28)
            .padding(.bottom, 24)

            Divider()
                .background(Theme.creamDeep)

            ScrollView {
                VStack(spacing: 20) {
                    HearthTextField(
                        label: "Name",
                        placeholder: "e.g. Jamie",
                        text: $name
                    )

                    HearthTextField(
                        label: "Email",
                        placeholder: "jamie@example.com",
                        text: $email,
                        keyboardType: .emailAddress,
                        autocapitalization: .never
                    )

                    if let error {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(Theme.rose)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    HearthButton(title: "Create Invite", isLoading: isLoading) {
                        Task { await inviteOwner() }
                    }
                    .padding(.top, 4)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
            }
        }
    }

    private func inviteOwner() async {
        error = nil
        guard !email.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "Email is required."
            return
        }
        isLoading = true
        do {
            let response = try await APIClient.shared.inviteOwner(
                name: name.trimmingCharacters(in: .whitespaces),
                email: email.trimmingCharacters(in: .whitespaces)
            )
            resultPin = response.pin
            resultExpiry = response.expiresAt
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
```

- [ ] **Step 2: Add "Invite Owner" to DashboardView**

In `ios/Hearthstone/Views/Owner/DashboardView.swift`, add a state variable:

```swift
@State private var showInviteOwner = false
```

Add the "Invite Owner" action to the ManageSection. Read `DashboardView.swift` to find where ManageSection is constructed and where sheets are presented. Add:

```swift
.sheet(isPresented: $showInviteOwner) {
    InviteOwnerView()
}
```

Add an "Invite Owner" row to the ManageSection, or add it as an additional action in the existing guest/docs section. Read the ManageSection struct to understand its structure, then add the appropriate hook.

- [ ] **Step 3: Add InviteOwnerView to Xcode project**

Add the new file to the pbxproj — file reference in the Owner group, build file entry in Sources.

- [ ] **Step 4: Verify build**

```bash
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add ios/Hearthstone/Views/Owner/InviteOwnerView.swift ios/Hearthstone/Views/Owner/DashboardView.swift ios/Hearthstone.xcodeproj/project.pbxproj
git commit -m "feat(ios): add Invite Owner view and dashboard action"
```

---

### Task 10: Backend Tests and Verification

**Files:**
- Modify: `backend/tests/api-contract.test.ts`

- [ ] **Step 1: Run existing tests**

```bash
cd backend && bun test
```

Fix any failures from the schema/route changes.

- [ ] **Step 2: Verify new endpoints manually**

```bash
# List owners (use a valid owner JWT)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/household/owners

# Invite owner
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com"}' http://localhost:3000/household/owners
```

- [ ] **Step 3: Commit any test fixes**

```bash
git add backend/tests/
git commit -m "test(backend): update contract tests for multi-owner endpoints"
```
