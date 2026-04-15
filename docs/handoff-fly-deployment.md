# Handoff: Fly.io Deployment

> **Status: shipped.** This document was the pre-deployment handoff — "here's what we need to build to get Fly working." All six items under *What Needs to Happen* have since been built and are running in production. The live operator guidance is now in `docs/decisions/decisions-tech.md` (deployment table, secrets, admin bootstrap) and `README.md` (the step-by-step for a fresh fork). This file is kept as a historical record of the pre-work thinking; don't treat it as a todo list.

## What This Is

Hearthstone is a household Q&A app — owners connect Google Docs, guests ask questions via chat. The backend is Bun/TypeScript with SQLite + sqlite-vec for vector search. The iOS app is SwiftUI.

The app is functionally complete and runs locally. This handoff is about getting the backend deployed to Fly.io so it can serve real users.

## Current State (as of the original handoff)

- **Backend:** Bun/TypeScript, `bun:sqlite` + `sqlite-vec`, runs on port 3000
- **Database:** Single SQLite file (`hearthstone.db`) with sqlite-vec virtual tables for vector search
- **Auth:** PIN-based (short codes, no email delivery needed)
- **External dependencies:** OpenAI API (embeddings + chat), Google Drive API (doc fetching)

## What Needs to Happen

### 1. Dockerfile

The backend runs under Bun natively (not Node). The Dockerfile needs:
- Bun base image (`oven/bun:1`)
- `bun install` for dependencies
- sqlite-vec native extension must be available (it's installed via npm, the `.so`/`.dylib` ships in `node_modules/sqlite-vec/`)
- On Linux, the system SQLite supports extensions natively — no `setCustomSQLite` needed (see `src/db/setup-sqlite.ts`, it only activates on `darwin`)
- Entry point: `bun run src/index.ts`
- Expose port 3000

### 2. fly.toml

Standard Fly config. Key considerations:
- **Single instance** — SQLite doesn't support concurrent writers across instances
- **Persistent volume** for the SQLite database file. Without this, the DB resets on every deploy.
- **Secrets** for env vars: `OPENAI_API_KEY`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `HEARTHSTONE_PUBLIC_URL`
- `HEARTHSTONE_PUBLIC_URL` must be set to the Fly app's full public URL including scheme (e.g. `https://your-app-name.fly.dev`). Every `join_url` handed out by the server is built from it; the server fails loudly at boot if it's missing or schemeless.

### 3. Volume Setup

```bash
fly volumes create hearthstone_data --size 1 --region [your-region]
```

Mount the volume and point `DATABASE_URL` at the mounted path (e.g. `/data/hearthstone.db`).

### 4. Google OAuth Redirect URI

When deploying, the Google Cloud Console authorized redirect URI must be updated to match the production URL:
```
https://your-app-name.fly.dev/connections/google-drive/callback
```

The `APP_BASE_URL` env var (consumed only by the Google Drive callback constructor in `services/google-auth.ts`) and the redirect URI registered with Google must always match.

### 5. CLI Commands in Production

The household creation CLI (`bun run create-household`) needs to run against the production database. Options:
- `fly ssh console` into the running instance and run it there
- Or build a small admin API endpoint (guarded by a secret) that does the same thing

### 6. iOS Production URL

`ios/Hearthstone/Services/APIClient.swift` has:
```swift
#if DEBUG
private let baseURL = "http://localhost:3000"
#else
private let baseURL = "https://api.hearthstone.app"
#endif
```

The `#else` URL needs to point at the Fly deployment. Update before archiving for TestFlight.

## What NOT to Change

- **Don't migrate to Postgres** yet. SQLite + sqlite-vec works. The spec mentions Postgres as a future option but it's not needed for a single-instance deployment.
- **Don't add multi-instance support.** One Fly machine with a persistent volume is the right architecture for now.
- **Don't touch the auth system.** PIN auth is complete and tested. Email auth is dormant by design.

## Key Files

| File | What It Does |
|------|-------------|
| `backend/src/index.ts` | HTTP server, all routes |
| `backend/src/db/connection.ts` | SQLite connection + sqlite-vec loading |
| `backend/src/db/setup-sqlite.ts` | macOS-only custom SQLite (skipped on Linux) |
| `backend/src/config.ts` | Env var loading, all config |
| `backend/.env.example` | Template for env vars |
| `backend/cli/create-household.ts` | CLI to create households |
| `CLAUDE.md` | Project conventions, API contract rules |
| `README.md` | Setup guide |

## Testing the Deployment

After deploying:
1. `curl https://your-app.fly.dev/` — should return `{"message":"Not found"}` (404, but proves the server runs)
2. `fly ssh console` → `cd /app && bun run create-household` — create a test household
3. Open the iOS app (pointed at the production URL) → enter the owner PIN
4. Connect Google Drive → pick a doc → wait for indexing
5. Create a guest → enter guest PIN on another device → ask a question
