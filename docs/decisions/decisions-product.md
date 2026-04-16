# Product Decisions

What Hearthstone *is*, who it's for, and the shape decisions that constrain everything else. The technical doc (`decisions-tech.md`) explains *how* — this one explains *why this kind of thing*. If a feature contradicts something in this file, the file is probably wrong, but the contradiction is worth raising before writing the code.

## What it is

Hearthstone is a household knowledge hub. An owner connects the documents they already maintain about their home — house manuals, kid routines, pet care notes, emergency contacts — and a guest staying in the house can ask questions in plain language and get answers grounded in those documents.

It's mobile-first (SwiftUI, iOS 17+), backed by a small Bun/SQLite server the operator runs themselves, and shipped to people you trust face-to-face — not to anyone who finds you on the internet. The product shape and the technical shape both follow from that.

## Who it's for

There are exactly two roles, and they are *very* different experiences:

**Owners** are the people responsible for a household — homeowners, parents, the friend in the group with the cabin. They have an account on a server, they manage which documents are connected, they invite and revoke guests, and they're the only ones who ever interact with the configuration surface. Owner UI is denser: dashboard, document list, guest list, sidebar with multi-house switcher.

**Guests** are temporary occupants — babysitters, house-sitters, in-laws for the weekend, the friend watching the cat. They never sign up for anything. They scan a QR or tap a link, the iOS app stores a session token, and from then on they get a single screen: chat. The chat answers questions from the household's documents and links back to the source paragraphs. They never see the document list as a *manager* — only as references attached to answers.

A guest is intentionally not a "lite owner." Promoting them to anything more would change the trust model, and the trust model is the core of the product.

## What's in the box (v1)

- **PIN-redeemable invites.** Both owner and guest sessions start as a 6-character Crockford base32 PIN minted by the server and delivered out-of-band — usually a QR code on screen, sometimes a link pasted into whatever messenger the two humans already use.
- **Owner identity = a Person record + JWT.** No email/password, no passkeys. See `decisions-tech.md` §Auth for the redemption flow.
- **Multi-house from one operator.** A Person can own more than one Household (parents who maintain a primary residence and a vacation house; couples who each manage their own household but want shared admin). The iOS app is multi-house from day one — the sidebar switcher is not bolted on.
- **Multi-server from one client.** A single iOS install can hold sessions across multiple servers. A user who's a guest on a friend's server and an owner of their own server doesn't need two apps.
- **Google Drive as a document source.** Owners point Hearthstone at individual Google Docs, the server fetches them, chunks on H1/H2, embeds with `text-embedding-3-small`, and serves them through a RAG pipeline against `gpt-5.4`. Manual upload (DOCX → pandoc → markdown) is supported as an alternative.
- **Source-grounded answers with citations.** Every chat response includes a `sources` event listing the chunks that contributed, and the iOS guest UI links back to the source document for verification. This is non-negotiable: a household-knowledge bot that confidently invents the alarm code is worse than no bot at all.
- **Owner preview mode.** Owners can ask the same RAG questions guests would, against their own household, without consuming a guest seat. Useful for sanity-checking what a guest will see.
- **House deletion.** Both the server operator (via `/admin`) and any owner (via the iOS dashboard) can permanently delete a household and all its data. Deletion is transactional — guests, documents, chunks, embeddings, sessions, and PINs all go in one shot. The iOS client detects 410 Gone and removes the dead session from the sidebar. There is no soft-delete or recovery path; the operator is assumed to mean it.
- **Server-operator admin UI.** A minimal HTML page at `/admin` for creating houses, minting owner invites, and deleting houses. Gated by an in-memory token logged to stdout at server boot — operator reads it via `fly logs`. See `decisions-security.md` for the rationale.

## What's deliberately not in the box

- **No public profiles, no discovery, no sharing across households.** Hearthstone is not a social network. There is no "browse other households," no follow, no public feed. The unit of access is the household, and the only way into a household is a PIN handed to you by an owner.
- **No accounts for guests.** A guest has a name on a `guests` row and a session token, nothing else. They cannot sign up. They cannot recover access if they lose their device — the owner just mints a new PIN.
- **No email/SMS/push delivery.** The server does not send mail. It mints a PIN, returns a `join_url`, and the owner is responsible for getting that URL to the guest by whatever means the two humans normally use. This removed an entire dependency surface (Resend, deliverability, bounce handling) and a class of phishing risks. PIN-over-QR-in-the-room is the primary path.
- **No web app for guests or owners.** The only HTML the server ships is the `/join/:pin` deeplink page (which exists to redirect into the iOS app, nothing more) and the operator-only `/admin` page. There's no PWA, no responsive web client, no plan for one. iOS is the only client surface.
- **No multi-tenant SaaS layer.** Every server is operated by exactly one person, who's also typically the first owner of the first house. Multiple owners can share a server, but there's no billing, no signup page, no usage limits, no "Hearthstone Inc." Anyone who wants Hearthstone forks the repo and runs their own.
- **No model-generated documents.** Hearthstone answers from documents the owner wrote (or had ChatGPT help write — we don't care who typed it). The model is never asked to invent canonical household state. If a question can't be answered from the connected docs, the right behavior is "I don't know — check with the owner," not "here's a plausible-sounding guess."
- **No real-time collaboration.** Documents are imported snapshots. Refresh is manual — the owner taps "refresh" on a document to re-fetch it from Drive. Drive webhooks were considered and deferred (they expire every 7 days and add renewal overhead that's not worth it for the rate of household-doc churn).
- **No fine-grained guest permissions.** All guests of a household see all documents in that household. Per-guest doc filtering is in the deferred list but has no active design.
- **No commercialization plumbing.** No Stripe, no entitlement checks, no feature flags by tier, no "upgrade to pro." The repo is OSS under Apache 2.0 and stays that way.

## Trust model in one paragraph

Hearthstone assumes the people it serves know each other in real life. The owner trusts the guest enough to hand them the PIN; the guest trusts the owner enough to point their phone at the owner's server. The PIN is one-shot and short-lived precisely because the threat being defended against is "the friend forwarded this text and now it's in five group chats," not "an attacker is brute-forcing the redemption endpoint." Defense in depth happens (PIN entropy, JWT expiry, session revocation, admin-token-in-stdout) but the product never asks the operator to perform internet-scale threat modeling, because the deployment isn't internet-scale. Read `decisions-security.md` for the specific guarantees and the open items.

## The operator role

The "operator" is a role the product takes seriously even though it's invisible to most users. An operator is the single human who runs a Hearthstone server. They `fly deploy`. They read `fly logs` to grab the admin token. They mint the first owner PIN through the admin UI. After that they may also be the first owner — frequently they're the same person — but the roles are conceptually distinct.

Decisions that follow from this:

- **Bootstrap is a CLI / admin-page experience, not a UI experience.** Creating a house is not something a user "signs up" for; it's something an operator does on behalf of a user. There is no public registration page anywhere.
- **There is exactly one tier of "operator,"** the one with shell access to the box. The admin token is not a role hierarchy. It's a "are you the person who can also read `fly logs`?" check. Anything more granular would be cosplay.
- **Operator-facing surfaces are deliberately spartan.** The admin HTML page is plain, server-rendered, minimal CSS. It's not part of the design language conversation in `decisions-design.md`. It exists to be functional in two minutes from a fresh deploy.

