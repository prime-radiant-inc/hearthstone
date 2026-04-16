# Technical Decisions

The current shape of the Hearthstone backend and client — not how we got here, but what's true now. Plans and specs under `docs/superpowers/` are the "where we've been" layer; this file is the "where we are." If something in this file disagrees with the code, the code wins and this file is wrong.

## Stack

- **Backend runtime:** Bun (pinned to `oven/bun:1` in the production image). One process, one long-lived SQLite handle, no separate worker tier.
- **HTTP:** Bun's built-in `Bun.serve` — no Express, Fastify, or Hono. Route dispatch is a hand-rolled `if/else` ladder in `backend/src/index.ts`. It's fine at this scale and keeps the middleware surface very small.
- **Database:** SQLite via `bun:sqlite`, with `sqlite-vec` loaded as a runtime extension for vector search. File path comes from `DATABASE_URL` (`./hearthstone.db` locally, `/data/hearthstone.db` in production on a Fly volume).
- **AI:** OpenAI for both chat (`gpt-5.4`) and embeddings (`text-embedding-3-small`, 1536 dims). Both are behind provider abstractions (`services/chat-provider.ts`, `services/embeddings.ts`) so a second provider can be added without touching callers.
- **iOS client:** SwiftUI, iOS 17+, single target. Networking via `URLSession` (including SSE for chat streaming). Secrets in the Keychain via `KeychainService`. No external dependencies beyond Apple frameworks.
- **Document import:** `pandoc` for DOCX → Markdown conversion, invoked via subprocess. Installed in the Dockerfile via `apt-get install pandoc`.

Things that are deliberately _not_ in the stack: no ORM (raw `prepare().run()`), no auth library (a single `jose` JWT sign/verify), no email sender (owner and guest auth both use in-app PIN redemption, nothing is mailed).

## SQLite setup

`bun:sqlite` is used natively — not `better-sqlite3`. There's one twist that bites on every fresh checkout: **macOS ships a SQLite build that doesn't support runtime extensions**, which breaks `sqlite-vec.load(db)`. `src/db/setup-sqlite.ts` papers over this by pointing `bun:sqlite` at Homebrew's SQLite when `process.platform === "darwin"`:

```ts
Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib");
```

On Linux (including the production image) this is a no-op — the system SQLite supports extensions out of the box. `setup-sqlite.ts` must be imported **before** `Database` is instantiated; `bunfig.toml` preloads it for tests, and `db/connection.ts` imports it at the top of the file.

The connection itself is a module-level singleton in `db/connection.ts`. On first `getDb()` call it:

1. Opens the DB file
2. Loads `sqlite-vec`
3. Runs migrations
4. Creates the `chunk_embeddings` virtual table (`vec0` backend, `float[1536]` column) if missing

Migrations live in `src/db/migrations.ts` and run as a single SQL blob plus a handful of additive `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` patches for columns and tables added after the initial schema. `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` are set on every connection.

## Auth

Owner and guest sessions both start as a six-digit numeric PIN. PINs are minted by three entry points:

| Entry point | Who mints | What the PIN authenticates |
|---|---|---|
| `POST /admin/houses` | Server operator via admin UI | First owner of a new house |
| `POST /admin/houses/:id/owner-invite` | Server operator | Additional owner on an existing house |
| `POST /household/owners` | Logged-in owner | Co-owner invite |
| `POST /guests` / `POST /guests/:id/reinvite` | Logged-in owner | Guest session |

Every mint returns `{ pin, join_url, expires_at }`. The `join_url` is `${HEARTHSTONE_PUBLIC_URL}/join/${pin}` and is the only form the owner needs to share — scanned as a QR code in-app, or pasted into whatever messenger the two humans already use. The server does not send mail.

Redemption is a single endpoint, `POST /auth/pin/redeem`, which returns one of two response shapes based on the PIN's role — owner (`token` is a JWT with `{personId, householdId}` claims, 30-day expiry) or guest (`token` is an `hss_`-prefixed session token persisted in `session_tokens` and revocable). The iOS client dispatches on `result.role` to decide which session to store.

PIN mechanics (see `services/pins.ts`):

- **Format:** six characters drawn from the Crockford base32 alphabet — `0-9A-HJKMNP-TV-Z`, no `I/L/O/U`. ~30 bits of entropy, ~1 billion possible PINs, zero visually ambiguous characters, URL-safe by construction. The generator pulls 6 random bytes from `crypto.randomBytes` and masks each one to the 32-char alphabet with `& 0x1f` — 256 is a multiple of 32, so there's no modulo bias.
- **Normalization:** both `redeemPin()` and `handleJoinPage()` run `normalizePin()` on input — trim + uppercase. Stored PINs are uppercase; the iOS client and the join-page handler accept either case.
- **Uniqueness:** generator loops up to 10 times looking for a PIN not already live in `auth_pins`. At 30 bits of entropy the collision probability is vanishing — the loop is a belt-and-braces guard, not a hot path.
- **TTL:** 7 days.
- **Single-use:** `used_at` is stamped on redemption. Re-use throws `already_used` → `410 Gone`.
- **Errors:** `not_found` → 404, `already_used` / `expired` → 410. The client surfaces these as the `redemptionError` alert in `HearthstoneApp.swift`.

The PIN is not displayed anywhere inside the iOS app — every redemption path is "scan the QR / tap the link," never "type the code." The `/join/:pin` HTML page used to render the PIN as a fallback for manual entry but that block was removed: the fallback has no receiver.

There is no passkey/WebAuthn path, no email/password path, no magic-link path. All three were considered in early planning and explicitly removed. Google OAuth exists, but only as a _document source_ under `/connections/google-drive/*` — it never mints a session.

See `decisions-security.md` for threat model, rate limiting, and the admin token bootstrap.

## Data model

Everything is scoped to `household_id`. The joins are:

```
persons ──┬── household_members ──── households ──── connections (google_drive)
          │                             │
          │                             ├── guests
          │                             ├── documents ──── chunks ──── chunk_embeddings (vec0)
          │                             ├── auth_pins
          │                             └── session_tokens
          │
          └── (owners can belong to multiple households via household_members)
```

The `household_members` join table is load-bearing: a single Person can own multiple Households, and the iOS client knows a session as `(serverURL, householdId, role)`. The `households` table itself has no `owner_id` column — ownership is determined entirely by `household_members` rows with `role = 'owner'`.

`chunks` holds clean section body text and a `heading` breadcrumb (e.g. `"Kids & Family > Bedtime Routines"`). Embedding decorations — document title and breadcrumb prefix — are reconstructed at embed time via `buildEmbeddingText()` and are deliberately **not** stored in `chunks.text`. This means you can re-run embeddings against stored chunks without re-splitting the markdown.

`chunk_embeddings` is a `sqlite-vec` virtual table (`vec0`) keyed by `chunk_id` with a `float[1536]` column. It lives alongside `chunks` as a separate table because `vec0` doesn't support joining to regular tables with filters — more on that below.

## RAG pipeline

### Chunking

`services/chunker.ts` splits markdown into chunks with these rules:

1. **Split on H1 and H2 only.** H3+ are treated as body text. Google Docs exports tend to promote bolded labels to H3 via pandoc, and treating them as heading boundaries fragments the content badly.
2. **Preserve tables.** If a section would exceed the ~500-token soft limit but contains a markdown table, the whole section stays together. Splitting an emergency-contacts table mid-row destroys retrieval quality.
3. **Split large non-table sections on paragraph boundaries**, with the section breadcrumb re-prepended to each sub-chunk.
4. **Merge small chunks** (< 200 chars) into the previous or next chunk, so the embedding space isn't polluted with 30-character fragments that match everything.

Chunk sizes are governed by character counts, not token counts — `CHARS_PER_TOKEN = 4` is the approximation. Good enough given `text-embedding-3-small`'s generous input limit.

### Indexing

`services/indexer.ts` is called from the document connect/upload/refresh handlers. The happy path:

1. Row inserted into `documents` with `status = 'indexing'`.
2. Markdown is passed through `chunkMarkdown()`.
3. Each chunk is decorated via `buildEmbeddingText(chunk, documentTitle)` — title in brackets, breadcrumb with a `>` prefix, then the body. This decoration is deliberately ephemeral.
4. All decorated texts are sent to `embedBatch()` in one OpenAI call.
5. Chunks and embeddings are inserted inside a single `db.transaction()` — either both tables commit or neither does.
6. `documents.status` flips to `'ready'` and `chunk_count` / `last_synced` are set.

Refresh is the same flow with a prelude that deletes the old `chunks` and `chunk_embeddings` rows for the document. There's no staging table — a refresh that fails mid-embed leaves `status = 'error'` and the doc is gone from search until it's fixed. That's acceptable because refreshes are manual and rare.

### Retrieval

`services/search.ts` runs a KNN query against `chunk_embeddings` and then filters by household. There's a sqlite-vec quirk worth knowing:

> sqlite-vec's `MATCH` operator **does not support joining to a regular table with a `WHERE` clause on the joined column inside the same query.** You cannot write `SELECT … FROM chunk_embeddings ce JOIN chunks c ON c.id = ce.chunk_id WHERE embedding MATCH ? AND c.household_id = ? AND k = ?`.

The workaround in `search.ts` is a subquery: the KNN scan runs first on `chunk_embeddings` alone, then the outer query joins to `chunks`/`documents` and filters by `household_id`. This means the KNN returns `k` nearest chunks _globally_, which are then filtered down to the caller's household. At our data scale (handful of households, hundreds of chunks each) the filter rarely empties the result set. If we grow past "small", the fix is to bump `k` and rerank, not to restructure the schema.

### Answering

`services/prompt.ts` builds the system prompt, `services/chat-provider.ts` streams the completion via `gpt-5.4` with `stream: true`, and the handler in `routes/chat.ts` writes an SSE stream to the client. The final event carries a `sources: [...]` payload listing the chunks used, so the iOS client can link back to the source document.

## Observability

Optional OpenTelemetry tracing, exported to any OTLP HTTP backend (Honeycomb is the one we use). It's fully off when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset — `src/tracing.ts` short-circuits to a noop tracer so there's zero overhead and no SDK in the module graph.

The tracing module must be imported first in `src/index.ts` so the provider is registered before anything else runs. One Bun-specific detail: **Bun's `AsyncLocalStorage` does not propagate across `await` boundaries reliably**, so `startActiveSpan` doesn't work. Instead, `startSpan(name, parentCtx?)` accepts an explicit parent context and handlers thread that context through manually. It's uglier than the "auto" API but it actually produces connected traces.

Env vars:

| Var | Purpose |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | e.g. `https://api.honeycomb.io` — presence enables tracing |
| `OTEL_EXPORTER_OTLP_HEADERS` | comma-separated `key=val` pairs (e.g. `x-honeycomb-team=...`) |
| `OTEL_SERVICE_NAME` | Defaults to `hearthstone-backend` |

Honeycomb dataset: `hearthstone-backend`. Useful attributes emitted throughout the codebase: `app.document_id`, `app.household_id`, `app.chunk_count`, `openai.model`.

## Deployment

Fly.io, single app, single region. The repo ships `backend/fly.toml.example` with placeholder values — copy it to `fly.toml` and fill in your app name and region. The real `fly.toml` is gitignored so individual deployments don't leak into forks.

| Setting | Value | Why |
|---|---|---|
| VM | `shared-cpu-1x` / 512 MB | Plenty of headroom for the current load |
| `min_machines_running` | `0` | Auto-suspend when idle — this is a hobby app, not a hot-path service |
| `auto_stop_machines` | `suspend` | Faster resume than `stop` |
| Volume | `hearthstone_data` → `/data` | Persistent SQLite. `DATABASE_URL=/data/hearthstone.db` |
| App name / region | operator's choice | Set in your local `fly.toml`; the example file uses `your-hearthstone-app` / `iad` |

Required runtime secrets (set via `fly secrets set`):

| Secret | Purpose |
|---|---|
| `OPENAI_API_KEY` | Chat + embeddings |
| `JWT_SECRET` | Owner JWT signing key |
| `HEARTHSTONE_PUBLIC_URL` | Full URL with scheme — every `join_url` is built from this. Validated at boot; a missing scheme fails loudly |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Drive OAuth — optional, only if a household uses Drive |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` | Optional tracing |

The Dockerfile is two stages: `oven/bun:1` base, `bun install --frozen-lockfile --production`, then a runtime image that also `apt-get install`s `pandoc` for DOCX conversion. Deploy is `fly deploy` from `backend/`. There is no CI/CD pipeline — deploys are manual.

### The admin token bootstrap

The admin UI is gated by an in-memory token minted on every server start. The token is `console.log`'d to stdout at boot and never emitted through tracing. Operator reads it with `fly logs` and clicks the logged URL. See `decisions-security.md` for the full rationale.

## Multi-house client

The iOS app is built around a `SessionStore` — a Keychain-backed list of `HouseSession`s, each of which is `(id, serverURL, householdId, householdName, role, personName?, addedAt)`. There is no single "current server" — every authenticated call goes through a client bound to the session's `serverURL`. A Bob looking at networking code should expect `baseURL` to vary per request, not be a module-level constant.

Redemption flow in `AppRouter`:

1. User scans a QR code or opens a `hearthstone://` link.
2. `JoinURLParser` extracts `(serverURL, pin)`.
3. If `serverURL.host` is unknown to the store, a full-screen `NewServerPromptView` asks the user to confirm ("You're about to add a new server"). This is an explicit trust boundary — the user is being told they're about to let a new host mint a session.
4. On confirm, `UnauthenticatedClient` posts `pin` to `/auth/pin/redeem`, and the returned session is added to the store and auto-activated.
5. If it's a _known_ host, the same redemption runs but the new session is added **without** switching away from whatever house the user is currently in — so an incoming guest invite can't yank a working owner out of their active session.

Two server-side signals cause the iOS client to remove a session from the store:

- **Guest revocation** — a 401 with `message: "session_expired"` fires `.guestSessionRevoked` on `NotificationCenter`. `AppRouter` removes the session and shows `AccessRevokedView` if the store is now empty.
- **Household deletion** — a 410 Gone from any authenticated request (the `assertHouseholdExists` check that runs on every owner-scoped route, or the same error surfaced through `authenticateOwner` when the JWT's household no longer exists). The iOS client detects 410 and removes the dead session from the store and sidebar.

## Dev tooling

Backend commands (run from `backend/`):

| Command | What it does |
|---|---|
| `bun run dev` | Watch-mode dev server on port 3000 |
| `bun test` | Full test suite (`bun:test`, not vitest) |
| `bun test tests/api-contract.test.ts` | Contract tests only — fast feedback on spec drift |
| `bun run create-household` | One-shot CLI that mints a household + first owner + PIN. For local seeding |
| `bun run owner-pin` | Mints a fresh owner PIN for an existing household |
| `bun run chat:rag` / `chat:full` / `chat:both` | CLI chat against the local DB — RAG-only, full prompt, or side-by-side |
| `bun run eval` / `eval:dry` | Full 39-question eval against the local DB |
| `bun run eval:compare` | Model comparison runner |
| `bun run optimize` | Prompt optimizer harness |
| `bun run reindex` | Re-embed all chunks for all households |

### Eval harness

Lives in `backend/eval/`. See `decisions-eval.md` for the full shape, but the one-liner: 39 key-fact-scored questions against the Castillo-Park sample household (`refdocs/sample/`), RAG baseline currently at ~99%. Variations (prompt, chunker, model) are tracked as snapshots under `backend/eval/results/`.

### API contract

`docs/api-spec.md` is the API contract the contract test asserts against. `backend/tests/api-contract.test.ts` checks that every handler returns exactly the fields the spec declares — no more, no less. Per `CLAUDE.md`: **the spec is the source of truth.** If a handler drifts, fix the handler. If the spec is wrong, update the spec first, then the handler, then the contract test. Fields are snake_case in JSON; iOS maps to camelCase via `CodingKeys`.

## Deferred

| Item | Why deferred |
|---|---|
| Rate limiting on `/auth/pin/redeem` | Scoped in `BACKLOG.md`. PIN entropy (~30 bits) makes the online brute-force surface acceptable for now but not wonderful. A simple in-memory IP-bucket limiter would close the gap; the trigger to build it is either load on the endpoint or moving to a multi-machine deployment. |
| Postgres migration | SQLite on a Fly volume handles the current load. `household_id` scoping means the migration is mechanical when it's needed — no schema rewrites. |
| Drive webhook sync | Manual refresh only. Drive webhooks expire every 7 days and add renewal overhead we don't want yet. |
| CI/CD | `fly deploy` from a laptop is fine at this scale. |
| Per-guest document permissions | Currently all guests of a household see all documents. No active work. |

