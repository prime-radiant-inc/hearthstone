# Product: Hearthstone

- slug: home-knowledge-hub
- repo_url: https://github.com/prime-radiant-inc/hearthstone
- generated_at: 2026-04-03T01:16:04.184Z
- package_version: 1
- implementation_story_count: 9
- context_story_count: 0
- implementation_story_ids: story-001, story-002, story-003, story-004, story-005, story-006, story-007, story-008, story-009
- context_story_ids: none
- selected_sprint: full-backlog

## Hearthstone — API Specification

---
title: Hearthstone — API Specification
---

## Overview

All API endpoints are served from the Bun backend. All requests and responses are JSON unless noted. Guest endpoints require a valid `hss_` session token as a Bearer token in the `Authorization` header. Owner endpoints require a valid owner session (Google OAuth).

Base URL: `https://api.hearthstone.app` (production) / `http://localhost:3000` (local)

---

## Auth

### `POST /auth/google`
Initiate Google OAuth flow. Redirects to Google consent screen requesting Drive read + profile scopes.

**Response:** 302 redirect to Google OAuth

---

### `GET /auth/google/callback`
Google OAuth callback. Creates or retrieves Person + Household records.

**Query params:**
- `code` — OAuth authorization code
- `state` — CSRF state token

**Response:**
```json
{
  "token": "owner_session_token",
  "household": {
    "id": "uuid",
    "name": "The Anderson Home",
    "created_at": "2024-01-01T00:00:00Z"
  },
  "is_new": true
}
```

**Errors:**
- `400` — missing or invalid code/state
- `500` — Google API error

---

### `POST /auth/invite/redeem`
Exchange a single-use `hsi_` invite token for a long-lived `hss_` session token.

**Request:**
```json
{
  "invite_token": "hsi_abc123..."
}
```

**Response:**
```json
{
  "session_token": "hss_xyz789...",
  "guest": {
    "id": "uuid",
    "name": "Maria",
    "household_id": "uuid"
  },
  "household_name": "The Anderson Home"
}
```

**Errors:**
- `410` — token already used (`"message": "This invite has already been used"`)
- `410` — token expired (`"message": "This invite has expired"`)
- `404` — token not found

---

### `POST /auth/pin/redeem`
Exchange a short-lived PIN for a session.

**Request:**
```json
{ "pin": "123456" }
```

**Response (owner role):**
```json
{
  "token": "jwt_here",
  "role": "owner",
  "person": { "id": "uuid", "email": "alice@example.com", "name": "Alice" },
  "household": { "id": "uuid", "name": "The Anderson Home", "created_at": "2024-01-01T00:00:00Z" }
}
```

**Response (guest role):**
```json
{
  "token": "hss_xyz...",
  "role": "guest",
  "guest": { "id": "uuid", "name": "Maria", "household_id": "uuid" },
  "household_name": "The Anderson Home"
}
```

**Errors:** `404` not found · `410` already used · `410` expired

---

## Owner — Household

### `PATCH /household`
Update household name.

**Auth:** Owner session

**Request:**
```json
{
  "name": "The Anderson Home"
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "The Anderson Home",
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

### `POST /guests/:id/reinvite`
Generate a new PIN for an existing guest. For revoked guests, reactivates them to pending.

**Auth:** Owner session

**Response:**
```json
{
  "pin": "123456",
  "join_url": "https://hearthstone-mhat.fly.dev/join/123456",
  "expires_at": "2024-01-08T00:00:00Z"
}
```

**Errors:**
- `404` — guest not found

---

## Owner — Guests

### `GET /guests`
List all guests for the household.

**Auth:** Owner session

**Response:**
```json
{
  "guests": [
    {
      "id": "uuid",
      "name": "Maria",
      "contact": "maria@example.com",
      "contact_type": "email",
      "status": "active",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

Guest `status` values: `pending` | `active` | `revoked`

---

### `POST /guests`
Invite a new guest. Generates `hsi_` token and sends magic link via email or SMS.

**Auth:** Owner session

**Request:**
```json
{
  "name": "Maria",
  "email": "maria@example.com",
  "phone": null
}
```

Either `email` or `phone` must be present. If both provided, email is used for delivery.

**Response:**
```json
{
  "guest": {
    "id": "uuid",
    "name": "Maria",
    "status": "pending"
  },
  "pin": "123456",
  "join_url": "https://hearthstone-mhat.fly.dev/join/123456",
  "expires_at": "2024-01-08T00:00:00Z"
}
```

**Errors:**
- `422` — name missing
- `422` — neither email nor phone provided

---

### `POST /household/owners`
Invite a co-owner to the household. Mints an owner PIN.

**Auth:** Owner session

**Request:**
```json
{
  "name": "Jamie",
  "email": "jamie@example.com"
}
```

**Response:**
```json
{
  "pin": "123456",
  "join_url": "https://hearthstone-mhat.fly.dev/join/123456",
  "expires_at": "2024-01-08T00:00:00Z"
}
```

**Errors:**
- `422` — email missing
- `409` — person is already an owner

---

### `POST /guests/:id/revoke`
Revoke all active session tokens for a guest immediately.

**Auth:** Owner session

**Response:**
```json
{
  "guest_id": "uuid",
  "revoked_at": "2024-01-01T00:00:00Z"
}
```

**Errors:**
- `404` — guest not found
- `409` — guest already revoked

---

### `DELETE /guests/:id`
Remove a guest and all associated tokens. Only valid for revoked guests.

**Auth:** Owner session

**Response:** `204 No Content`

**Errors:**
- `404` — guest not found
- `409` — guest is still active; revoke first

---

## Owner — Documents

### `GET /documents`
List all connected documents for the household.

**Auth:** Owner session

**Response:**
```json
{
  "documents": [
    {
      "id": "uuid",
      "title": "House Operations",
      "drive_file_id": "1BxiM...",
      "status": "ready",
      "chunk_count": 18,
      "last_synced": "2024-01-01T00:00:00Z"
    }
  ]
}
```

Document `status` values: `indexing` | `ready` | `error`

---

### `POST /documents`
Connect a Google Doc by Drive file ID. Triggers async fetch, chunk, and embed.

**Auth:** Owner session

**Request:**
```json
{
  "drive_file_id": "1BxiM...",
  "title": "House Operations"
}
```

**Response:**
```json
{
  "id": "uuid",
  "title": "House Operations",
  "status": "indexing"
}
```

**Errors:**
- `422` — missing drive_file_id
- `502` — Drive API unreachable

---

### `POST /documents/:id/refresh`
Re-fetch, re-chunk, and re-embed a connected document. Replaces existing chunks atomically.

**Auth:** Owner session

**Response:**
```json
{
  "id": "uuid",
  "status": "indexing"
}
```

---

### `DELETE /documents/:id`
Remove a connected document and all its chunks and vectors.

**Auth:** Owner session

**Response:** `204 No Content`

---

### `GET /documents/:id/content`
Return the cached Markdown content of a document. Used by guest source view.

**Auth:** `hss_` Bearer token (guest) or owner session

**Response:**
```json
{
  "id": "uuid",
  "title": "House Operations",
  "markdown": "## Emergency Contacts\n| Name | Phone |\n...",
  "html": "<html>...</html>"
}
```

**Errors:**
- `401` — invalid or revoked session
- `404` — document not found

---

## Guest — Chat

### `POST /chat`
Send a message and receive a streaming AI response.

**Auth:** `hss_` Bearer token

**Request:**
```json
{
  "message": "What's the WiFi password?",
  "history": [
    { "role": "user", "content": "Is there parking nearby?" },
    { "role": "assistant", "content": "Yes, there is street parking on Oak St." }
  ]
}
```

`history` is the full prior conversation, maintained client-side.

**Response:** `text/event-stream` (Server-Sent Events)

```
data: {"delta": "The WiFi"}
data: {"delta": " network is"}
data: {"delta": " Anderson_Home"}
data: {"sources": [{"document_id": "uuid", "title": "House Operations", "chunk_index": 3}]}
data: [DONE]
```

Final `sources` event lists the chunks used to generate the answer.

**Errors:**
- `401` — invalid or revoked `hss_` token → `{"message": "Your session has expired. Please use your invite link again."}`
- `500` — AI provider error → `{"message": "Something went wrong. Please try again."}`

---

### `GET /chat/suggestions`
Return the household's pre-generated suggestion chips.

**Auth:** `hss_` Bearer token

**Response:**
```json
{
  "suggestions": [
    "What's the WiFi password?",
    "Where are the spare keys?",
    "What's the alarm code?",
    "How do I control the thermostat?",
    "Are there any house rules?"
  ]
}
```

Returns empty array if no chips have been generated yet.

---

## Owner — Preview

### `POST /chat/preview`
Same as `POST /chat` but authenticated via owner session instead of `hss_` token. Response is identical. Preview interactions are not persisted.

**Auth:** Owner session

**Request/Response:** identical to `POST /chat`

## Hearthstone — Technical Design

---
title: Hearthstone — Technical Design
---

## Overview

Hearthstone is a mobile iOS app (SwiftUI) that gives guests conversational access to a household's Google Docs. A TypeScript/Bun backend manages auth, fetches and indexes docs, and proxies AI requests. Guests access via magic link which deep-links into the iOS app via Universal Links.

---

## Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| iOS app | SwiftUI | Owner + guest experience |
| Backend | TypeScript on Bun | Fast, native SQLite, no compile step |
| Database | SQLite + sqlite-vec | Migrate to Postgres + pgvector pre-launch |
| Embeddings | OpenAI `text-embedding-3-small` | Swappable via provider abstraction |
| Chat | OpenAI GPT-4o | Swappable via provider abstraction |
| Deployment | Fly.io | Single container, scales to SaaS |

---

## Auth & Identity

### Owner auth
Owner authenticates via Google OAuth (doubles as Google Drive consent). Library choice deferred until stack is finalized.

### Guest auth — two-token pattern

Two token types with distinct prefixes for debuggability:

| Token | Prefix | Lifetime | Use |
|-------|--------|----------|-----|
| Invite token | `hsi_` | 7 days | Single-use, delivered in magic link URL |
| Session token | `hss_` | Until revoked | Stored in iOS Keychain, sent as bearer token |

**Exchange flow:**
1. Owner invites guest → backend generates `hsi_` token
2. Magic link delivered: `hearthstone.app/join/hsi_abc123`
3. Guest taps link → Universal Link opens iOS app → app sends `hsi_` to backend
4. Backend validates + burns `hsi_` → mints `hss_`
5. App stores `hss_` in iOS Keychain
6. Every subsequent request sends `hss_` as bearer token
7. Owner revokes → backend sets `revoked_at` → next request 401s

**Rationale:** Avoids long-lived tokens appearing in email/SMS/server logs. Single-use invite token means interception doesn't grant permanent access.

### Guest token storage
- `hsi_` tokens: stored in DB with `household_id`, `guest_id`, `created_at`, `expires_at`, `used_at`
- `hss_` tokens: stored in DB with `household_id`, `guest_id`, `created_at`, `revoked_at`

---

## Data Model

All records scoped to `household_id` from day one to support future multi-tenant SaaS without migration.

### Core entities

- **Person** — owner account (email, OAuth token)
- **Household** — owned by a Person; has name; scopes all data
- **Guest** — name + contact (email or phone), linked to Household; no password, no Person link in v1
- **InviteToken** (`hsi_`) — single-use invite, expires in 7 days
- **SessionToken** (`hss_`) — long-lived session credential, revocable
- **Document** — connected Google Doc (Drive file ID, title, last synced)
- **Chunk** — text segment of a Document with sqlite-vec embedding

### Chunk schema

```
chunks
------
id
document_id
household_id
chunk_index     -- 0, 1, 2, ... ordering within the doc
text            -- raw text of the chunk
embedding       -- vector (sqlite-vec column)
created_at
```

Each document produces N chunk rows. Refreshing a doc deletes all rows for that `document_id` and re-inserts new chunks atomically.

---

## Google Drive Integration

- **Source of truth:** Google Drive. Docs are never edited in Hearthstone.
- **Owner OAuth:** Owner grants Drive read access during onboarding. Access token stored securely in backend.
- **Doc selection:** Owner picks individual docs (not folders) from a Drive browser UI in the iOS app.
- **Format:** Google Docs exported as Markdown via Drive API. Google's export handles conversion.
- **Indexing:** On connection, backend fetches doc as Markdown, chunks it, embeds chunks, stores in SQLite with sqlite-vec.
- **Sync strategy (v1):** Manual refresh only — owner taps Refresh on a doc. Drive webhooks deferred to v2 (they expire every 7 days and require renewal overhead).

---

## RAG Architecture

### Chunking strategy

Chunk by Markdown section, not by fixed token count. The algorithm:

1. Split the Markdown on heading boundaries (`#`, `##`, `###`)
2. Each section (heading + its content) becomes one chunk
3. If a section exceeds ~500 tokens, split it on paragraph boundaries, prepending the section heading to each sub-chunk so context is preserved
4. Never split mid-table — if a Markdown table would be severed by a token limit, keep the entire table in one chunk even if it exceeds 500 tokens

**Rationale:** Google Docs tend to be well-structured with clear headings. Section-based chunking keeps semantically related content together — an emergency contacts table stays intact under its heading rather than being split across rows. This is especially important for structured content like contact lists, schedules, and code tables.

### Indexing (at doc connection time)
1. Fetch doc as Markdown from Google Drive API
2. Split into chunks using section-based strategy above
3. Embed each chunk via configured embeddings provider
4. Store chunks + vectors in SQLite (sqlite-vec) with `chunk_index` preserving original doc order

### Retrieval (at chat query time)
1. Embed the user's query via configured embeddings provider
2. Vector similarity search against household's chunk store
3. Retrieve top 5 chunks by similarity score
4. Construct prompt: system context + retrieved chunks + conversation history + user query
5. Send to configured chat provider, stream response to iOS client

### Suggestion chips
Generated by LLM at doc-connection time: "given these docs, what are the 5 things a guest is most likely to ask?" Stored with the household. Refreshed when docs are added or manually refreshed.

---

## AI Providers

Both embedding and chat providers are configurable via environment variables. No code changes required to swap providers.

### Abstraction layer
- `embed(text) → vector` — thin interface backed by pluggable implementation
- `chat(messages) → stream` — thin interface backed by pluggable implementation

### Defaults
- **Embeddings:** OpenAI `text-embedding-3-small`
- **Chat:** OpenAI GPT-4o

### Known alternative
Voyage embeddings + Anthropic Claude — supported via env config, no code changes.

---

## Deployment

- **Target:** Fly.io — single container, TypeScript/Bun backend + SQLite file
- **Migration path:** SQLite → Postgres + pgvector when approaching launch; `household_id` scoping means no structural changes needed

## Home Knowledge Hub — Vision

---
title: Home Knowledge Hub — Vision
---

## Purpose

Hearthstone gives guests and caregivers instant, conversational access to a household's institutional knowledge — WiFi passwords, home automation quirks, childcare routines, emergency contacts — without forcing them to navigate a pile of Google Docs on a phone.

The homeowner connects their existing Google Docs once. Guests get a magic link or QR code and can immediately ask questions in plain language and get direct answers, with the option to read the full source document.

## Target Users

**Owners** — Homeowners (or household managers) who maintain documentation about their home and want to share it with temporary guests or recurring caregivers. They manage which docs are connected and who has access.

**Guests** — Babysitters, house-sitters, family members, or anyone temporarily responsible for the home. They need quick answers on a phone, not a document-reading session. They have no account, no password, no profile — just a token delivered via magic link or QR code.

## Core Experience

A guest receives a magic link or scans a QR code. They open a mobile-optimized web app and see a chat interface. They ask "how do I turn on the guest WiFi?" or "what's the bedtime routine?" and get a direct, conversational answer synthesized from the household's docs. If they want more context, they can view the full source document.

## Identity Model

**Person → Houses** — A Person (Owner) has an account and can own one or more Houses.

**House → Guests** — A House has a list of Guests. Each Guest is a name, contact info, and a token. Guests do not have Person accounts. They do not log in — they present a token.

This keeps the guest experience frictionless. If a future version wants to link a Guest token to a Person (e.g., Derek is a guest at Fred's *and* an owner of his own house), that's an optional upgrade — not a v1 requirement.

## What It Is Not

- Not a document editor (Google Docs handles that)
- Not a general-purpose AI assistant (answers are grounded in the household's own documents)
- Not a native app (mobile-optimized PWA)
- Not a complex identity system for guests (token = access, no account required)

## Architecture Principles

- **Lightweight by default** — single small container on Fly.io. Scales only if needed.
- **Multi-tenant ready from day one** — all data scoped to a House, so multi-household support is a product feature, not a rewrite.
- **AI as a gateway** — backend proxies AI requests (OpenAI / Anthropic) and holds API keys. No keys on the client.
- **Google Drive as source of truth** — docs are indexed and cached for search but the canonical version always lives in Drive.

## V1 Scope

- Owner account (single household)
- Google Drive OAuth — owner selects which docs to connect
- Guest management — add guests by name + contact info, send magic link or show QR code, revoke access
- Chat interface — AI answers grounded in connected docs, with source doc links
- Mobile-optimized PWA

## Out of Scope for V1

- Multiple households per owner
- Guest↔Person account linking
- Guest-proposed edits to documents
- Native iOS / Android apps

## Admin

Admin routes are gated by an in-memory token minted on every server start. The token is logged via `console.log` to stdout at boot, never through any tracing exporter. The server operator reads the token from `fly logs` (or equivalent).

### `GET /join/:pin`
Public HTML landing page. Returns an HTML document that redirects to `hearthstone://join?server=<url>&pin=<pin>` via meta-refresh, JavaScript, and a visible **Open in Hearthstone** button.

**Auth:** none

**Response:** `200 text/html`

### `POST /admin/auth?t=<token>`
Exchanges the token query param for a `hadm` cookie, then redirects to `/admin`. Cookie is `httponly`, `secure`, `samesite=strict`, browser-session lifetime.

**Response:** `302` to `/admin` with `Set-Cookie: hadm=<token>`

### `GET /admin`
Server-rendered admin HTML page.

**Auth:** `Cookie: hadm=<token>` or `Authorization: Bearer hadm_<token>`

**Response:** `200 text/html`

### `GET /admin/houses`
JSON list of houses with counts.

**Auth:** admin

**Response:**
```json
{
  "houses": [
    {
      "id": "uuid",
      "name": "The Anderson Home",
      "created_at": "2024-01-01T00:00:00Z",
      "owner_count": 2,
      "guest_count": 5,
      "document_count": 12
    }
  ]
}
```

### `POST /admin/houses`
Create a house and mint the first owner PIN.

**Auth:** admin

**Request:**
```json
{ "name": "The Anderson Home" }
```

**Response:**
```json
{
  "house": { "id": "uuid", "name": "The Anderson Home", "created_at": "2024-01-01T00:00:00Z" },
  "pin": "123456",
  "join_url": "https://hearthstone-mhat.fly.dev/join/123456"
}
```

### `GET /admin/info`
Server diagnostics.

**Auth:** admin

**Response:**
```json
{
  "public_url": "https://hearthstone-mhat.fly.dev",
  "db_file_size_bytes": 123456,
  "version": "0.2.0"
}
```
- On-device AI inference