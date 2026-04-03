---
name: Design decisions — v0 scope and future ideas
description: Key design decisions and deferred features for Hearthstone iOS app
type: project
---

Auth architecture: Passkey + email verification for owner identity. Google Drive is a "connection" (document source), not identity. **Why:** Decouples identity from doc sources, simpler than multi-SSO. **How to apply:** Sign-in flow is email → verify code → create passkey. Drive connection is a separate step in settings/onboarding.

Guest access (v0): Magic link via email. **Future:** QR code option for in-person scenarios (guest is standing there). Email code as alternative to magic link. Defer to post-v0.

Documents (v0): Flat list, no folder hierarchy in the picker. **How to apply:** Connect Documents screen shows individual docs, not grouped by Drive folder.

Visual direction: Warm and homey but not hokey. Fraunces (serif) for headings, DM Sans for body. Amber/sienna/cream palette. Mocks finalized in mocks/ directory (3 clusters, 16 screens).
