---
name: Design decisions — current auth and product scope
description: How auth actually works in Hearthstone today (PIN redeem), plus scope decisions that outlive individual features
type: project
---

Auth architecture: short-lived numeric PINs redeemed at `POST /auth/pin/redeem`, returning either an owner JWT or a guest `hss_` session token. There is no email/password login, no magic link, and no WebAuthn — those were considered in early planning docs but never shipped. **Why:** PIN-over-QR is dramatically simpler for the "guest is standing next to the owner" case the product actually targets, and dropping the email stack removed an entire class of deliverability bugs. **How to apply:** when something in the codebase still references `email_verifications`, `passkey_credentials`, `invite_tokens`, `handleRegister`, or `/auth/invite/redeem`, it's stale — the current paths are `/admin/houses` + `/household/owners` (owner invites) and `POST /guests` (guest invites), each of which mints an auth PIN and returns a `join_url`. See `backend/src/routes/pin-auth.ts` and `backend/src/services/pins.ts` for the live implementation.

Google Drive is a _document source_, not an identity provider. **Why:** keeps identity orthogonal to "where does this house's knowledge live" so a future second source (Notion, Dropbox, plain upload — upload already exists via `POST /documents/upload`) doesn't force a parallel auth stack. **How to apply:** Drive OAuth lives under `/connections/google-drive/*` and only touches the `connections` table. It must not mint sessions.

Documents (v0): flat list, no folder hierarchy. **How to apply:** Connect Documents screen shows individual docs, not grouped by Drive folder.

Visual direction: warm and homey but not hokey. Fraunces (serif) for headings, DM Sans for body. Amber/sienna/cream palette, with a warm dark mode sibling (see `project_dark_mode.md`). Early mocks live in `mocks/` at the repo root — they're kept for historical reference, not as the source of truth.
