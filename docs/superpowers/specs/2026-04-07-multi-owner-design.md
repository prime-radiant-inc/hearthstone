# Multi-Owner Design (Chunk 2)

## Goal

Let a household have multiple owners with equal privileges. Add a `name` field to persons so the app can greet people properly.

## Problem

`households.owner_id` is a single foreign key — one owner per household. The owner auth middleware (`authenticateOwner`) looks up the household by `owner_id = personId`, so a second owner has no way to authenticate against that household. The `persons` table also lacks a `name` field, so the app shows email addresses where names should be.

## Design

### Database Changes

**New table: `household_members`**

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

Role is always `'owner'` for now. Guests have their own table with richer status tracking. This table exists to decouple ownership from a single FK.

**Add `name` to `persons`**

```sql
ALTER TABLE persons ADD COLUMN name TEXT NOT NULL DEFAULT '';
```

**Drop `owner_id` from `households`**

The column becomes redundant once `household_members` exists. Migration:

1. For each household, insert a row into `household_members` with the existing `owner_id` as `person_id` and role `'owner'`.
2. Drop the `owner_id` column. (SQLite doesn't support `DROP COLUMN` before 3.35.0 — since Bun ships SQLite 3.40+, this works.)

### Auth Middleware Changes

`authenticateOwner` currently does:
```
SELECT id FROM households WHERE owner_id = ?
```

Replace with:
```
SELECT household_id FROM household_members WHERE person_id = ? AND role = 'owner'
```

This returns all households the person owns. For the JWT flow, the `householdId` claim in the token tells us which household — validate that the person is a member of it:

```
SELECT id FROM household_members WHERE person_id = ? AND household_id = ? AND role = 'owner'
```

The JWT already contains both `personId` and `householdId`, so this is a straightforward swap.

### `/me` Endpoint

Currently returns one household (looked up by `owner_id`). Change to query `household_members`:

```sql
SELECT h.id, h.name, h.created_at
FROM households h
JOIN household_members hm ON hm.household_id = h.id
WHERE hm.person_id = ? AND hm.role = 'owner'
```

This can return multiple households. The response shape changes from `household: Household?` to `households: Household[]`. The iOS client already handles the multi-house model via SessionStore — it doesn't use `/me` for navigation anymore. The migration code uses it to resolve household names, but that's best-effort.

### Owner Invite Flow

**Backend: `POST /household/owners`**

Authenticated (owner). Creates a new person record (or finds existing by email) and generates a PIN with `role: 'owner'`.

Request:
```json
{ "name": "Jamie", "email": "jamie@example.com" }
```

Steps:
1. Find or create person by email (set `name` if creating, update if provided and currently empty)
2. Create a `household_members` row with role `'owner'` and status inactive (or just create the PIN — membership is granted on redemption)
3. Generate an auth PIN with `role: 'owner'`, `person_id`, `household_id`
4. Return the PIN and expiry

Response:
```json
{ "pin": "482901", "expires_at": "2026-04-14T00:00:00Z" }
```

**PIN redemption** already handles `role: 'owner'` — it issues a JWT. The only missing piece: on redemption, ensure the person is in `household_members`. Add an insert-if-not-exists in the owner branch of `handlePinRedeem`:

```sql
INSERT OR IGNORE INTO household_members (id, household_id, person_id, role, created_at)
VALUES (?, ?, ?, 'owner', ?)
```

### Owner Management

**`GET /household/owners`** — list all owners of the current household.

Response:
```json
{
  "owners": [
    { "id": "person-id", "name": "Matt", "email": "matt@example.com", "created_at": "..." }
  ]
}
```

**`DELETE /household/owners/:id`** — remove an owner. Deletes the `household_members` row. All owners are equal — any owner can remove any other owner, including themselves. If an owner removes themselves, they lose access.

Guard: cannot remove the last owner. If `COUNT(*) = 1` for that household, return 422.

**Edge case: inviting someone who's already an owner.** If the email matches an existing `household_members` row for that household, return 409 Conflict with message "This person is already an owner."

### Household Creation

`POST /household` currently sets `owner_id`. Change it to:
1. Create the household (without `owner_id` once the column is dropped)
2. Insert a `household_members` row for the creator

### Persons Name Field

- `POST /auth/register` and `POST /auth/register/verify` — accept optional `name` field
- `POST /household/owners` — sets `name` when creating new person
- `GET /me` — return `name` in person object
- PIN redemption response — include `name` in person object
- The `name` field is optional with a default of empty string. Display logic falls back to email when name is empty.

### iOS Changes

**Dashboard: "Invite Owner" button**

Add an "Invite Owner" action alongside "Add Guest" in the dashboard. Reuse the same UX pattern — name + email form, shows a PIN on success.

**New view: `InviteOwnerView`** — mirrors `AddGuestView` but calls `POST /household/owners`.

**New view: `OwnerPINView`** — mirrors `GuestPINView`, shows the PIN and QR code.

**Person name in HouseSession** — the `personName` field we just added should prefer the `name` field when available, falling back to email.

### API Contract Updates

Per CLAUDE.md rules, update `.brainstorm/spec.md` first, then backend, then contract tests, then iOS.

New endpoints:
- `POST /household/owners` — create owner invite
- `GET /household/owners` — list owners
- `DELETE /household/owners/:id` — remove owner

Modified endpoints:
- `GET /me` — `household` becomes `households` (array), person gains `name` field
- `POST /auth/pin/redeem` — person gains `name` field in response

## Scope

**In scope:**
- `household_members` table + migration
- Drop `owner_id` from households
- Auth middleware update
- Owner invite/list/remove endpoints
- `name` field on persons
- iOS invite owner UI
- Contract test updates

**Out of scope:**
- QR code scanning (Chunk 3)
- Owner permissions/roles beyond equal access
- Notifications when invited

## File Impact

### Backend
| File | Action |
|------|--------|
| `src/db/schema.ts` | Modify — add household_members table, name column |
| `src/db/migrations.ts` | Modify — migration for existing data |
| `src/middleware/owner-auth.ts` | Modify — query household_members |
| `src/routes/household.ts` | Modify — owner management endpoints |
| `src/routes/household-create.ts` | Modify — insert into household_members |
| `src/routes/pin-auth.ts` | Modify — insert into household_members on owner redemption |
| `src/index.ts` | Modify — register new routes |
| `tests/api-contract.test.ts` | Modify — new endpoint tests |
| `.brainstorm/spec.md` | Modify — new endpoint specs |

### iOS
| File | Action |
|------|--------|
| `Views/Owner/InviteOwnerView.swift` | Create |
| `Views/Owner/OwnerPINView.swift` | Create (or reuse GuestPINView) |
| `Views/Owner/DashboardView.swift` | Modify — add invite owner action |
| `Services/APIClient.swift` | Modify — new endpoints |
| `Models/Person.swift` | Modify — add name field |
