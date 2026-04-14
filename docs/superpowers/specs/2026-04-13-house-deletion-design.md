# House Deletion Design

## Goal

Let an admin (and, later, an owner) fully delete a house on the server —
household row, all referencing rows, embeddings, and tokens — in a single
atomic operation. Clients that were connected to a now-gone house discover
that state cleanly and remove the dead session from their sidebar without
crashing, looping on errors, or surfacing confusing 401/404s.

Admin delete is v1. Owner-initiated delete is v2 and reuses almost all of
the v1 machinery — the only additions are authz and a "last owner" safety
check. This doc covers both.

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

From `schema.ts` and `migrations.ts`:

| Table | References `households` | Indirect references | Notes |
|---|---|---|---|
| `household_members` | `household_id` | via `person_id` → `persons` | Person rows are shared across servers-of-one; see "orphan persons" below. |
| `guests` | `household_id` | — | Cascaded from `household_id`. |
| `invite_tokens` | `household_id`, `guest_id` | — | Obsolete on this branch (superseded by `auth_pins`) but still in schema. Must be deleted. |
| `session_tokens` | `household_id`, `guest_id` | — | Active guest session tokens. |
| `connections` | `household_id` | — | Google Drive refresh tokens per household. |
| `documents` | `household_id`, `connection_id` | — | |
| `chunks` | `household_id`, `document_id` (ON DELETE CASCADE) | — | Will be cleaned up by deleting `documents`, but we delete explicitly for clarity. |
| `chunk_embeddings` (vec0) | *none — virtual table* | keyed on `chunks.id` | Must be deleted explicitly *before* `chunks`. |
| `suggestions` | `household_id` | — | `UNIQUE(household_id)` — at most one row. |
| `auth_pins` | `household_id`, `person_id`, `guest_id` | — | PINs live briefly but still reference the household. |
| `households` | — | — | The target row. |
| `persons` | — | referenced by `household_members`, `passkey_credentials`, `auth_pins`, `household_members.owner_id`, etc. | Deliberately **not** deleted — see below. |

### Orphan persons

A person who is an owner of exactly one household gets "orphaned" when that
household is deleted: no `household_members` row, no active session, but
the `persons` row still exists (and with it their `passkey_credentials` if
any). We **leave those rows in place** in v1, for two reasons:

- A person row stores shared identity (email, name) across any future
  household. If they redeem a new invite later, we want to recognize them
  by email, not create a duplicate.
- Deleting a person cascades into passkeys, legacy email verifications,
  etc. — a meaningful second scope of work.

Orphaned placeholder rows (email `__placeholder__-<id>@local`) are a
different case: they are strictly scoped to one household and serve no
purpose after deletion. We **do** delete those in the same transaction,
selected by joining through `household_members`. This matches the
`publicEmail()` filtering pattern already used elsewhere.

## Deletion order

Inside a single `db.transaction(() => { ... })`:

```
1. Collect chunk ids for the household (SELECT id FROM chunks WHERE household_id = ?)
2. DELETE FROM chunk_embeddings WHERE chunk_id IN (<collected ids>)
3. DELETE FROM chunks             WHERE household_id = ?
4. DELETE FROM documents          WHERE household_id = ?
5. DELETE FROM connections        WHERE household_id = ?
6. DELETE FROM suggestions        WHERE household_id = ?
7. DELETE FROM session_tokens     WHERE household_id = ?
8. DELETE FROM invite_tokens      WHERE household_id = ?
9. DELETE FROM auth_pins          WHERE household_id = ?
10. DELETE FROM guests            WHERE household_id = ?
11. Capture placeholder person ids via:
      SELECT p.id FROM household_members hm
      JOIN persons p ON p.id = hm.person_id
      WHERE hm.household_id = ? AND p.email LIKE '__placeholder__-%'
12. DELETE FROM household_members WHERE household_id = ?
13. DELETE FROM households        WHERE id = ?
14. DELETE FROM persons           WHERE id IN (<captured placeholder ids>)
```

Notes on the order:

- Embeddings are cleaned before chunks because vec0 is unaware of SQL FKs;
  we want embeddings gone while we still have the chunk ids handy. (Chunks
  would cascade-delete from documents, but doing it explicitly is clearer
  and matches the existing document-delete path.)
- `household_members` is deleted *after* we collect placeholder person ids,
  otherwise the join has nothing to join against.
- `households` comes before orphaned placeholder `persons` so nothing
  short-circuits the `UNIQUE(household_id, person_id)` check.
- The transaction is synchronous end-to-end (SQLite + bun:sqlite). If any
  step throws, the whole thing rolls back — the house either vanishes
  cleanly or is completely untouched.

A helper `deleteHouseholdCascade(db, householdId)` owns this sequence and
is the single call site for any delete path. Admin delete and owner delete
both go through it.

## Backend API

### v1 — admin

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

### v2 — owner

`DELETE /household`

- Auth: `authenticateOwner` (existing middleware). Uses the owner's JWT,
  operates on the household bound to that JWT — no path param. This
  mirrors `GET /me` / `PATCH /me` style.
- Body: none. (Could accept `{ "confirm": "<household name>" }` as a
  doubly-sure check, but the confirmation lives on the client.)
- Rules:
  - The caller must be a current owner of the target household. (Already
    enforced by `authenticateOwner`.)
  - No "last owner" restriction — the point of this endpoint is to tear
    the whole house down, not to leave. If the caller wants to leave
    without destroying the house, that's the existing
    `DELETE /household/owners/:id` path on themselves.
- Response: same as the admin variant (`204` on success).

Handler calls the same `deleteHouseholdCascade(db, owner.householdId)`.
Contract test covers (a) an owner can delete their own house, (b) a
different owner's JWT cannot delete this household (401/403), (c) a guest
JWT cannot hit this endpoint at all.

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
    db.prepare("DELETE FROM invite_tokens    WHERE household_id = ?").run(houseId);
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

One helper, two callers, identical cascade.

## Client-side: discovering a dead house

When `deleteHouseholdCascade` runs while a client is holding an active
session for that house, the next authenticated request from that client
will hit an endpoint whose handler tries to look up a row that no longer
exists. The specific 4xx varies by endpoint:

- `GET /me` — returns `{ household: null }` today without erroring. After
  deletion, the JWT still validates (secret hasn't changed), the person
  row still exists, but `household_members` has no matching row, so the
  household query returns `null`. This is the cleanest detection signal.
- `POST /chat` or `GET /guests` — currently assume the household exists;
  they'd throw or return a 500 because a SELECT comes back empty.
- `GET /household` — returns 404.

We need a single, unambiguous signal. Rather than chasing every endpoint,
introduce one new behavior:

### New status: `410 Gone` with `{ message: "house_deleted" }`

Every owner-scoped route gains a cheap pre-check: after
`authenticateOwner` returns, verify the household row still exists. If
not, return `410 Gone` with body `{ "message": "house_deleted" }`. Guest
routes do the same after resolving their session token.

410 (not 401, not 404) is the right status: "this resource was here and is
deliberately gone, stop retrying." 401 would cause the client's existing
`.guestSessionRevoked` notification to fire for the wrong reason. 404 is
ambiguous — it could mean "bad path."

Implementation: a tiny helper `assertHouseholdExists(db, householdId)` that
throws a typed error when the row is missing. The fetch handler's shared
error mapper converts that typed error into the 410 response. This is one
line added after `authenticateOwner(...)` in each owner-scoped handler —
mechanical but worth reviewing.

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
4. Surfaces a one-shot dialog: "`<Household name>` was removed by the
   server." — similar to the existing `AccessRevokedView` pattern, reused.
5. If the removed session was the active one and no sessions remain, the
   app transitions back to the empty state / landing view. This is
   already what `syncState` does when `activeSession` is nil.

Key constraint: the notification path must be idempotent. Multiple
in-flight requests on the same dead session will all return 410, and we'll
get N notifications. The handler shrugs if the session is already gone.

### SSE streams

The chat SSE path needs the same check. When a stream is open and the
household gets deleted, the next write will fail on the server side
because the household row is gone. The server should close the stream
with a final event: `event: house_deleted\ndata: {}\n\n` and hang up.
iOS's `SSEClient` recognizes this event and triggers the same 410-style
handling (post `houseDeleted` notification, let the router clean up).

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
  house name exactly (case-insensitive, whitespace trimmed). This is the
  only friction — we rely on it hard because admin delete is irreversible.
- On success, the modal closes and the table row fades out via
  `loadHouses()`.
- On failure (network or 5xx), an inline error replaces the button row and
  the modal stays open.

Button styling mirrors the existing `.row-action` but flips to a red
accent (`#a23a2a` on the border/text, white background, red border on
hover). Keep the confirmation in plain DOM — no framework, same as the
rest of the admin page.

## iOS UI (v2, owner delete)

On the owner's dashboard, inside the existing house-settings sheet (or
wherever `DELETE /household/owners/:id` already lives — we reuse that
surface):

```
Danger zone
  Delete this house…
```

Tapping opens a full-screen confirmation that requires typing the house
name — same pattern as admin. Same endpoint, same cascade, just with a
JWT instead of the admin cookie.

For v1 we do not ship the iOS UI. We ship only the server endpoint, the
helper, and the admin UI, plus the client-side detection plumbing so that
the admin-delete case produces a clean UX for any iOS client already
holding the dead session. That detection plumbing is what v2 will
piggyback on when owner-delete lands.

## Rollout

1. Add the `deleteHouseholdCascade` helper + contract tests. This is pure
   DB logic, independently verifiable.
2. Add `assertHouseholdExists` and thread it into owner-scoped and
   guest-scoped handlers. Contract tests for each asserting 410 after
   the household is deleted out from under the request.
3. Add the `DELETE /admin/houses/:id` route and contract test.
4. Add the admin UI (delete button, confirmation modal, error surface).
5. Add iOS: `houseDeleted` notification, `APIClient` detection on 410,
   `AppRouter` subscriber, SSE final-event handling, reuse
   `AccessRevokedView` for the dialog.
6. Deploy backend + ship iOS via `deploy.sh`.
7. v2 (separate PR): `DELETE /household` endpoint + iOS "delete this
   house" surface in the owner settings sheet.

Each step is independently deployable. Step 1 is a no-op to users (the
helper isn't called from any route yet). Steps 2–4 are the shippable v1.
Step 5 is the polish that makes v1 feel complete without requiring an iOS
redeploy in lockstep — the backend cleanly returns 410; older iOS clients
will simply see `APIError.http(410)` and show "Something went wrong" until
they update.

## Open questions

- Do we want a `Retry-After`-style grace period between admin delete and
  the cascade actually running, so an admin can un-press the button?
  Recommendation: no. The typed-name confirmation is the grace period.
- Should the admin delete endpoint return the row counts it cleaned up
  (`{ guests: 3, documents: 14, chunks: 211 }`) for the admin UI to show?
  Nice-to-have, not required — deferred.
- Connections hold Google Drive refresh tokens. We delete the row, but
  should we also call the provider's revocation endpoint so the token is
  invalidated upstream? Recommendation: yes, but as a follow-up — do it
  best-effort outside the transaction so a Google outage doesn't block
  deletion. Captured separately in `BACKLOG.md`.
