# Backlog

Pinned followups that are scoped but deliberately not built yet. Add an entry
when something gets explicitly deferred so the context isn't lost in chat
history. Remove an entry when it ships.

## Admin-side house deletion

**What:** A way for the server operator to fully delete a house and its
related state from the admin UI — not "leave my session" (clients can already
do that), but "this house is gone, server-side." Requires a `DELETE
/admin/houses/:id` endpoint that hard-deletes inside a single transaction
across the rows that reference the household:

- `household_members`
- `guests`
- `documents` and `chunks` (and their embeddings)
- `auth_pins`
- `session_tokens`
- the `households` row itself

The schema today has no `ON DELETE CASCADE`, so the cascade is manual. Soft
delete (`deleted_at` column + filtering) was considered and rejected — adds
ongoing filter complexity for no real benefit on a hobby app.

**Client side:** iOS sessions whose server-side household has been deleted
need to handle "the server says this house no longer exists" gracefully.
Today the app would just see opaque 404s on every authenticated call. Likely
shape: detect a stable signal (e.g. `404` on `/me` or a dedicated 410), then
remove the session locally and surface an "this house was removed by the
server operator" notice — analogous to the existing `guestSessionRevoked`
flow.

**Why deferred:** Scope is real (transactional cascade + a new client-side
state machine), and the immediate need was unblocked by simpler fixes.
Pinned 2026-04-13 during the multi-server cleanup pass.
