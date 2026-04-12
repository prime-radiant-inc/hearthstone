# Multi-Server App Design

## Goal

Let one Hearthstone iOS app connect to multiple independent self-hosted servers, so that publishing the app once unblocks any number of people running their own servers. Each server stays unaware that it is one of many; the app holds the multi-server constellation.

## Problem

Today the iOS app has a hardcoded `baseURL` (`localhost:3000` in debug, `hearthstone-mhat.fly.dev` in release). Publishing mobile apps is annoying enough that we want to publish a single binary and let users point it at whichever server they want. Houses today are created with a CLI script run by the server operator, which is fine for one operator but awkward when several people share a server.

We need:

1. A way for one app install to hold sessions on several servers at once.
2. A frictionless way for the *invited* user to land on the right server, without typing URLs or PINs.
3. A way for the server operator to create houses and issue owner invites without shelling into the box every time.
4. A trust model that does not require any persistent admin credential.

## Design Decisions

These were settled during brainstorming and are load-bearing for everything below.

- **One QR / one link, always.** Every invite — bootstrap, guest, co-owner — produces a QR that encodes a URL of the form `https://<server>/join/<pin>`. The same URL is also sharable as text. There is no flow in which the user types a PIN or a server URL by hand.
- **PINs are a backend implementation detail.** The server still mints and validates short-lived PINs, but the iOS app never asks the user to enter one. The existing `PINEntryView` is removed.
- **Each `HouseSession` carries its own server URL.** No ambient "current server" state outside the active session.
- **The app only learns about a server through a redemption flow.** Scan a QR, tap a link, or paste a link. There is no "Settings → Add Server → enter URL" screen.
- **Server operator authenticates to the admin UI by reading a token from the server's logs.** No admin user record, no admin password, no persistent admin credential. Token rotates on every process start.
- **House creation is admin-only.** House owners can invite more owners and guests to their own house, but cannot create new houses. This eliminates the need for a per-user permission system in v1.
- **No Universal Links.** The app uses a custom URL scheme (`hearthstone://`). The web `https://<server>/join/<pin>` URL is a server-rendered landing page that redirects to the custom scheme. This sidesteps the AASA / Associated Domains entitlement problem for arbitrary self-hosted domains.

## Payload Format

Every invite produces this URL:

```
https://<server>/join/<pin>
```

The QR encodes this URL verbatim. The same URL is what gets shared by text or email.

### Server-side join page

`GET /join/:pin` returns a small HTML page that:

1. Issues a meta-refresh and a JavaScript redirect to `hearthstone://join?server=<url-encoded-server>&pin=<pin>`.
2. Shows a visible **Open in Hearthstone** button pointing at the same custom-scheme URL. User-initiated taps are more reliable on iOS than auto-redirects.
3. Includes fallback copy for users who do not have the app installed: "Don't have Hearthstone yet? Here's how to get it." Plus the raw 6-digit PIN displayed for reference (purely informational — the user does not type it anywhere).

The page is plain HTML and should match the project's warm aesthetic. No SPA framework.

### Custom URL scheme

The iOS app registers `hearthstone://` in `Info.plist`. Incoming URLs of the form `hearthstone://join?server=<url>&pin=<pin>` are parsed:

- `server` is URL-decoded into a `URL`.
- `pin` is the raw PIN string.
- The app calls the unauthenticated bootstrap client (see below) to redeem the PIN against `server`.

### In-app QR scanner

The QR scanner accepts both forms directly without any network round-trip:

- `https://<server>/join/<pin>` — parse host as server, last path segment as PIN.
- `hearthstone://join?server=...&pin=...` — parse query parameters.

The scanner never falls back to the web redirect. It produces the same `(serverURL, pin)` pair for both forms.

## iOS Data Model and Client Changes

### `HouseSession` gains `serverURL`

```swift
struct HouseSession: Identifiable, Codable, Equatable {
    let id: String
    let serverURL: URL        // NEW
    let householdId: String
    var householdName: String
    let role: HouseRole
    var personName: String?
    let addedAt: Date
}
```

### `APIClient` becomes session-scoped

`APIClient.shared` (a singleton with hardcoded `baseURL`) is removed. In its place:

```swift
final class APIClient {
    let serverURL: URL
    let token: String

    init(serverURL: URL, token: String) { ... }

    // All authenticated endpoints. Every request uses self.serverURL and self.token.
    // No global lookups, no implicit state.
}

extension HouseSession {
    func apiClient() -> APIClient? {
        guard let token = KeychainService.shared.read(key: "hst_\(id)") else { return nil }
        return APIClient(serverURL: serverURL, token: token)
    }
}
```

Call sites change from `APIClient.shared.foo()` to `session.apiClient()?.foo()` (or pass the client through view models). This is mechanical but touches every authenticated call site. The result is that every request in the codebase makes its server explicit at the call site.

`SSEClient` follows the same pattern: takes `serverURL` and `token` at construction. No hidden lookups.

### `UnauthenticatedClient` for bootstrap

A separate, intentionally narrow type for calls that happen *before* a session exists:

```swift
final class UnauthenticatedClient {
    let serverURL: URL
    init(serverURL: URL) { ... }

    func redeemPin(_ pin: String) async throws -> RedeemResult
}
```

It has no token field. It cannot be misused for authenticated calls because those endpoints do not exist on it. The only thing it does is hit `POST /auth/pin/redeem` against a specific server URL.

### `SessionStore` changes

- New session adds (from any flow) include the `serverURL`.
- `load()` runs a one-time migration: any persisted session without `serverURL` gets `https://hearthstone-mhat.fly.dev` filled in and re-persisted. Migration code may be removed after a few releases.
- New sessions do **not** auto-activate, *except* when the session list was empty before the add — in which case the new session becomes active automatically (otherwise the user would have nothing selected). `add(session:token:)` appends to the list and persists; it sets `activeSessionId` only when there is no current active session. The user must explicitly tap the new session in the sidebar to switch in all other cases. (This is a behavior change from today, where `add` always sets the active session.)
- New method: `hasSession(forServer host: String) -> Bool` — used to drive the "first time seeing this server" confirmation prompt.

## Backend Changes

### Configuration

New required env var:

- `HEARTHSTONE_PUBLIC_URL` — the server's public base URL (e.g. `https://hearthstone-mhat.fly.dev`). Used to construct `join_url` values returned from invite-creating endpoints. Server fails to start if it is unset.

### New routes

All admin routes are gated by a `requireAdmin` middleware that checks for the `hadm` cookie or `Bearer hadm_…` header. The middleware compares against the in-memory admin token (see below).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/join/:pin` | Public HTML landing page (no auth). Redirects to `hearthstone://`. |
| `GET` | `/admin` | Admin HTML page (cookie check). |
| `POST` | `/admin/auth` | Exchange `?t=<token>` query for the cookie, then 302 to `/admin`. |
| `GET` | `/admin/houses` | JSON list of houses with counts. |
| `POST` | `/admin/houses` | Body: `{ "name": "..." }`. Creates a house, mints first owner PIN, returns `{ house, pin, join_url }`. |
| `GET` | `/admin/info` | Server diagnostics (public URL, db file size, version, etc.). |

### Existing endpoints — `join_url` in responses

Endpoints that today return a magic_link or PIN now also return a `join_url`. Specifically:

- `POST /guests` (invite a guest)
- `POST /guests/:id/reinvite`
- `POST /household/owners` (invite a co-owner)

The `join_url` is constructed as `${HEARTHSTONE_PUBLIC_URL}/join/${pin}`. The existing `magic_link` field is removed in the same change — there is no longer a separate magic-link concept. The spec at `.brainstorm/spec.md` and the contract test at `tests/api-contract.test.ts` must be updated to reflect this.

### No schema changes

Houses, persons, guests, household_members, auth_pins, session_tokens, documents, chunks — all unchanged. The server has no concept of "this server is one of many." It just is itself.

### Admin token

```
On process start:
  token = "hadm_" + base32(crypto.randomBytes(16))
  Stored in a single in-memory variable. Never written to disk.
  Logged once to stdout (NOT through the OTel exporter):
    === Hearthstone admin ===
    URL: ${HEARTHSTONE_PUBLIC_URL}/admin/auth?t=${token}
    Valid until process restart.
```

The `requireAdmin` middleware accepts the token via:
- `Cookie: hadm=<token>` — set by `POST /admin/auth`
- `Authorization: Bearer hadm_<token>` — for scripted use

Cookie is `httponly`, `secure`, `samesite=strict`, and unscoped on duration (browser-session lifetime). Server restart invalidates the in-memory token, so any cookie set against the previous token will fail authentication on the next request.

The token is logged via `console.log` only, never via the structured tracer, so it does not flow into Honeycomb.

## Admin UI

A single server-rendered page at `/admin`. Plain HTML, minimal CSS, no SPA framework. Should look intentional and match the project's warm aesthetic — not a hand-wave prototype.

### Sections

1. **Houses** — Table with columns: name, created date, owners count, guests count, documents count. Above the table: **Create house** button. No per-row actions in v1; the table is read-mostly.
2. **Server info** — public URL, SQLite file size, hearthstone version. Read-only.

(Activity log section is deferred — nice-to-have, not v1.)

### Create house flow

1. Operator clicks **Create house**.
2. Modal: house name input, **Create** button.
3. Server creates the house and mints a first owner PIN. Returns `{ house, pin, join_url }`.
4. Modal updates to show:
   - The QR encoding `join_url`
   - The `join_url` itself with a copy button
   - The raw PIN, displayed for reference
   - Instructions: "Send this to the person who will be the house's first owner. The link is single-use and expires in 7 days."
5. Closing the modal returns to the houses table, which now includes the new house.

### CLI house creation stays

The existing CLI house-creation script keeps working as an escape hatch for scripting. The web UI does not replace it; it is the convenient default.

## End-to-End Flows

### Flow A — Bootstrap a brand-new server

1. Operator deploys Hearthstone with `HEARTHSTONE_PUBLIC_URL` set. Server boots, `console.log` prints the admin URL with the freshly-rotated token.
2. Operator runs `fly logs`, copies the URL, opens it in a browser. `POST /admin/auth` sets the cookie, redirects to `/admin`.
3. Operator clicks **Create house**, names it, clicks Create. Modal shows the QR + join URL.
4. Operator sends the link to the future first owner (text, signal, in person).
5. First owner taps the link → browser → custom-scheme redirect → app opens → app calls `UnauthenticatedClient(serverURL:).redeemPin(pin)` → server returns the same `{token, role, person|guest, household}` shape as today's `POST /auth/pin/redeem` → app constructs a `HouseSession` and writes it to `SessionStore`.
6. Because no session was active before, the new session activates automatically (the "session list was empty" exception to the no-auto-activate rule).

### Flow B — House owner invites a guest or co-owner

1. Owner is in their house in the app, taps **Invite guest** (or **Invite owner**).
2. App calls `POST /guests` (or `/household/owners`) on the active session's server.
3. Backend mints a PIN, returns `{ guest, pin, join_url }`.
4. App shows `GuestPINView`, but the QR now encodes `join_url`. There is a **Share link** button that surfaces `join_url` for system share-sheet (text, mail, etc.).
5. Recipient gets the QR or link. Same redemption path as Flow A.
6. Recipient's app adds the new session to its `SessionStore` *without auto-switching*. If the recipient has at least one existing session, they remain on it; the new house is just present in the sidebar. If this is their first session, it activates automatically.
7. Before the new session is added, if its `serverURL.host` is one the app has never seen before, the app shows a confirmation modal: "You're about to connect to a new server: `evil.example.com`. Continue?" One extra tap, only the first time per host. For known hosts, no prompt.

### Flow C — Same-server invite

This is not a special code path. It is just Flow B where the resulting `serverURL` happens to match a server already in the user's session list. The "first time seeing this host" prompt does not fire. The new session is added to the sidebar; the recipient switches to it manually if they want to.

## Removed Surfaces

- `PINEntryView` and its numeric pad. Deleted.
- Manual PIN entry as a code path. The app never reads a 6-digit PIN from a text field.
- `APIClient.shared` singleton.
- The `magic_link` field in invite responses (replaced by `join_url`).

## First-Launch Experience

When the app launches and `SessionStore.sessions.isEmpty`, the user sees a landing screen with:

- App title and brief description.
- **Scan QR** button → opens camera, runs the existing scanner (now parsing URLs, not PINs).
- **Paste link** button → clipboard detect or a paste field. Parses the same URL formats as the scanner.

No keypad, no email field, no server URL field.

## Migration

### Server side

1. Set `HEARTHSTONE_PUBLIC_URL` in Fly secrets.
2. Deploy the new build. Existing app installs (old version) keep working — old endpoints are unchanged.

### Client side

1. Ship the new iOS build.
2. On first open, `SessionStore.load()` fills in `serverURL` for any session that lacks it (`https://hearthstone-mhat.fly.dev`).
3. Existing Keychain tokens are unchanged. Existing sessions remain active.

No data migration. No user action required. No coordinated cutover.

## Security

### Mitigations included

- **First-time-seeing-this-server confirmation prompt** before adding a session whose host is novel to the app.
- **New sessions do not auto-activate** (except the very first session ever added). Prevents the "scanned a QR and now my chat is being read by a stranger" failure mode.
- **Admin token logged via `console.log` only**, never through the OTel exporter, so it does not flow to Honeycomb or any other tracing sink.

### Accepted limitations

- **No TLS pinning.** Standard HTTPS trust model.
- **`hearthstone://` scheme is not exclusive.** Another app could register the same scheme; iOS does not prevent this. Acceptable for a self-hosted hobby app.
- **Admin token visible to anyone with log access.** This is the trust model, by design.
- **Leaked join links are equivalent to leaked PINs.** Same single-use, short-lived constraints apply. The leak now also reveals the server hostname, but for self-hosted servers that hostname is generally not secret.

## Out of Scope

- House owners creating additional houses on a server they're already on.
- Server federation or discovery (a directory of servers, etc.).
- Persistent admin user accounts.
- Universal Links / Associated Domains.
- A `Server` entity in the iOS data model (sidebar grouping by server). Can be added later if the flat sidebar becomes hard to scan.
- Recent activity / audit log in the admin UI.
- Migration of the existing email+passkey owner auth code paths. They remain in the codebase but are not used; cleanup is a separate concern.

## Open Questions for Implementation

None blocking. Items the implementing Bob should decide as they go:

- Exact wording of the confirmation modal copy.
- Visual layout of the admin UI (table styling, modal presentation). Should be designed to look intentional, not a wireframe.
- Where to place the `hasSession(forServer:)` check in the redemption pipeline (before or after the `redeemPin` API call). Either is defensible; before is friendlier (don't burn the PIN if the user backs out), after is simpler (one path).
