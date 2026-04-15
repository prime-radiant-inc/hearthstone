# Hearthstone

Household knowledge hub — owners connect Google Docs, guests ask questions via chat.

## Architecture

- **Backend:** TypeScript on Bun (bun:sqlite + sqlite-vec), `backend/`
- **iOS:** SwiftUI (iOS 17+), `ios/Hearthstone/`
- **AI:** OpenAI (GPT-5.4 chat, text-embedding-3-small embeddings)

## Commands

```bash
# Backend
cd backend && bun run dev          # Start dev server (port 3000)
cd backend && bun test             # Run all tests
cd backend && bun test tests/api-contract.test.ts  # Contract tests only

# iOS
cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build
```

## API Contract

**The API spec at `docs/api-spec.md` is the contract between backend and iOS.** Both sides conform to it independently.

### Rules

1. **Spec is the source of truth.** If the backend returns a shape that doesn't match the spec, the backend is wrong. If iOS expects a shape that doesn't match the spec, iOS is wrong.
2. **Update the spec first.** Before changing any endpoint's request or response shape, update `docs/api-spec.md`. Then update the backend, then iOS.
3. **Contract tests enforce the spec.** `tests/api-contract.test.ts` asserts that every endpoint's response body has exactly the fields the spec defines — no more, no less. If you change a response shape without updating the contract test, the test will fail.
4. **Field names are snake_case in JSON.** The API speaks snake_case. iOS models use CodingKeys to map to camelCase. Do not return camelCase from the backend.
5. **Do not add fields to responses without adding them to the spec and contract test.** Silent extra fields become silent dependencies.

### Adding or changing an endpoint

1. Update `docs/api-spec.md` with the new request/response shape
2. Update or add the backend handler
3. Add or update the contract test in `tests/api-contract.test.ts`
4. Update the iOS APIClient and models
5. Run `bun test tests/api-contract.test.ts` to verify

## SQLite

- Uses `bun:sqlite` natively (not better-sqlite3)
- On macOS, `src/db/setup-sqlite.ts` loads Homebrew's SQLite for extension support
- `sqlite-vec` provides vector search (KNN via MATCH)
- All data scoped to `household_id` for multi-tenancy

## Chunks

- `chunks.text` stores **clean** body text only
- `chunks.heading` stores the section breadcrumb (e.g. "Kids > Bedtime")
- Embedding decorations (`[Title]`, `> Breadcrumb`) are constructed at embed time via `buildEmbeddingText()` — never stored
