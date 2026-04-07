# PIN-Based Authentication — Design Spec

## Problem

The current auth flow requires email delivery (Resend) for both owner verification and guest invites. For an OSS release where users self-host, this is unnecessary friction. Guests are typically in-person (babysitter, house-sitter) — a PIN shown on the owner's screen or read aloud is simpler than an email round-trip.

## Solution

Replace email-based auth with PIN-based auth as the default flow. A CLI command creates households and emits owner PINs. Guest PINs are generated in-app and shown on screen. One endpoint redeems both types. One iOS screen accepts PINs.

Email auth stays in the codebase but is dormant — not wired into the default iOS flow.

## Design Principles

- **PIN is the default.** No external dependencies for auth.
- **Email is preserved.** The code stays, Resend becomes optional. A commercial fork can re-enable it.
- **Same mental model for everyone.** Owner gets a PIN from CLI. Guest gets a PIN from the owner. Both type it into the same screen.

---

## 1. Data Model

### New table: `auth_pins`

```sql
CREATE TABLE IF NOT EXISTS auth_pins (
  id TEXT PRIMARY KEY,
  pin TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'guest')),
  person_id TEXT NOT NULL REFERENCES persons(id),
  household_id TEXT NOT NULL REFERENCES households(id),
  guest_id TEXT REFERENCES guests(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
```

- `role: 'owner'` — PIN grants owner JWT for the household
- `role: 'guest'` — PIN grants `hss_` session token for the guest
- `guest_id` is NULL for owner PINs
- PINs are 6-digit numeric strings (e.g. `482901`)
- PINs expire after 7 days
- PINs are single-use (once `used_at` is set, redemption fails)

### Existing tables unchanged

`persons`, `households`, `guests`, `session_tokens`, `invite_tokens` — all stay. The email auth tables (`email_verifications`, `passkey_credentials`) remain but are dormant.

### Config change

`RESEND_API_KEY` becomes optional in `config.ts`. If absent, email-related code paths are skipped without crashing.

---

## 2. CLI Command

### `bun run create-household`

Script: `backend/cli/create-household.ts`

Interactive prompt via stdin:
```
Household name: The Anderson Home
Owner email: matt@example.com

✓ Created household "The Anderson Home"
✓ Owner PIN: 482901
  Expires: 2026-04-13

Enter this PIN in the Hearthstone app to sign in as the owner.
```

Steps:
1. Read household name and owner email from stdin
2. Create `persons` record (email is metadata, not used for delivery)
3. Create `households` record with `owner_id` pointing to the new person
4. Generate 6-digit PIN → insert into `auth_pins` with `role: 'owner'`
5. Print PIN and expiry to stdout

### `bun run owner-pin <household-id>`

Script: `backend/cli/owner-pin.ts`

Generates a new owner PIN for an existing household. Used when the original PIN expires.

---

## 3. PIN Generation

Utility function in `src/services/pins.ts`:

```typescript
function generatePin(): string
```

- Generates a cryptographically random 6-digit numeric string
- Retries if the PIN collides with an existing unexpired PIN in the database
- Returns the PIN string (e.g. `"482901"`)

```typescript
function createAuthPin(db, opts: {
  role: 'owner' | 'guest',
  personId: string,
  householdId: string,
  guestId?: string,
}): { pin: string, expiresAt: string }
```

- Generates PIN via `generatePin()`
- Inserts into `auth_pins` table
- Returns the PIN and expiry timestamp

---

## 4. API Endpoints

### `POST /auth/pin/redeem`

Redeems a PIN for a session token. Handles both owner and guest PINs.

**Request:**
```json
{
  "pin": "482901"
}
```

**Response (owner — role: 'owner'):**
```json
{
  "token": "jwt...",
  "role": "owner",
  "person": { "id": "uuid", "email": "matt@example.com" },
  "household": { "id": "uuid", "name": "The Anderson Home", "created_at": "2024-01-01T00:00:00Z" }
}
```

**Response (guest — role: 'guest'):**
```json
{
  "token": "hss_...",
  "role": "guest",
  "guest": { "id": "uuid", "name": "Maria", "household_id": "uuid" },
  "household_name": "The Anderson Home"
}
```

**Behavior:**
- Look up PIN in `auth_pins` where `used_at IS NULL`
- If not found → 404 `"PIN not found"`
- If `expires_at` < now → 410 `"This PIN has expired"`
- If `used_at` is set → 410 `"This PIN has already been used"`
- Mark `used_at` = now
- For owner: mint JWT (same as current `issueJwt`), return person + household
- For guest: mint `hss_` session token (same as current invite redeem flow), update guest status to `active`, return guest + household name

**Errors:**
- `404` — PIN not found
- `410` — PIN expired or already used

### `POST /guests` (modified)

Changes from current behavior:
- `phone` field removed from request
- `email` field becomes optional metadata (not used for delivery)
- Instead of generating an `hsi_` invite token, generates a 6-digit PIN via `createAuthPin`
- Response includes the PIN instead of a magic link

**Request:**
```json
{
  "name": "Maria",
  "email": "maria@example.com"
}
```

**Response:**
```json
{
  "guest": {
    "id": "uuid",
    "name": "Maria",
    "status": "pending"
  },
  "pin": "739201",
  "expires_at": "2026-04-13T00:00:00Z"
}
```

### `POST /guests/:id/reinvite` (modified)

Generates a new PIN instead of a new invite token.

**Response:**
```json
{
  "pin": "284710",
  "expires_at": "2026-04-13T00:00:00Z"
}
```

---

## 5. iOS Changes

### New: PINEntryView

Single auth screen replacing the email flow. Shown when the app has no stored tokens.

- Large "Enter your code" heading
- 6-digit numeric input, number pad, auto-focused
- Camera button to scan QR code (QR contains the 6-digit PIN as plain text)
- "Go" button calls `POST /auth/pin/redeem`
- On success: check `role` in response
  - `owner` → store JWT in Keychain → route to `.ownerDashboard`
  - `guest` → store `hss_` in Keychain + household name in UserDefaults → route to `.guestChat`
- Error handling: expired, used, not found — shown inline below the input

### Modified: AddGuestView

- Remove email/phone toggle — just name field + optional email
- After creation, show the PIN prominently + QR code
- Owner shows this screen to the guest

### Modified: GuestListView (reinvite)

- Reinvite response now returns `pin` + `expires_at` instead of `magic_link`
- Show the new PIN on screen (same presentation as AddGuestView)

### Modified: AppRouter

- Default initial state: no tokens → `.pinEntry` (new state)
- `.welcome`, `.verifyCode`, `.setupHousehold` states stay in enum but are unreachable from default flow

### Dormant (not removed)

- WelcomeView, VerifyCodeView, HouseholdSetupView — stay in codebase
- `handleRegister`, `handleRegisterVerify`, `handleLoginEmail`, `handleLoginEmailVerify` — stay in auth.ts
- `invite_tokens` table — stays in schema

---

## 6. QR Code

The QR code encodes the 6-digit PIN as plain text. No URL wrapping.

iOS provides `CoreImage.CIFilter` for QR generation — no external dependency. The guest scans it with the Hearthstone app (or just types the digits).

---

## 7. Scope

### In scope
- `auth_pins` table + migration
- PIN generation service
- `POST /auth/pin/redeem` endpoint
- CLI `create-household` and `owner-pin` commands
- `PINEntryView` iOS screen
- Modified `POST /guests` to return PIN instead of magic link
- Modified `POST /guests/:id/reinvite` to return PIN
- QR code display on guest PIN screen
- QR scanning on PIN entry screen
- Make `RESEND_API_KEY` optional
- Update API spec + contract tests

### Out of scope
- Removing email auth code (preserved for commercial)
- Email delivery (dormant)
- Phone/SMS (removed from guest creation)
- Invalidating old PINs when a new one is created (multiple valid PINs can coexist — they're all single-use, no conflict)
