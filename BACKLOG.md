# Backlog

Pinned followups that are scoped but deliberately not built yet. Add an entry
when something gets explicitly deferred so the context isn't lost in chat
history. Remove an entry when it ships.

## Rate limiting on `/auth/pin/redeem`

**What:** A small rate limiter in front of `POST /auth/pin/redeem` (and ideally `GET /join/:pin` as well) to cap guesses per IP. A bucket in the 10/min range is plenty for legitimate traffic and closes the online brute-force attack against the PIN space.

**Why it matters:** PINs are now 6-character Crockford base32 — ~30 bits, ~1 billion possibilities. Without rate limiting, a naive attacker at 50 req/s would take ~7 months to exhaust the whole space, which is fine in principle but means we're relying on entropy alone for an unauthenticated endpoint. Defense in depth is cheap here.

**Shape:** a table of recent attempts keyed by IP, or a sliding-window counter in memory (single-machine, so no distributed state needed yet). Either plug in a library (e.g. `hono/ratelimit`, though we're not on Hono) or write the ~30 lines by hand. If we ever run more than one Fly machine, this has to move into a shared store.

**Why deferred:** no evidence of abuse at current scale; the PIN entropy bump covers the gap for now. Pinned 2026-04-14 after switching the PIN alphabet from 6 decimal digits to 6 Crockford base32 chars.

---

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
