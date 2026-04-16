# House Deletion Design

## Goal

Let an admin (and, later, an owner) fully delete a house on the server —
household row, all referencing rows, embeddings, and tokens — in a single
atomic operation. Clients that were connected to a now-gone house discover
that state cleanly and remove the dead session from their sidebar without
crashing, looping on errors, or surfacing confusing 401/404s.

Admin delete is v1. Owner-initiated delete is v2 and reuses all of the v1
machinery — the only additions are the endpoint and iOS UI surface.
Last-owner self-removal (via the existing `DELETE /household/owners/:id`
path) returns a 409 guard; the client then offers explicit house deletion
via `DELETE /household`. This doc covers all three paths.

## Why this isn't trivial

Three things combine to make the naive `DELETE FROM households` a landmine:

1. **No ON DELETE CASCADE in the schema.** `backend/src/db/schema.ts`
   declares foreign keys that reference `households(id)` and friends, but
   only `chunks.document_id` uses `ON DELETE CASCADE`. Every other FK is a
   plain `REFERENCES`, so with `PRAGMA foreign_keys = ON` (which we do set
   in `migrations.ts`) a raw `DELETE FROM households` would fail on the
   first referencing row. The cascade has to be manual.
2. **`chunk_embeddings` is a sqlite-vec virtual table.** vec0 virtual tables
   do not honor SQL foreign keys at all. They must be cleaned up by
   explicit DELETE queries driven from the app code. The existing
   `routes/documents.ts` delete-document path already does this for
   single-document deletes — we follow the same pattern, scaled to a whole
   household.
3. **Clients hold stale tokens and active SSE streams.** Deleting a house
   server-side doesn't automatically hang up open connections or invalidate
   cached JWTs. We need a client-side signal that distinguishes "house is
   gone" from "your token is bad" so the sidebar can remove the session
   without mistaking the state for an auth error.

## Data model: what references what

From `schema.ts` and `migrations.ts` (post-d74d619 cleanup):

| Table | References `households` | Notes |
|---|---|---|
| `household_members` | `household_id` | Also references `persons(id)`. |
| `guests` | `household_id` | |
| `session_tokens` | `household_id`, `guest_id` | Active guest session tokens. |
| `connections` | `household_id` | Google Drive refresh tokens per household. |
| `documents` | `household_id`, `connection_id` | |
| `chunks` | `household_id`, `document_id` (ON DELETE CASCADE) | Cleaned explicitly for clarity. |
| `chunk_embeddings` (vec0) | *none — virtual table* | Keyed on `chunks.id`. Must be deleted explicitly *before* `chunks`. |
| `suggestions` | `household_id` | `UNIQUE(household_id)` — at most one row. |
| `auth_pins` | `household_id`, `person_id`, `guest_id` | PINs live briefly but still reference the household. |
| `households` | — | The target row. |
| `persons` | — | Deliberately **not** deleted — see below. |

### Orphan persons

A person who is an owner of exactly one household gets "orphaned" when that
household is deleted: no `household_members` row, no active session, but
the `persons` row still exists. We **leave those rows in place**, for two
reasons:

- A person row stores shared identity (email, name) across any future
  household. If they redeem a new invite later, we want to recognize them
  by email, not create a duplicate.
- Deleting a person is a meaningful second scope of work with its own
  considerations.

Orphaned placeholder rows (email `__placeholder__-<id>@local`) are a
different case: they are strictly scoped to one household and serve no
purpose after deletion. We **do** delete those in the same transaction,
selected by joining through `household_members`. This matches the
`publicEmail()` filtering pattern already used elsewhere.

## Schema migration

Bundled with the deletion work since `deleteHouseholdCascade` must match
the actual schema.

### Drop `households.owner_id`

The `owner_id NOT NULL REFERENCES persons(id)` column on `households` is a
vestige from before multi-owner. Authority now lives exclusively in
`household_members`. The column is still populated on INSERT but never read
for authorization decisions.

Migration in `migrations.ts`:

```sql
ALTER TABLE households DROP COLUMN owner_id
```

SQLite supports `DROP COLUMN` since 3.35.0 (2021). Bun ships a
recent-enough SQLite. Update `household-create.ts` and `admin.ts` to omit
`owner_id` from their INSERT statements.

This migration goes alongside the existing migration that populated
`household_members` from `owner_id` — it is the natural completion of that
work.

## Deletion order

Inside a single `db.transaction(() => { ... })`:

```
1.  Collect chunk ids for the household (SELECT id FROM chunks WHERE household_id = ?)
2.  DELETE FROM chunk_embeddings WHERE chunk_id IN (<collected ids>)
3.  DELETE FROM chunks             WHERE household_id = ?
4.  DELETE FROM documents          WHERE household_id = ?
5.  DELETE FROM connections        WHERE household_id = ?
6.  DELETE FROM suggestions        WHERE household_id = ?
7.  DELETE FROM session_tokens     WHERE household_id = ?
8.  DELETE FROM auth_pins          WHERE household_id = ?
9.  DELETE FROM guests             WHERE household_id = ?
10. Capture placeholder person ids via:
      SELECT p.id FROM household_members hm
      JOIN persons p ON p.id = hm.person_id
      WHERE hm.household_id = ? AND p.email LIKE '__placeholder__-%'
11. DELETE FROM household_members WHERE household_id = ?
12. DELETE FROM households        WHERE id = ?
13. DELETE FROM persons           WHERE id IN (<captured placeholder ids>)
```

Notes on the order:

- Embeddings are cleaned before chunks because vec0 is unaware of SQL FKs;
  we want embeddings gone while we still have the chunk ids handy.
- `household_members` is deleted *after* we collect placeholder person ids,
  otherwise the join has nothing to join against.
- `households` comes before orphaned placeholder `persons` so nothing
  short-circuits the `UNIQUE(household_id, person_id)` check.
- The transaction is synchronous end-to-end (SQLite + bun:sqlite). If any
  step throws, the whole thing rolls back — the house either vanishes
  cleanly or is completely untouched.

A helper `deleteHouseholdCascade(db, householdId)` owns this sequence and
is the single call site for any delete path. Admin delete and owner delete
both go through it. The last-owner self-removal flow routes through owner
delete on the client side.

## Backend API

### v1 — admin delete

`DELETE /admin/houses/:id`

- Auth: `requireAdmin` middleware (same cookie/bearer scheme as every
  other admin route).
- Body: none.
- Response: `204 No Content` on success. `404 { message: "House not found" }`
  if no row. `500 { message }` on cascade failure (should be unreachable
  given the transactional wrap).

Handler shape follows the existing admin handlers:

```ts
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

Route wired in `src/index.ts` alongside the existing admin routes:

```ts
{
  const params = parsePathParams("/admin/houses/:id", pathname);
  if (method === "DELETE" && params) {
    if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
    const result = handleAdminDeleteHouse(getDb(), params.id);
    return json(result.body, result.status);
  }
}
```

Contract test: inserts a populated household (owner, guest, document,
chunk, embedding, pin, session token, suggestions row), calls the handler,
asserts (a) every referencing row is gone, (b) unrelated households are
untouched, (c) a second delete of the same id returns 404, and (d) a
non-placeholder person row survives.

### v1 — last-owner self-removal guard

`DELETE /household/owners/:id`

The existing endpoint removes an owner from a household. New behavior: when
the target is the **last remaining owner**, refuse the request instead of
leaving the house orphaned.

Detection:

```ts
const ownerCount = db.prepare(
  "SELECT COUNT(*) as count FROM household_members WHERE household_id = ? AND role = 'owner'"
).get(householdId) as { count: number };

if (ownerCount.count <= 1) {
  const house = db.prepare("SELECT name FROM households WHERE id = ?").get(householdId) as { name: string };
  return { status: 409, body: { message: "last_owner", household_name: house.name } };
}
```

- Status: **409 Conflict** — the request is valid but can't be fulfilled
  without destroying the house, which is not this endpoint's job.
- Body: `{ "message": "last_owner", "household_name": "<name>" }` — gives
  the client enough context to offer an alternative.
- The client handles this by offering explicit house deletion via
  `DELETE /household` (v2).

This endpoint's responsibility stays clean: it removes owners. If that
would orphan the house, it says so and lets the caller decide what to do.

Contract test: create a single-owner household, attempt self-removal,
assert 409 with `last_owner` message. Create a two-owner household, remove
one, assert 200 and remaining owner is untouched.

### v2 — owner delete

`DELETE /household`

- Auth: `authenticateOwner` (existing middleware). Uses the owner's JWT,
  operates on the household bound to that JWT — no path param.
- Body: none.
- Response: `204 No Content` on success.

Handler calls `deleteHouseholdCascade(db, owner.householdId)`.

Contract test: (a) an owner can delete their own house, (b) a guest JWT
cannot hit this endpoint, (c) after deletion, all referencing rows are
gone.

### Single delete helper

`src/services/household-deletion.ts`:

```ts
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

One helper, two callers (admin delete and owner delete), identical
cascade. The last-owner self-removal path routes through
`DELETE /household` on the client side, so it uses the same owner-delete
caller.

## Client-side: discovering a dead house

When `deleteHouseholdCascade` runs while a client holds an active session
for that house, the next authenticated request will hit
`assertHouseholdExists` and receive a 410.

### 410 Gone with `{ "message": "house_deleted" }`

Every owner-scoped and guest-scoped route gains a pre-check: after
authentication, verify the household row still exists. If not, return
`410 Gone` with body `{ "message": "house_deleted" }`.

410 (not 401, not 404) is the right status: "this resource was here and is
deliberately gone, stop retrying." 401 would cause the client's existing
`.guestSessionRevoked` notification to fire for the wrong reason. 404 is
ambiguous — it could mean "bad path."

Implementation: a tiny helper `assertHouseholdExists(db, householdId)` that
throws a typed error when the row is missing. The fetch handler's error
mapper converts that typed error into the 410 response. One line added
after each authentication call.

Chat SSE streams are request-response (each `POST /chat` opens a
connection, streams the response, and closes) — there is no persistent
idle connection to worry about. A deleted house surfaces on the next
user-initiated action.

### iOS handling

New `Notification.Name.houseDeleted` alongside the existing
`guestSessionRevoked`. `APIClient.request()` posts it when it sees a 410
with body `house_deleted`, carrying the active session id in
`userInfo["sessionId"]`.

`AppRouter.init` subscribes to it and:

1. Looks up the session in `SessionStore` by id.
2. Captures the household name for the dialog.
3. Calls `store.remove(id:)` — removes the session, drops the keychain
   token, re-picks an active session from whatever remains.
4. Surfaces a one-shot dialog: "`<Household name>` has been deleted."
   Reuses the existing `AccessRevokedView` pattern.
5. If the removed session was the active one and no sessions remain, the
   app transitions to the empty state / landing view.

Key constraint: the notification path must be idempotent. Multiple
in-flight requests on the same dead session will all return 410. The
handler shrugs if the session is already gone.

### Last-owner flow (v2, iOS)

When the owner taps "Remove myself" and the server returns 409
`last_owner`:

1. Client reads `household_name` from the response body.
2. Shows a confirmation dialog: *"You're the last owner of `<name>`.
   Removing yourself will permanently delete this house and all its data.
   Would you like to delete it?"*
3. On confirm: calls `DELETE /household` → 204 → removes the session from
   `SessionStore`, transitions to next house or landing view.
4. On cancel: no-op.

## Admin UI

Per-row action button next to the existing "New owner link":

```
[ New owner link ]  [ Delete ]
```

Clicking "Delete" opens a confirmation modal:

```
Delete house "<name>"?

This permanently removes the household, all of its guests, owners,
connected documents, and chat history. Any connected iOS apps will be
signed out of this house the next time they sync.

Type the house name to confirm: [____________]

[ Cancel ]                                 [ Delete house ]
```

- The "Delete house" button is disabled until the typed name matches the
  house name exactly (case-insensitive, whitespace trimmed).
- On success, the modal closes and the table row fades out via
  `loadHouses()`.
- On failure (network or 5xx), an inline error replaces the button row and
  the modal stays open.

Button styling mirrors the existing `.row-action` but uses a red accent
(`#a23a2a` on the border/text, white background, red border on hover).
Plain DOM — no framework, same as the rest of the admin page.

## iOS UI (v2, owner delete)

On the owner's dashboard, inside a settings/manage surface:

```
Danger zone
  Delete this house…
```

Tapping opens a confirmation requiring the house name — same pattern as
admin. Calls `DELETE /household`, same cascade, just with a JWT instead of
the admin cookie.

For v1 we do not ship the iOS owner-delete UI. We ship only the server
endpoints, the cascade helper, and the admin UI, plus the client-side 410
detection plumbing so that an admin-initiated delete produces a clean UX
for any iOS client already holding the dead session. That detection
plumbing is what v2 piggybacks on when owner-delete lands.

## Rollout

1. Schema migration: drop `households.owner_id`, update INSERT statements.
2. Add `deleteHouseholdCascade` helper + contract tests. Pure DB logic,
   independently verifiable.
3. Add `assertHouseholdExists` and thread it into owner-scoped and
   guest-scoped handlers. Contract tests asserting 410 after the household
   is deleted out from under the request.
4. Add last-owner guard to `DELETE /household/owners/:id` (409
   `last_owner`). Contract test.
5. Add `DELETE /admin/houses/:id` route and contract test.
6. Add admin UI (delete button, confirmation modal, error surface).
7. Add iOS: `.houseDeleted` notification, `APIClient` 410 detection,
   `AppRouter` subscriber, reuse `AccessRevokedView` for the dialog.
8. Deploy backend + ship iOS via `deploy.sh`.
9. v2 (separate PR): `DELETE /household` endpoint + last-owner 409 →
   "delete house?" client flow + iOS "delete this house" surface.

Each step is independently deployable. Steps 1–8 are v1. Step 9 is v2.
Step 1 is a no-op to users (schema change, no behavior change). Steps 2–6
are the shippable v1 backend. Step 7 is the iOS polish that makes v1 feel
complete — older iOS clients will see `APIError.http(410)` and show
"Something went wrong" until they update.

## Open questions

- Should the admin delete endpoint return the row counts it cleaned up
  (`{ guests: 3, documents: 14, chunks: 211 }`) for the admin UI to show?
  Nice-to-have, not required — deferred.
- Connections hold Google Drive refresh tokens. We delete the row, but
  should we also call the provider's revocation endpoint so the token is
  invalidated upstream? Recommendation: yes, but as a follow-up — do it
  best-effort outside the transaction so a Google outage doesn't block
  deletion. Captured separately in `BACKLOG.md`.
