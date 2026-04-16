# Security Decisions

The threat model Hearthstone actually targets, the mechanics that enforce it, and the gaps that exist on purpose. Security claims here are checked against the live code; if something in this file disagrees with `backend/src/middleware/*` or `backend/src/services/*`, the code wins and this file needs an update.

## Threat model

Hearthstone is a hobby-scale household app shipped to people the operator knows in real life. The threats it takes seriously are:

- **A guest's invite link gets forwarded to someone who shouldn't have it.** Mitigation: short-lived single-use PINs, owner can revoke any guest at any time, revocation is enforced on every request.
- **A guest device is lost or stolen.** Mitigation: owner revokes the guest from the dashboard; the next request from that token returns `401 session_expired`, the iOS client sees it and removes the session. There's no "remember device" or long-lived refresh — the session token itself is the credential.
- **A discarded admin token is found in `fly logs` history.** Mitigation: the admin token is rotated on every server start and has no persistence — a process restart invalidates every old token.
- **An attacker tries to brute-force the PIN redeem endpoint.** Mitigation today: 30 bits of PIN entropy + 7-day TTL. Mitigation tomorrow: rate limiting on `/auth/pin/redeem` (deferred — see `BACKLOG.md`).
- **Stale OAuth tokens for Google Drive.** Mitigation: refresh tokens are scoped to the household's `connections` row, never returned to the client, only used server-side when fetching documents the household has chosen to connect.

The threats Hearthstone explicitly does *not* model:

- **Internet-scale account takeover.** There are no accounts, no passwords, and no public registration. The whole "credential stuffing → OWASP top 10 auth section" surface doesn't exist.
- **CSRF against a web UI.** Almost no web UI exists. The only authenticated browser surfaces are `/admin/*` (gated by an in-memory token, not session cookies an attacker can ride) and `/connections/google-drive/callback` (state-checked OAuth handshake). The iOS client uses Bearer tokens, not cookies, and is the only thing that talks to authenticated JSON endpoints.
- **Multi-tenant isolation under hostile co-tenants.** Households on a shared server are isolated by `household_id` scoping in every query, but the deployment model assumes the operator personally trusts every owner they let onto their server. This is not a SaaS.
- **Sophisticated supply-chain attacks.** Dependencies are pinned in `bun.lock` and `Package.resolved`; updates are reviewed by hand. There is no SBOM pipeline. The dependency surface is small (`jose`, `openai`, `googleapis`, `sqlite-vec`, OpenTelemetry, `pandoc` system package).
- **Side-channel attacks on a single shared box.** Fly machines are isolated by Fly. Anything below that is Fly's problem.

This is "a friend group's hobby app threat model." Anything that would make sense for a B2B SaaS but doesn't make sense here is in the "deliberately not modeled" column. See the `feedback_threat_model_scale` memory for the principle the operator wants applied here.

## Identity surfaces

There are three distinct authenticated principals, each with its own token and middleware:

| Principal | Token | Stored where | Lifetime | Middleware |
|---|---|---|---|---|
| Owner | JWT (`HS256`, claims: `personId`, `householdId`) | iOS Keychain (`hst_<sessionId>`), never persisted server-side | 30 days | `middleware/owner-auth.ts` |
| Guest | `hss_`-prefixed opaque token | DB (`session_tokens`), iOS Keychain | Until revoked | `middleware/guest-auth.ts` |
| Operator (admin) | `hadm_`-prefixed in-memory token | Process memory only | Until next restart | `middleware/admin-auth.ts` |

There is no fourth tier. There is no "user" record decoupled from "owner" — every Person is an owner of at least one household, by construction (a Person row is only created when a PIN gets redeemed for an owner role, or when the admin creates a placeholder for a pending owner invite).

## PIN redemption

PINs are the only path into any of the three identity surfaces (operator excepted; the operator already has shell access). The full mechanics live in `decisions-tech.md` §Auth and `services/pins.ts`. Security-relevant claims:

- **Alphabet:** Crockford base32, 6 characters → ~30 bits of entropy → ~1 billion possible PINs.
- **TTL:** 7 days. After that, redemption returns `410 expired`.
- **Single-use:** redemption stamps `used_at`; replay returns `410 already_used`.
- **Normalization:** `redeemPin()` runs `normalizePin()` (trim + uppercase) and validates against `PIN_REGEX` before the DB lookup. A malformed PIN never reaches the lookup, so the SQL surface is constant regardless of input.
- **No oracle:** `not_found` and `expired` and `already_used` all return distinct status codes and messages, but they don't leak which PINs *exist* — the `not_found` path runs the same query as the others, so timing is comparable. (This is mostly accidental; if a real attacker showed up we'd want explicit constant-time handling.)
- **No rate limiting yet.** This is the most important known gap. Without it, an attacker doing 50 req/s would chew through the whole space in ~7 months. That's safe-ish in absolute terms, especially with 7-day TTLs cycling out PINs underneath them, but it's defense-in-depth we should build before scaling.

## Owner JWT (`middleware/owner-auth.ts`)

```
authHeader: Bearer <jwt>
↓
jose.jwtVerify(token, secret)   // HS256
↓
person = SELECT id FROM persons WHERE id = ?  // existence check
↓
member = SELECT id FROM household_members WHERE person_id=? AND household_id=? AND role='owner'
↓
return { personId, householdId }
```

Notes:

- **Symmetric `HS256` signing key** is `JWT_SECRET`, set via `fly secrets set`. Single key, no rotation today. Rotation would invalidate every active owner session; that's acceptable in an emergency.
- **Membership re-check on every request.** The JWT carries `householdId` as a claim, but the middleware re-queries `household_members` every time to confirm the Person still owns the Household named in the JWT. Removing an owner from a household via `DELETE /household/owners/:id` immediately blocks their next request — no need to revoke the JWT itself.
- **Deleted-house detection.** If the membership check fails, `authenticateOwner` distinguishes "the household was deleted" (→ `HouseholdGoneError` → 410 Gone) from "you're not an owner of this household" (→ 401). The iOS client detects 410 and removes the dead session from the local store.
- **Legacy fallback.** If a JWT carries no `householdId`, the middleware finds *any* household this person owns and returns it. This handles JWTs minted before multi-house support landed. The fallback is harmless because the membership table is still the gate; an old JWT just resolves to "the household this Person owns." It's safe to delete this fallback at any time.
- **No refresh token, no revocation list.** The JWT is the credential. If `JWT_SECRET` is leaked, every owner session must be invalidated by rotating the secret. There's no per-session revocation hook today.

## Guest session token (`middleware/guest-auth.ts`)

```
authHeader: Bearer hss_...
↓
validateSessionToken(db, token)  // SELECT * FROM session_tokens WHERE token=? AND revoked_at IS NULL
↓
return { guestId, householdId } | null
↓
if null: throw "session_expired"
```

Notes:

- **Opaque tokens, not signed.** Lookup is a single indexed query. The token has no embedded claims; everything is in the row.
- **Generated by `crypto.randomBytes(32)`** in base64url, prefixed `hss_`. ~256 bits of entropy.
- **Stored in plaintext in the DB.** Acceptable in this threat model (the DB is co-located with the server and behind the same trust boundary). If the DB file leaks, every guest session is compromised — the same attacker also has every chunk of every document, which is worse.
- **Revocation is immediate.** `revokeGuestTokens(db, guestId)` sets `revoked_at` on every live token for that guest; the next `validateSessionToken` returns null; the middleware throws `session_expired`; the iOS client picks that up and broadcasts `.guestSessionRevoked` via `NotificationCenter`, which clears the local session.

## Admin token (`services/admin-token.ts` + `middleware/admin-auth.ts`)

The admin UI is gated by an in-memory bearer token rotated on every server start.

- **Format:** `hadm_` + 26-char base32 (RFC 4648 alphabet) over 16 random bytes → 128 bits of entropy.
- **Lifecycle:** `mintAdminToken()` is called once during server boot; the value lives in a module-level `let` and is `console.log`'d to stdout. The operator reads it via `fly logs` and clicks the resulting `/admin/auth?t=<token>` URL.
- **Persistence:** none. A process restart invalidates the previous token. Auto-suspend on Fly (`auto_stop_machines = "suspend"`) means even a 24-hour-stale terminal scrollback doesn't leak a still-valid token if the machine has cycled.
- **Tracing isolation:** the token is logged via `console.log`, never through any OTel attribute or span. This is deliberate so that enabling tracing doesn't leak the token into Honeycomb.
- **Comparison:** `verifyAdminToken` does a length check followed by a constant-time-ish XOR diff. Not a guaranteed constant-time primitive, but close enough for the scale.
- **Acceptance:** both `Cookie: hadm=<token>` and `Authorization: Bearer hadm_<token>` are accepted. The cookie is set by `GET|POST /admin/auth?t=<token>` with `HttpOnly`, `Secure`, `SameSite=Strict`. Both verbs are accepted on `/admin/auth` because operators commonly click the admin URL straight out of `fly logs` (a GET) and curl/scripted access uses POST. There's a contract test (`api-contract.test.ts` → "accepts both GET and POST on /admin/auth") that fails if either branch gets dropped.

## Authorization enforcement

Hearthstone enforces authorization at the **handler level**, not at the middleware level. The middleware only answers "is this Bearer token a real owner / guest / admin?" — it doesn't know what they're allowed to do.

Pattern in `index.ts`:

```ts
if (method === "POST" && pathname === "/guests") {
  const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
  assertHouseholdExists(getDb(), owner.householdId);
  const result = await handleCreateGuest(getDb(), owner.householdId, owner.personId, body, ...);
  return json(result.body, result.status);
}
```

Two structural checks run before every owner-scoped handler:

1. **`authenticateOwner`** — validates the JWT, confirms `person` exists, confirms membership in the named household. Returns `{ personId, householdId }` from the validated context, *not* from the request body. A malicious owner cannot read another household's data by manipulating a request param — there is no `householdId` in any request param.
2. **`assertHouseholdExists`** — confirms the household row still exists in the DB. If the house was deleted (by the admin or the last owner), this throws `HouseholdGoneError`, which the global catch block maps to 410 Gone. This call appears on every owner-scoped route in `index.ts` — it's the backstop that ensures a deleted household can't be interacted with even if an old JWT is somehow still valid.

House deletion itself (`DELETE /admin/houses/:id` and `DELETE /household`) runs inside a single `db.transaction()` via `deleteHouseholdCascade`, which removes all household-scoped rows in dependency order: chunk_embeddings, chunks, documents, connections, suggestions, session_tokens, auth_pins, guests, household_members, the household row, and any placeholder person rows created during admin-minted invites.

The same pattern holds for `GuestContext`. Guest-scoped routes (`POST /chat`, `GET /documents/:id/content`, etc.) resolve a `GuestContext` and use `guest.householdId` as the scope. A guest cannot ask `POST /chat` against a household they aren't a guest of, because `householdId` is taken from their session token.

The admin routes are the exception: those use `requireAdmin(req)` and operate on global resources (`/admin/houses` lists every house on the box). That's by design — the admin is the operator, and the operator is trusted with everything.

## Google Drive OAuth

- **Scope:** read-only Drive scopes only. The owner consents during onboarding.
- **Refresh token:** stored in `connections.refresh_token` for the household. Plaintext (see DB-leak note above). Never returned to the client.
- **Access token:** never persisted. Minted from the refresh token at request time and used immediately.
- **State CSRF guard:** the `/connections/google-drive` initiate route generates a `state` value and stores it; the `/connections/google-drive/callback` route checks it before accepting the code.
- **Redirect URI:** `${APP_BASE_URL}/connections/google-drive/callback`. `APP_BASE_URL` is the only thing the redirect URI is built from, and Google requires exact-match registration. If `APP_BASE_URL` and the registered URI drift, OAuth breaks loudly — there's no silent failure mode.

## Transport, cookies, network

- **HTTPS-only in production.** `force_https = true` in `fly.toml.example`.
- **HSTS** is not explicitly set by the application — Fly's edge adds it for HTTPS apps.
- **Cookies:** the only cookie the app sets is `hadm`, on `/admin/auth`. It's `HttpOnly`, `Secure`, `SameSite=Strict`, browser-session lifetime. There are no session cookies for non-admin paths because non-admin clients use Bearer tokens, not cookies.
- **CORS:** unset. The iOS client doesn't send `Origin` and there is no browser-facing JSON API.
- **CSP:** none. The only HTML surfaces are `/join/:pin` (single redirect page, no user input, no XSS surface) and `/admin` (operator-only). Adding a CSP for these would be defense in depth but isn't urgent.

## Where secrets live

| Secret | Where | Rotation |
|---|---|---|
| `JWT_SECRET` | `fly secrets set`, env var on the machine | Manual; rotation invalidates all owner sessions |
| `OPENAI_API_KEY` | `fly secrets set` | Manual via OpenAI dashboard |
| `GOOGLE_CLIENT_SECRET` | `fly secrets set` | Manual via Google Cloud Console |
| `HEARTHSTONE_PUBLIC_URL` | `fly secrets set` | Doesn't rotate; this is the deployment domain |
| Drive `refresh_token` | DB `connections.refresh_token` | Per-household; revoke via Google account UI to force re-auth |
| Admin token | Process memory only | On every server start |
| Guest `hss_` tokens | DB `session_tokens.token` | Per-guest, immediately via `POST /guests/:id/revoke` |

The `.env` file on the machine is the only place env-level secrets touch disk in production. There is no secret manager, KMS, or vault.

