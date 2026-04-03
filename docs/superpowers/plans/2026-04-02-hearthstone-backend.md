# Hearthstone Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Hearthstone REST API — a TypeScript/Bun backend that handles owner auth (Google OAuth), guest auth (two-token pattern), Google Drive doc indexing with section-based chunking, vector search via sqlite-vec, and streaming AI chat via SSE.

**Architecture:** Bun HTTP server with route handlers organized by domain (auth, guests, documents, chat). SQLite for relational data, sqlite-vec for vector similarity search. Provider-abstracted `embed()` and `chat()` functions default to OpenAI. All data scoped to `household_id` for multi-tenant readiness.

**Tech Stack:** TypeScript, Bun, SQLite (via `bun:sqlite`), sqlite-vec, OpenAI API (text-embedding-3-small, GPT-4o), Google OAuth + Drive API, Resend (email delivery)

**Spec note:** The design doc specifies section-based Markdown chunking (split on headings, never mid-table). Story-004 mentions "500 tokens with 50-token overlap" which contradicts this. This plan follows the design doc's section-based strategy as authoritative.

---

## File Structure

```
backend/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts                    — HTTP server, route dispatch
│   ├── config.ts                   — env var loading + validation
│   ├── db/
│   │   ├── connection.ts           — SQLite connection + sqlite-vec init
│   │   ├── schema.ts               — table creation DDL
│   │   └── migrations.ts           — run schema on startup
│   ├── middleware/
│   │   ├── owner-auth.ts           — validate owner JWT, attach household_id
│   │   └── guest-auth.ts           — validate hss_ bearer token, attach guest + household_id
│   ├── routes/
│   │   ├── auth.ts                 — POST /auth/google, GET /auth/google/callback, POST /auth/invite/redeem
│   │   ├── household.ts            — PATCH /household
│   │   ├── guests.ts               — GET/POST /guests, POST /guests/:id/revoke, DELETE /guests/:id
│   │   ├── documents.ts            — GET/POST /documents, POST /documents/:id/refresh, DELETE /documents/:id, GET /documents/:id/content
│   │   └── chat.ts                 — POST /chat, GET /chat/suggestions, POST /chat/preview
│   └── services/
│       ├── tokens.ts               — generate hsi_/hss_ tokens, validate, burn
│       ├── google-auth.ts          — OAuth URL generation, code exchange, token refresh
│       ├── google-drive.ts         — fetch doc as Markdown, list docs
│       ├── chunker.ts              — section-based Markdown chunking
│       ├── embeddings.ts           — embed() provider abstraction
│       ├── chat-provider.ts        — chat() provider abstraction, streaming
│       ├── indexer.ts              — orchestrates fetch → chunk → embed → store
│       ├── search.ts               — vector similarity search against household chunks
│       └── suggestions.ts          — generate suggestion chips via LLM
├── tests/
│   ├── helpers.ts                  — test DB setup, fixtures, request helpers
│   ├── db/
│   │   └── schema.test.ts
│   ├── services/
│   │   ├── tokens.test.ts
│   │   ├── chunker.test.ts
│   │   ├── indexer.test.ts
│   │   └── search.test.ts
│   ├── middleware/
│   │   ├── owner-auth.test.ts
│   │   └── guest-auth.test.ts
│   └── routes/
│       ├── auth.test.ts
│       ├── household.test.ts
│       ├── guests.test.ts
│       ├── documents.test.ts
│       └── chat.test.ts
```

---

## Task 1: Project Scaffold + Config

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/.env.example`
- Create: `backend/src/config.ts`
- Create: `backend/tests/helpers.ts`

- [ ] **Step 1: Initialize project**

```bash
cd backend
bun init -y
```

- [ ] **Step 2: Install dependencies**

```bash
bun add better-sqlite3 sqlite-vec openai google-auth-library googleapis resend jose
bun add -d @types/better-sqlite3 bun-types
```

Note: We use `better-sqlite3` + `sqlite-vec` rather than `bun:sqlite` because sqlite-vec requires loading a native extension, which `better-sqlite3` supports reliably via `.loadExtension()`.

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Write .env.example**

```
DATABASE_URL=./hearthstone.db
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OPENAI_API_KEY=
EMBEDDING_PROVIDER=openai
CHAT_PROVIDER=openai
RESEND_API_KEY=
JWT_SECRET=change-me-in-production
APP_BASE_URL=https://hearthstone.app
```

- [ ] **Step 5: Write config.ts**

```typescript
// src/config.ts

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  databaseUrl: optional("DATABASE_URL", "./hearthstone.db"),
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  openaiApiKey: required("OPENAI_API_KEY"),
  embeddingProvider: optional("EMBEDDING_PROVIDER", "openai"),
  chatProvider: optional("CHAT_PROVIDER", "openai"),
  resendApiKey: required("RESEND_API_KEY"),
  jwtSecret: required("JWT_SECRET"),
  appBaseUrl: optional("APP_BASE_URL", "https://hearthstone.app"),
  port: parseInt(optional("PORT", "3000"), 10),
};
```

- [ ] **Step 6: Write test helpers**

```typescript
// tests/helpers.ts
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations";

export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  // sqlite-vec not loaded for unit tests that don't need vectors
  runMigrations(db);
  return db;
}

export function createTestDbWithVec(): Database.Database {
  const db = new Database(":memory:");
  db.loadExtension("vec0");
  runMigrations(db);
  return db;
}

export function makeOwnerJwt(personId: string, householdId: string): string {
  // Minimal JWT for tests — will be implemented alongside auth
  return `test_owner_${personId}_${householdId}`;
}
```

- [ ] **Step 7: Update package.json scripts**

Add to `package.json`:
```json
{
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "test": "bun test"
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat(backend): project scaffold with config and test helpers"
```

---

## Task 2: Database Schema + Migrations

**Files:**
- Create: `backend/src/db/connection.ts`
- Create: `backend/src/db/schema.ts`
- Create: `backend/src/db/migrations.ts`
- Create: `backend/tests/db/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/schema.test.ts
import { describe, it, expect } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";

describe("database schema", () => {
  it("creates all required tables", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain("persons");
    expect(tables).toContain("households");
    expect(tables).toContain("guests");
    expect(tables).toContain("invite_tokens");
    expect(tables).toContain("session_tokens");
    expect(tables).toContain("documents");
    expect(tables).toContain("chunks");
  });

  it("enforces household_id foreign key on guests", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    expect(() => {
      db.prepare(
        "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("g1", "nonexistent", "Test", "test@test.com", "email", "pending", new Date().toISOString());
    }).toThrow();
  });

  it("scopes documents to household_id", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    // Insert person + household first
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh_tok", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );

    // Insert doc scoped to household
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d1", "h1", "drive123", "Test Doc", "# Hello", "ready", new Date().toISOString());

    const doc = db.prepare("SELECT * FROM documents WHERE household_id = ?").get("h1") as any;
    expect(doc.title).toBe("Test Doc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test tests/db/schema.test.ts
```

Expected: FAIL — `migrations` module doesn't exist yet.

- [ ] **Step 3: Write schema.ts**

```typescript
// src/db/schema.ts

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    google_refresh_token TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES persons(id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guests (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    contact_type TEXT NOT NULL CHECK(contact_type IN ('email', 'phone')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'revoked')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invite_tokens (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id),
    guest_id TEXT NOT NULL REFERENCES guests(id),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_tokens (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id),
    guest_id TEXT NOT NULL REFERENCES guests(id),
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    drive_file_id TEXT NOT NULL,
    title TEXT NOT NULL,
    markdown TEXT,
    status TEXT NOT NULL DEFAULT 'indexing' CHECK(status IN ('indexing', 'ready', 'error')),
    chunk_count INTEGER DEFAULT 0,
    last_synced TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id),
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    household_id TEXT UNIQUE NOT NULL REFERENCES households(id),
    chips TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;
```

Note: The `chunks` table stores text + index. Vector embeddings are stored in a separate sqlite-vec virtual table (created in connection.ts when vec extension is available) that references `chunks.id`.

- [ ] **Step 4: Write migrations.ts**

```typescript
// src/db/migrations.ts
import type Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";

export function runMigrations(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
}
```

- [ ] **Step 5: Write connection.ts**

```typescript
// src/db/connection.ts
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "./migrations";
import { config } from "../config";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.databaseUrl);
    sqliteVec.load(db);
    runMigrations(db);
    // Create the vector table for chunk embeddings
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[1536]
      );
    `);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

- [ ] **Step 6: Run tests**

```bash
cd backend && bun test tests/db/schema.test.ts
```

Expected: PASS — all three tests green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/ backend/tests/db/
git commit -m "feat(backend): database schema with all core tables"
```

---

## Task 3: Token Service (hsi_ / hss_)

**Files:**
- Create: `backend/src/services/tokens.ts`
- Create: `backend/tests/services/tokens.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/services/tokens.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import {
  generateInviteToken,
  redeemInviteToken,
  validateSessionToken,
  revokeGuestTokens,
} from "../../src/services/tokens";

function seedHousehold(db: Database.Database) {
  db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
    "p1", "owner@test.com", "refresh", new Date().toISOString()
  );
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    "h1", "p1", "Test Home", new Date().toISOString()
  );
  db.prepare(
    "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("g1", "h1", "Maria", "maria@test.com", "email", "pending", new Date().toISOString());
}

describe("token service", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    seedHousehold(db);
  });

  describe("generateInviteToken", () => {
    it("creates an hsi_ prefixed token with 7-day expiry", () => {
      const result = generateInviteToken(db, "h1", "g1");
      expect(result.token).toMatch(/^hsi_/);
      const row = db.prepare("SELECT * FROM invite_tokens WHERE token = ?").get(result.token) as any;
      expect(row).toBeTruthy();
      expect(row.guest_id).toBe("g1");
      const expiry = new Date(row.expires_at);
      const now = new Date();
      const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThan(7.1);
    });
  });

  describe("redeemInviteToken", () => {
    it("exchanges valid hsi_ for hss_ and marks used", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      const session = redeemInviteToken(db, invite.token);
      expect(session.token).toMatch(/^hss_/);
      expect(session.guestId).toBe("g1");
      expect(session.householdId).toBe("h1");

      // Verify invite is marked used
      const row = db.prepare("SELECT used_at FROM invite_tokens WHERE token = ?").get(invite.token) as any;
      expect(row.used_at).toBeTruthy();

      // Verify guest status updated to active
      const guest = db.prepare("SELECT status FROM guests WHERE id = ?").get("g1") as any;
      expect(guest.status).toBe("active");
    });

    it("rejects already-used token with 'already_used' error", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      redeemInviteToken(db, invite.token);
      expect(() => redeemInviteToken(db, invite.token)).toThrow("already_used");
    });

    it("rejects expired token with 'expired' error", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      // Manually backdate expiry
      db.prepare("UPDATE invite_tokens SET expires_at = ? WHERE token = ?").run(
        new Date(Date.now() - 1000).toISOString(),
        invite.token
      );
      expect(() => redeemInviteToken(db, invite.token)).toThrow("expired");
    });

    it("rejects unknown token with 'not_found' error", () => {
      expect(() => redeemInviteToken(db, "hsi_nonexistent")).toThrow("not_found");
    });
  });

  describe("validateSessionToken", () => {
    it("returns guest and household for valid hss_ token", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      const session = redeemInviteToken(db, invite.token);
      const result = validateSessionToken(db, session.token);
      expect(result.guestId).toBe("g1");
      expect(result.householdId).toBe("h1");
    });

    it("returns null for revoked token", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      const session = redeemInviteToken(db, invite.token);
      revokeGuestTokens(db, "g1");
      const result = validateSessionToken(db, session.token);
      expect(result).toBeNull();
    });
  });

  describe("revokeGuestTokens", () => {
    it("sets revoked_at on all session tokens and updates guest status", () => {
      const invite = generateInviteToken(db, "h1", "g1");
      redeemInviteToken(db, invite.token);
      const revokedAt = revokeGuestTokens(db, "g1");
      expect(revokedAt).toBeTruthy();

      const guest = db.prepare("SELECT status FROM guests WHERE id = ?").get("g1") as any;
      expect(guest.status).toBe("revoked");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test tests/services/tokens.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement tokens.ts**

```typescript
// src/services/tokens.ts
import type Database from "better-sqlite3";
import { randomBytes } from "crypto";

function generateToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export function generateInviteToken(
  db: Database.Database,
  householdId: string,
  guestId: string
): { token: string; expiresAt: string } {
  const token = generateToken("hsi_");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  db.prepare(
    "INSERT INTO invite_tokens (id, token, household_id, guest_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(generateId(), token, householdId, guestId, expiresAt.toISOString(), now.toISOString());

  return { token, expiresAt: expiresAt.toISOString() };
}

export function redeemInviteToken(
  db: Database.Database,
  token: string
): { token: string; guestId: string; householdId: string } {
  const row = db.prepare("SELECT * FROM invite_tokens WHERE token = ?").get(token) as any;

  if (!row) throw new Error("not_found");
  if (row.used_at) throw new Error("already_used");
  if (new Date(row.expires_at) < new Date()) throw new Error("expired");

  const now = new Date().toISOString();

  // Mark invite as used
  db.prepare("UPDATE invite_tokens SET used_at = ? WHERE id = ?").run(now, row.id);

  // Create session token
  const sessionToken = generateToken("hss_");
  db.prepare(
    "INSERT INTO session_tokens (id, token, household_id, guest_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(generateId(), sessionToken, row.household_id, row.guest_id, now);

  // Update guest status to active
  db.prepare("UPDATE guests SET status = 'active' WHERE id = ?").run(row.guest_id);

  return { token: sessionToken, guestId: row.guest_id, householdId: row.household_id };
}

export function validateSessionToken(
  db: Database.Database,
  token: string
): { guestId: string; householdId: string } | null {
  const row = db
    .prepare("SELECT * FROM session_tokens WHERE token = ? AND revoked_at IS NULL")
    .get(token) as any;

  if (!row) return null;
  return { guestId: row.guest_id, householdId: row.household_id };
}

export function revokeGuestTokens(db: Database.Database, guestId: string): string {
  const now = new Date().toISOString();
  db.prepare("UPDATE session_tokens SET revoked_at = ? WHERE guest_id = ? AND revoked_at IS NULL").run(now, guestId);
  db.prepare("UPDATE guests SET status = 'revoked' WHERE id = ?").run(guestId);
  // Also expire any unused invite tokens
  db.prepare("UPDATE invite_tokens SET used_at = ? WHERE guest_id = ? AND used_at IS NULL").run(now, guestId);
  return now;
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test tests/services/tokens.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tokens.ts backend/tests/services/tokens.test.ts
git commit -m "feat(backend): token service — hsi_ invite + hss_ session generation and validation"
```

---

## Task 4: Markdown Chunker

**Files:**
- Create: `backend/src/services/chunker.ts`
- Create: `backend/tests/services/chunker.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/services/chunker.test.ts
import { describe, it, expect } from "bun:test";
import { chunkMarkdown } from "../../src/services/chunker";

describe("chunkMarkdown", () => {
  it("splits on heading boundaries", () => {
    const md = `# Welcome\nIntro text.\n\n## WiFi\nPassword is abc123.\n\n## Parking\nStreet parking only.`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain("# Welcome");
    expect(chunks[1]).toContain("## WiFi");
    expect(chunks[2]).toContain("## Parking");
  });

  it("keeps table intact even if section is large", () => {
    const tableRows = Array.from({ length: 50 }, (_, i) => `| Contact ${i} | 555-000${i} |`).join("\n");
    const md = `## Emergency Contacts\n| Name | Phone |\n|------|-------|\n${tableRows}`;
    const chunks = chunkMarkdown(md);
    // Should be one chunk — never split mid-table
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("Contact 49");
  });

  it("splits large sections on paragraph boundaries with heading prepended", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}. ${"Word ".repeat(40)}`
    ).join("\n\n");
    const md = `## Big Section\n\n${paragraphs}`;
    const chunks = chunkMarkdown(md);
    expect(chunks.length).toBeGreaterThan(1);
    // Each sub-chunk should start with the heading
    for (const chunk of chunks) {
      expect(chunk).toMatch(/^## Big Section/);
    }
  });

  it("handles doc with no headings as single chunk", () => {
    const md = "Just some plain text without any headings.";
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(md);
  });

  it("handles empty document", () => {
    const chunks = chunkMarkdown("");
    expect(chunks).toHaveLength(0);
  });

  it("preserves heading hierarchy", () => {
    const md = `# Top\nIntro.\n## Sub A\nContent A.\n### Sub Sub\nDeep content.\n## Sub B\nContent B.`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test tests/services/chunker.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement chunker.ts**

```typescript
// src/services/chunker.ts

const MAX_TOKENS_APPROX = 500;
// Rough token estimate: ~4 chars per token
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = MAX_TOKENS_APPROX * CHARS_PER_TOKEN;

/**
 * Splits Markdown by heading boundaries (any level: #, ##, ###, etc.).
 * Large sections are split on paragraph boundaries with the heading prepended.
 * Tables are never split mid-row.
 */
export function chunkMarkdown(markdown: string): string[] {
  if (!markdown.trim()) return [];

  const sections = splitOnHeadings(markdown);
  const chunks: string[] = [];

  for (const section of sections) {
    if (estimateChars(section) <= MAX_CHARS) {
      chunks.push(section);
    } else {
      chunks.push(...splitLargeSection(section));
    }
  }

  return chunks;
}

function splitOnHeadings(markdown: string): string[] {
  // Split on lines that start with one or more # followed by a space
  const lines = markdown.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      const text = current.join("\n").trim();
      if (text) sections.push(text);
      current = [line];
    } else {
      current.push(line);
    }
  }

  const text = current.join("\n").trim();
  if (text) sections.push(text);

  return sections;
}

function splitLargeSection(section: string): string[] {
  const lines = section.split("\n");
  const headingMatch = lines[0].match(/^#{1,6}\s.*/);
  const heading = headingMatch ? lines[0] : "";
  const body = heading ? lines.slice(1).join("\n").trim() : section;

  // Don't split if section contains a table — keep it intact
  if (containsTable(body)) {
    return [section];
  }

  // Split on double newlines (paragraph boundaries)
  const paragraphs = body.split(/\n\n+/).filter((p) => p.trim());
  const chunks: string[] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const para of paragraphs) {
    const paraChars = estimateChars(para);

    if (currentChars + paraChars > MAX_CHARS && current.length > 0) {
      const chunkBody = current.join("\n\n");
      chunks.push(heading ? `${heading}\n\n${chunkBody}` : chunkBody);
      current = [para];
      currentChars = paraChars;
    } else {
      current.push(para);
      currentChars += paraChars;
    }
  }

  if (current.length > 0) {
    const chunkBody = current.join("\n\n");
    chunks.push(heading ? `${heading}\n\n${chunkBody}` : chunkBody);
  }

  return chunks;
}

function containsTable(text: string): boolean {
  // Markdown tables have rows like | cell | cell | and a separator like |---|---|
  return /\|.+\|/.test(text) && /\|[-:]+\|/.test(text);
}

function estimateChars(text: string): number {
  return text.length;
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test tests/services/chunker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chunker.ts backend/tests/services/chunker.test.ts
git commit -m "feat(backend): section-based Markdown chunker — heading splits, table preservation"
```

---

## Task 5: Embedding + Chat Provider Abstractions

**Files:**
- Create: `backend/src/services/embeddings.ts`
- Create: `backend/src/services/chat-provider.ts`

- [ ] **Step 1: Write embeddings.ts**

```typescript
// src/services/embeddings.ts
import OpenAI from "openai";
import { config } from "../config";

export async function embed(text: string): Promise<number[]> {
  if (config.embeddingProvider === "openai") {
    return embedOpenAI(text);
  }
  throw new Error(`Unknown embedding provider: ${config.embeddingProvider}`);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (config.embeddingProvider === "openai") {
    return embedBatchOpenAI(texts);
  }
  throw new Error(`Unknown embedding provider: ${config.embeddingProvider}`);
}

async function embedOpenAI(text: string): Promise<number[]> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

async function embedBatchOpenAI(texts: string[]): Promise<number[][]> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
```

- [ ] **Step 2: Write chat-provider.ts**

```typescript
// src/services/chat-provider.ts
import OpenAI from "openai";
import { config } from "../config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function* chat(messages: ChatMessage[]): AsyncGenerator<string> {
  if (config.chatProvider === "openai") {
    yield* chatOpenAI(messages);
    return;
  }
  throw new Error(`Unknown chat provider: ${config.chatProvider}`);
}

async function* chatOpenAI(messages: ChatMessage[]): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

export async function chatComplete(messages: ChatMessage[]): Promise<string> {
  if (config.chatProvider === "openai") {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages,
    });
    return response.choices[0]?.message?.content || "";
  }
  throw new Error(`Unknown chat provider: ${config.chatProvider}`);
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/embeddings.ts backend/src/services/chat-provider.ts
git commit -m "feat(backend): provider-abstracted embed() and chat() — default OpenAI"
```

---

## Task 6: Vector Search Service

**Files:**
- Create: `backend/src/services/search.ts`
- Create: `backend/tests/services/search.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/services/search.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { searchChunks } from "../../src/services/search";

function seedWithChunks(db: Database.Database) {
  db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
    "p1", "owner@test.com", "refresh", new Date().toISOString()
  );
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    "h1", "p1", "Test Home", new Date().toISOString()
  );
  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("d1", "h1", "drive1", "House Doc", "# Full doc", "ready", new Date().toISOString());

  // Insert chunks with fake embeddings (1536-dim, mostly zeros with one distinguishing value)
  for (let i = 0; i < 10; i++) {
    const embedding = new Float32Array(1536);
    embedding[i] = 1.0; // Each chunk has a different dimension set to 1
    db.prepare("INSERT INTO chunks (id, document_id, household_id, chunk_index, text, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      `c${i}`, "d1", "h1", i, `Chunk ${i} content about topic ${i}`, new Date().toISOString()
    );
    db.prepare("INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)").run(
      `c${i}`, Buffer.from(embedding.buffer)
    );
  }
}

describe("searchChunks", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[1536]
      );
    `);
    seedWithChunks(db);
  });

  it("returns top K chunks for a household sorted by similarity", () => {
    // Query embedding: set dimension 3 to 1.0 — should match chunk 3
    const queryEmbedding = new Float32Array(1536);
    queryEmbedding[3] = 1.0;

    const results = searchChunks(db, "h1", queryEmbedding, 5);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results[0].chunkId).toBe("c3");
    expect(results[0].text).toContain("Chunk 3");
    expect(results[0].documentId).toBe("d1");
    expect(results[0].documentTitle).toBe("House Doc");
  });

  it("only returns chunks from the specified household", () => {
    // Add a chunk for a different household
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p2", "other@test.com", "refresh2", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h2", "p2", "Other Home", new Date().toISOString()
    );
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d2", "h2", "drive2", "Other Doc", "# Other", "ready", new Date().toISOString());

    const embedding = new Float32Array(1536);
    embedding[3] = 1.0;
    db.prepare("INSERT INTO chunks (id, document_id, household_id, chunk_index, text, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "other_c", "d2", "h2", 0, "Other household chunk", new Date().toISOString()
    );
    db.prepare("INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)").run(
      "other_c", Buffer.from(embedding.buffer)
    );

    const queryEmbedding = new Float32Array(1536);
    queryEmbedding[3] = 1.0;

    const results = searchChunks(db, "h1", queryEmbedding, 5);
    const householdIds = results.map((r) => r.householdId);
    expect(householdIds.every((id) => id === "h1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test tests/services/search.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement search.ts**

```typescript
// src/services/search.ts
import type Database from "better-sqlite3";

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  text: string;
  householdId: string;
  distance: number;
}

export function searchChunks(
  db: Database.Database,
  householdId: string,
  queryEmbedding: Float32Array,
  limit: number = 5
): SearchResult[] {
  // sqlite-vec KNN query, then filter by household + join for metadata
  const rows = db
    .prepare(
      `
      SELECT
        ce.chunk_id,
        ce.distance,
        c.document_id,
        c.household_id,
        c.chunk_index,
        c.text,
        d.title AS document_title
      FROM chunk_embeddings ce
      JOIN chunks c ON c.id = ce.chunk_id
      JOIN documents d ON d.id = c.document_id
      WHERE c.household_id = ?
        AND ce.embedding MATCH ?
        AND k = ?
      ORDER BY ce.distance
      `
    )
    .all(householdId, Buffer.from(queryEmbedding.buffer), limit) as any[];

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    chunkIndex: r.chunk_index,
    text: r.text,
    householdId: r.household_id,
    distance: r.distance,
  }));
}
```

Note: The sqlite-vec `MATCH` + `k = ?` syntax is specific to sqlite-vec virtual tables. If this exact query syntax doesn't work at runtime, the alternative is to query `chunk_embeddings` with KNN first, then join. Adjust during implementation if needed.

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test tests/services/search.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/search.ts backend/tests/services/search.test.ts
git commit -m "feat(backend): vector similarity search scoped to household"
```

---

## Task 7: Google Auth + Drive Services

**Files:**
- Create: `backend/src/services/google-auth.ts`
- Create: `backend/src/services/google-drive.ts`

- [ ] **Step 1: Write google-auth.ts**

```typescript
// src/services/google-auth.ts
import { OAuth2Client } from "google-auth-library";
import { config } from "../config";

const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive.readonly",
];

function getClient(): OAuth2Client {
  return new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret,
    `${config.appBaseUrl}/auth/google/callback`
  );
}

export function getAuthUrl(state: string): string {
  const client = getClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    state,
    prompt: "consent",
  });
}

export async function exchangeCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  email: string;
  name: string;
}> {
  const client = getClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Get user info
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = (await res.json()) as { email: string; name: string };

  return {
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token!,
    email: userInfo.email,
    name: userInfo.name,
  };
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const client = getClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials.access_token!;
}
```

- [ ] **Step 2: Write google-drive.ts**

```typescript
// src/services/google-drive.ts
import { getAccessToken } from "./google-auth";

export async function fetchDocAsMarkdown(
  refreshToken: string,
  driveFileId: string
): Promise<{ title: string; markdown: string }> {
  const accessToken = await getAccessToken(refreshToken);

  // Get file metadata
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) throw new Error(`Drive API error: ${metaRes.status}`);
  const meta = (await metaRes.json()) as { name: string };

  // Export as plain text (Google Docs don't support direct Markdown export;
  // we export as plain text which preserves structure better than HTML for our use)
  const exportRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!exportRes.ok) throw new Error(`Drive export error: ${exportRes.status}`);
  const markdown = await exportRes.text();

  return { title: meta.name, markdown };
}
```

Note: Google Drive doesn't natively export to Markdown. The spec says "Google's export handles conversion." In practice we export as plain text. If the content needs better Markdown fidelity, we could export as HTML and convert — but for v1, plain text preserves most structural information. Adjust mimeType if needed during integration testing.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/google-auth.ts backend/src/services/google-drive.ts
git commit -m "feat(backend): Google OAuth + Drive services — auth URL, code exchange, doc fetch"
```

---

## Task 8: Indexer + Suggestions Services

**Files:**
- Create: `backend/src/services/indexer.ts`
- Create: `backend/src/services/suggestions.ts`
- Create: `backend/tests/services/indexer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/services/indexer.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../../src/db/migrations";
import { indexDocument, refreshDocument } from "../../src/services/indexer";

// Mock the external services
const mockEmbeddings: number[][] = [];
const mockFetchResult = { title: "Test Doc", markdown: "## Section 1\nContent here.\n\n## Section 2\nMore content." };

// We'll test the core indexing logic with pre-fetched content
describe("indexer", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    sqliteVec.load(db);
    runMigrations(db);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[1536]
      );
    `);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh_tok", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
  });

  it("stores chunks and embeddings for a new document", async () => {
    const fakeEmbed = async (texts: string[]) =>
      texts.map(() => Array.from({ length: 1536 }, () => Math.random()));

    await indexDocument(db, {
      documentId: "d1",
      householdId: "h1",
      driveFileId: "drive1",
      title: "Test Doc",
      markdown: "## Section 1\nContent here.\n\n## Section 2\nMore content.",
      embedBatch: fakeEmbed,
    });

    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get("d1") as any;
    expect(doc.status).toBe("ready");
    expect(doc.chunk_count).toBe(2);

    const chunks = db.prepare("SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index").all("d1") as any[];
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("Section 1");
    expect(chunks[1].text).toContain("Section 2");
  });

  it("atomically replaces chunks on refresh", async () => {
    const fakeEmbed = async (texts: string[]) =>
      texts.map(() => Array.from({ length: 1536 }, () => Math.random()));

    // Index initial version
    await indexDocument(db, {
      documentId: "d1",
      householdId: "h1",
      driveFileId: "drive1",
      title: "Test Doc",
      markdown: "## Section 1\nOld content.",
      embedBatch: fakeEmbed,
    });

    // Refresh with new content
    await refreshDocument(db, {
      documentId: "d1",
      householdId: "h1",
      markdown: "## New Section\nNew content.\n\n## Another\nMore new.",
      embedBatch: fakeEmbed,
    });

    const chunks = db.prepare("SELECT * FROM chunks WHERE document_id = ?").all("d1") as any[];
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("New Section");

    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get("d1") as any;
    expect(doc.chunk_count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test tests/services/indexer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement indexer.ts**

```typescript
// src/services/indexer.ts
import type Database from "better-sqlite3";
import { chunkMarkdown } from "./chunker";
import { randomBytes } from "crypto";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

interface IndexParams {
  documentId: string;
  householdId: string;
  driveFileId: string;
  title: string;
  markdown: string;
  embedBatch: (texts: string[]) => Promise<number[][]>;
}

interface RefreshParams {
  documentId: string;
  householdId: string;
  markdown: string;
  embedBatch: (texts: string[]) => Promise<number[][]>;
}

export async function indexDocument(db: Database.Database, params: IndexParams): Promise<void> {
  const { documentId, householdId, driveFileId, title, markdown, embedBatch } = params;
  const now = new Date().toISOString();

  // Insert the document record
  db.prepare(
    "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, 'indexing', ?)"
  ).run(documentId, householdId, driveFileId, title, markdown, now);

  try {
    await storeChunks(db, documentId, householdId, markdown, embedBatch);
    const chunkCount = db.prepare("SELECT COUNT(*) as count FROM chunks WHERE document_id = ?").get(documentId) as any;
    db.prepare("UPDATE documents SET status = 'ready', chunk_count = ?, last_synced = ? WHERE id = ?").run(
      chunkCount.count, now, documentId
    );
  } catch (err) {
    db.prepare("UPDATE documents SET status = 'error' WHERE id = ?").run(documentId);
    throw err;
  }
}

export async function refreshDocument(db: Database.Database, params: RefreshParams): Promise<void> {
  const { documentId, householdId, markdown, embedBatch } = params;
  const now = new Date().toISOString();

  db.prepare("UPDATE documents SET status = 'indexing', markdown = ? WHERE id = ?").run(markdown, documentId);

  try {
    // Delete old chunks + embeddings atomically
    const oldChunks = db.prepare("SELECT id FROM chunks WHERE document_id = ?").all(documentId) as any[];
    for (const chunk of oldChunks) {
      db.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?").run(chunk.id);
    }
    db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);

    await storeChunks(db, documentId, householdId, markdown, embedBatch);
    const chunkCount = db.prepare("SELECT COUNT(*) as count FROM chunks WHERE document_id = ?").get(documentId) as any;
    db.prepare("UPDATE documents SET status = 'ready', chunk_count = ?, last_synced = ? WHERE id = ?").run(
      chunkCount.count, now, documentId
    );
  } catch (err) {
    db.prepare("UPDATE documents SET status = 'error' WHERE id = ?").run(documentId);
    throw err;
  }
}

async function storeChunks(
  db: Database.Database,
  documentId: string,
  householdId: string,
  markdown: string,
  embedBatch: (texts: string[]) => Promise<number[][]>
): Promise<void> {
  const texts = chunkMarkdown(markdown);
  if (texts.length === 0) return;

  const embeddings = await embedBatch(texts);
  const now = new Date().toISOString();

  const insertChunk = db.prepare(
    "INSERT INTO chunks (id, document_id, household_id, chunk_index, text, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insertEmbedding = db.prepare(
    "INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)"
  );

  const transaction = db.transaction(() => {
    for (let i = 0; i < texts.length; i++) {
      const chunkId = generateId();
      insertChunk.run(chunkId, documentId, householdId, i, texts[i], now);
      const vec = new Float32Array(embeddings[i]);
      insertEmbedding.run(chunkId, Buffer.from(vec.buffer));
    }
  });

  transaction();
}
```

- [ ] **Step 4: Implement suggestions.ts**

```typescript
// src/services/suggestions.ts
import type Database from "better-sqlite3";
import { chatComplete, type ChatMessage } from "./chat-provider";
import { randomBytes } from "crypto";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export async function generateSuggestions(db: Database.Database, householdId: string): Promise<string[]> {
  // Gather all chunk texts for the household
  const chunks = db
    .prepare("SELECT text FROM chunks WHERE household_id = ? ORDER BY document_id, chunk_index")
    .all(householdId) as any[];

  if (chunks.length === 0) return [];

  // Truncate to avoid exceeding context — take first ~20 chunks
  const sampleText = chunks
    .slice(0, 20)
    .map((c: any) => c.text)
    .join("\n\n---\n\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "You generate suggested questions for household guests.",
    },
    {
      role: "user",
      content: `Given these household documents, what are the 5 most likely questions a guest would ask? Return as a JSON array of short question strings.\n\nDocuments:\n${sampleText}`,
    },
  ];

  const response = await chatComplete(messages);

  try {
    // Extract JSON array from response (handle potential markdown wrapping)
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const chips = JSON.parse(match[0]) as string[];
    if (!Array.isArray(chips)) return [];

    // Store in DB
    const now = new Date().toISOString();
    db.prepare("DELETE FROM suggestions WHERE household_id = ?").run(householdId);
    db.prepare("INSERT INTO suggestions (id, household_id, chips, created_at) VALUES (?, ?, ?, ?)").run(
      generateId(), householdId, JSON.stringify(chips.slice(0, 5)), now
    );

    return chips.slice(0, 5);
  } catch {
    // Malformed JSON — fail silently per spec
    return [];
  }
}

export function getSuggestions(db: Database.Database, householdId: string): string[] {
  const row = db.prepare("SELECT chips FROM suggestions WHERE household_id = ?").get(householdId) as any;
  if (!row) return [];
  try {
    return JSON.parse(row.chips);
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd backend && bun test tests/services/indexer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/indexer.ts backend/src/services/suggestions.ts backend/tests/services/indexer.test.ts
git commit -m "feat(backend): document indexer (chunk + embed + store) and suggestion chip generation"
```

---

## Task 9: Auth Middleware (Owner JWT + Guest hss_)

**Files:**
- Create: `backend/src/middleware/owner-auth.ts`
- Create: `backend/src/middleware/guest-auth.ts`
- Create: `backend/tests/middleware/owner-auth.test.ts`
- Create: `backend/tests/middleware/guest-auth.test.ts`

- [ ] **Step 1: Write failing tests for owner auth**

```typescript
// tests/middleware/owner-auth.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { SignJWT, jwtVerify } from "jose";
import { authenticateOwner } from "../../src/middleware/owner-auth";

async function createOwnerJwt(personId: string, householdId: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  return new SignJWT({ personId, householdId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(encoder.encode(secret));
}

describe("owner auth middleware", () => {
  let db: Database.Database;
  const secret = "test-secret";

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
  });

  it("returns person and household for valid JWT", async () => {
    const token = await createOwnerJwt("p1", "h1", secret);
    const result = await authenticateOwner(db, `Bearer ${token}`, secret);
    expect(result.personId).toBe("p1");
    expect(result.householdId).toBe("h1");
  });

  it("throws for missing Authorization header", async () => {
    expect(authenticateOwner(db, undefined, secret)).rejects.toThrow("unauthorized");
  });

  it("throws for invalid JWT", async () => {
    expect(authenticateOwner(db, "Bearer garbage", secret)).rejects.toThrow("unauthorized");
  });
});
```

- [ ] **Step 2: Write failing tests for guest auth**

```typescript
// tests/middleware/guest-auth.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { authenticateGuest } from "../../src/middleware/guest-auth";
import { generateInviteToken, redeemInviteToken, revokeGuestTokens } from "../../src/services/tokens";

describe("guest auth middleware", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
    db.prepare(
      "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("g1", "h1", "Maria", "maria@test.com", "email", "pending", new Date().toISOString());
  });

  it("returns guest info for valid hss_ token", () => {
    const invite = generateInviteToken(db, "h1", "g1");
    const session = redeemInviteToken(db, invite.token);
    const result = authenticateGuest(db, `Bearer ${session.token}`);
    expect(result.guestId).toBe("g1");
    expect(result.householdId).toBe("h1");
  });

  it("throws for revoked token", () => {
    const invite = generateInviteToken(db, "h1", "g1");
    const session = redeemInviteToken(db, invite.token);
    revokeGuestTokens(db, "g1");
    expect(() => authenticateGuest(db, `Bearer ${session.token}`)).toThrow("session_expired");
  });

  it("throws for missing header", () => {
    expect(() => authenticateGuest(db, undefined)).toThrow("unauthorized");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && bun test tests/middleware/
```

Expected: FAIL.

- [ ] **Step 4: Implement owner-auth.ts**

```typescript
// src/middleware/owner-auth.ts
import type Database from "better-sqlite3";
import { jwtVerify } from "jose";

export interface OwnerContext {
  personId: string;
  householdId: string;
}

export async function authenticateOwner(
  db: Database.Database,
  authHeader: string | undefined | null,
  jwtSecret: string
): Promise<OwnerContext> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("unauthorized");
  }

  const token = authHeader.slice(7);

  try {
    const encoder = new TextEncoder();
    const { payload } = await jwtVerify(token, encoder.encode(jwtSecret));
    const personId = payload.personId as string;
    const householdId = payload.householdId as string;

    if (!personId || !householdId) throw new Error("unauthorized");

    // Verify person + household exist
    const person = db.prepare("SELECT id FROM persons WHERE id = ?").get(personId);
    const household = db.prepare("SELECT id FROM households WHERE id = ? AND owner_id = ?").get(householdId, personId);

    if (!person || !household) throw new Error("unauthorized");

    return { personId, householdId };
  } catch {
    throw new Error("unauthorized");
  }
}
```

- [ ] **Step 5: Implement guest-auth.ts**

```typescript
// src/middleware/guest-auth.ts
import type Database from "better-sqlite3";
import { validateSessionToken } from "../services/tokens";

export interface GuestContext {
  guestId: string;
  householdId: string;
}

export function authenticateGuest(
  db: Database.Database,
  authHeader: string | undefined | null
): GuestContext {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("unauthorized");
  }

  const token = authHeader.slice(7);
  const result = validateSessionToken(db, token);

  if (!result) {
    throw new Error("session_expired");
  }

  return result;
}
```

- [ ] **Step 6: Run tests**

```bash
cd backend && bun test tests/middleware/
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/middleware/ backend/tests/middleware/
git commit -m "feat(backend): owner JWT + guest hss_ auth middleware"
```

---

## Task 10: Route — Auth (Google OAuth + Invite Redeem)

**Files:**
- Create: `backend/src/routes/auth.ts`
- Create: `backend/tests/routes/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/routes/auth.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { handleInviteRedeem } from "../../src/routes/auth";
import { generateInviteToken } from "../../src/services/tokens";

describe("POST /auth/invite/redeem", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
    db.prepare(
      "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("g1", "h1", "Maria", "maria@test.com", "email", "pending", new Date().toISOString());
  });

  it("returns hss_ token and guest info for valid invite", async () => {
    const invite = generateInviteToken(db, "h1", "g1");
    const result = await handleInviteRedeem(db, { invite_token: invite.token });
    expect(result.status).toBe(200);
    expect(result.body.session_token).toMatch(/^hss_/);
    expect(result.body.guest.id).toBe("g1");
    expect(result.body.guest.name).toBe("Maria");
  });

  it("returns 410 for used token", async () => {
    const invite = generateInviteToken(db, "h1", "g1");
    await handleInviteRedeem(db, { invite_token: invite.token });
    const result = await handleInviteRedeem(db, { invite_token: invite.token });
    expect(result.status).toBe(410);
    expect(result.body.message).toBe("This invite has already been used");
  });

  it("returns 410 for expired token", async () => {
    const invite = generateInviteToken(db, "h1", "g1");
    db.prepare("UPDATE invite_tokens SET expires_at = ? WHERE token = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      invite.token
    );
    const result = await handleInviteRedeem(db, { invite_token: invite.token });
    expect(result.status).toBe(410);
    expect(result.body.message).toBe("This invite has expired");
  });

  it("returns 404 for unknown token", async () => {
    const result = await handleInviteRedeem(db, { invite_token: "hsi_fake" });
    expect(result.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test tests/routes/auth.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement auth.ts**

```typescript
// src/routes/auth.ts
import type Database from "better-sqlite3";
import { SignJWT } from "jose";
import { getAuthUrl, exchangeCode } from "../services/google-auth";
import { redeemInviteToken } from "../services/tokens";
import { randomBytes } from "crypto";
import { config } from "../config";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export function handleGoogleAuthStart(): Response {
  const state = randomBytes(16).toString("hex");
  // In production, store state in a cookie for CSRF validation
  const url = getAuthUrl(state);
  return Response.redirect(url, 302);
}

export async function handleGoogleCallback(
  db: Database.Database,
  code: string,
  _state: string
): Promise<{ status: number; body: any }> {
  try {
    const { email, refreshToken, name } = await exchangeCode(code);

    // Upsert person
    let person = db.prepare("SELECT * FROM persons WHERE email = ?").get(email) as any;
    let isNew = false;

    if (!person) {
      const personId = generateId();
      db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
        personId, email, refreshToken, new Date().toISOString()
      );
      person = { id: personId, email };
      isNew = true;
    } else {
      // Update refresh token
      db.prepare("UPDATE persons SET google_refresh_token = ? WHERE id = ?").run(refreshToken, person.id);
    }

    // Get or note absence of household
    const household = db.prepare("SELECT * FROM households WHERE owner_id = ?").get(person.id) as any;

    // Create JWT
    const encoder = new TextEncoder();
    const token = await new SignJWT({
      personId: person.id,
      householdId: household?.id || null,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .sign(encoder.encode(config.jwtSecret));

    return {
      status: 200,
      body: {
        token,
        household: household
          ? { id: household.id, name: household.name, created_at: household.created_at }
          : null,
        is_new: isNew,
      },
    };
  } catch (err) {
    return { status: 500, body: { message: "Authentication failed" } };
  }
}

export async function handleInviteRedeem(
  db: Database.Database,
  body: { invite_token: string }
): Promise<{ status: number; body: any }> {
  try {
    const result = redeemInviteToken(db, body.invite_token);
    const guest = db.prepare("SELECT id, name, household_id FROM guests WHERE id = ?").get(result.guestId) as any;

    return {
      status: 200,
      body: {
        session_token: result.token,
        guest: {
          id: guest.id,
          name: guest.name,
          household_id: guest.household_id,
        },
      },
    };
  } catch (err: any) {
    if (err.message === "already_used") {
      return { status: 410, body: { message: "This invite has already been used" } };
    }
    if (err.message === "expired") {
      return { status: 410, body: { message: "This invite has expired" } };
    }
    if (err.message === "not_found") {
      return { status: 404, body: { message: "Invite not found" } };
    }
    return { status: 500, body: { message: "Something went wrong" } };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test tests/routes/auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/auth.ts backend/tests/routes/auth.test.ts
git commit -m "feat(backend): auth routes — Google OAuth + invite token redemption"
```

---

## Task 11: Route — Household + Guests

**Files:**
- Create: `backend/src/routes/household.ts`
- Create: `backend/src/routes/guests.ts`
- Create: `backend/tests/routes/guests.test.ts`

- [ ] **Step 1: Write failing tests for guests**

```typescript
// tests/routes/guests.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { handleListGuests, handleCreateGuest, handleRevokeGuest, handleDeleteGuest } from "../../src/routes/guests";

describe("guest routes", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
  });

  describe("POST /guests", () => {
    it("creates a guest with pending status and returns magic link", async () => {
      const result = await handleCreateGuest(db, "h1", {
        name: "Maria",
        email: "maria@test.com",
        phone: null,
      });
      expect(result.status).toBe(200);
      expect(result.body.guest.name).toBe("Maria");
      expect(result.body.guest.status).toBe("pending");
      expect(result.body.magic_link).toContain("hsi_");
      expect(result.body.invite_token).toMatch(/^hsi_/);
    });

    it("returns 422 when name is missing", async () => {
      const result = await handleCreateGuest(db, "h1", {
        name: "",
        email: "maria@test.com",
        phone: null,
      });
      expect(result.status).toBe(422);
    });

    it("returns 422 when neither email nor phone provided", async () => {
      const result = await handleCreateGuest(db, "h1", {
        name: "Maria",
        email: null,
        phone: null,
      });
      expect(result.status).toBe(422);
    });
  });

  describe("GET /guests", () => {
    it("lists all guests for the household", async () => {
      await handleCreateGuest(db, "h1", { name: "Maria", email: "maria@test.com", phone: null });
      await handleCreateGuest(db, "h1", { name: "James", email: "james@test.com", phone: null });
      const result = handleListGuests(db, "h1");
      expect(result.body.guests).toHaveLength(2);
    });
  });

  describe("POST /guests/:id/revoke", () => {
    it("revokes an active guest", async () => {
      const created = await handleCreateGuest(db, "h1", { name: "Maria", email: "maria@test.com", phone: null });
      const guestId = created.body.guest.id;

      // Activate the guest by redeeming the invite
      const { redeemInviteToken } = await import("../../src/services/tokens");
      redeemInviteToken(db, created.body.invite_token);

      const result = handleRevokeGuest(db, "h1", guestId);
      expect(result.status).toBe(200);
      expect(result.body.revoked_at).toBeTruthy();
    });

    it("returns 409 for already-revoked guest", async () => {
      const created = await handleCreateGuest(db, "h1", { name: "Maria", email: "maria@test.com", phone: null });
      const guestId = created.body.guest.id;
      const { redeemInviteToken } = await import("../../src/services/tokens");
      redeemInviteToken(db, created.body.invite_token);

      handleRevokeGuest(db, "h1", guestId);
      const result = handleRevokeGuest(db, "h1", guestId);
      expect(result.status).toBe(409);
    });
  });

  describe("DELETE /guests/:id", () => {
    it("deletes a revoked guest", async () => {
      const created = await handleCreateGuest(db, "h1", { name: "Maria", email: "maria@test.com", phone: null });
      const guestId = created.body.guest.id;
      const { redeemInviteToken } = await import("../../src/services/tokens");
      redeemInviteToken(db, created.body.invite_token);
      handleRevokeGuest(db, "h1", guestId);

      const result = handleDeleteGuest(db, "h1", guestId);
      expect(result.status).toBe(204);
    });

    it("returns 409 if guest is still active", async () => {
      const created = await handleCreateGuest(db, "h1", { name: "Maria", email: "maria@test.com", phone: null });
      const guestId = created.body.guest.id;
      const { redeemInviteToken } = await import("../../src/services/tokens");
      redeemInviteToken(db, created.body.invite_token);

      const result = handleDeleteGuest(db, "h1", guestId);
      expect(result.status).toBe(409);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test tests/routes/guests.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement household.ts**

```typescript
// src/routes/household.ts
import type Database from "better-sqlite3";

export function handleUpdateHousehold(
  db: Database.Database,
  householdId: string,
  body: { name: string }
): { status: number; body: any } {
  if (!body.name || !body.name.trim()) {
    return { status: 422, body: { message: "Name is required" } };
  }

  db.prepare("UPDATE households SET name = ? WHERE id = ?").run(body.name.trim(), householdId);
  const household = db.prepare("SELECT id, name FROM households WHERE id = ?").get(householdId) as any;

  return { status: 200, body: { id: household.id, name: household.name } };
}
```

- [ ] **Step 4: Implement guests.ts**

```typescript
// src/routes/guests.ts
import type Database from "better-sqlite3";
import { generateInviteToken, revokeGuestTokens } from "../services/tokens";
import { randomBytes } from "crypto";
import { config } from "../config";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export function handleListGuests(
  db: Database.Database,
  householdId: string
): { status: number; body: any } {
  const guests = db
    .prepare("SELECT id, name, contact, contact_type, status, created_at FROM guests WHERE household_id = ?")
    .all(householdId);

  return { status: 200, body: { guests } };
}

export async function handleCreateGuest(
  db: Database.Database,
  householdId: string,
  body: { name: string | null; email: string | null; phone: string | null }
): Promise<{ status: number; body: any }> {
  if (!body.name || !body.name.trim()) {
    return { status: 422, body: { message: "Name is required" } };
  }
  if (!body.email && !body.phone) {
    return { status: 422, body: { message: "Email or phone number is required" } };
  }

  const guestId = generateId();
  const contact = body.email || body.phone!;
  const contactType = body.email ? "email" : "phone";
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO guests (id, household_id, name, contact, contact_type, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
  ).run(guestId, householdId, body.name.trim(), contact, contactType, now);

  const invite = generateInviteToken(db, householdId, guestId);
  const magicLink = `${config.appBaseUrl}/join/${invite.token}`;

  // TODO: Send email/SMS via Resend — deferred until integration testing
  // For now, return the link for manual delivery

  return {
    status: 200,
    body: {
      guest: { id: guestId, name: body.name.trim(), status: "pending" },
      magic_link: magicLink,
      invite_token: invite.token,
    },
  };
}

export function handleRevokeGuest(
  db: Database.Database,
  householdId: string,
  guestId: string
): { status: number; body: any } {
  const guest = db
    .prepare("SELECT * FROM guests WHERE id = ? AND household_id = ?")
    .get(guestId, householdId) as any;

  if (!guest) {
    return { status: 404, body: { message: "Guest not found" } };
  }
  if (guest.status === "revoked") {
    return { status: 409, body: { message: "Guest already revoked" } };
  }

  const revokedAt = revokeGuestTokens(db, guestId);

  return { status: 200, body: { guest_id: guestId, revoked_at: revokedAt } };
}

export function handleDeleteGuest(
  db: Database.Database,
  householdId: string,
  guestId: string
): { status: number; body: any } {
  const guest = db
    .prepare("SELECT * FROM guests WHERE id = ? AND household_id = ?")
    .get(guestId, householdId) as any;

  if (!guest) {
    return { status: 404, body: { message: "Guest not found" } };
  }
  if (guest.status !== "revoked") {
    return { status: 409, body: { message: "Guest is still active; revoke first" } };
  }

  // Delete tokens first, then guest
  db.prepare("DELETE FROM session_tokens WHERE guest_id = ?").run(guestId);
  db.prepare("DELETE FROM invite_tokens WHERE guest_id = ?").run(guestId);
  db.prepare("DELETE FROM guests WHERE id = ?").run(guestId);

  return { status: 204, body: null };
}
```

- [ ] **Step 5: Run tests**

```bash
cd backend && bun test tests/routes/guests.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/household.ts backend/src/routes/guests.ts backend/tests/routes/guests.test.ts
git commit -m "feat(backend): household + guest routes — CRUD, invite creation, revocation"
```

---

## Task 12: Route — Documents

**Files:**
- Create: `backend/src/routes/documents.ts`
- Create: `backend/tests/routes/documents.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/routes/documents.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { handleListDocuments, handleDeleteDocument, handleGetContent } from "../../src/routes/documents";

describe("document routes", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
  });

  describe("GET /documents", () => {
    it("lists all documents for household", () => {
      db.prepare(
        "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, chunk_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("d1", "h1", "drive1", "House Ops", "# Ops", "ready", 5, new Date().toISOString());

      const result = handleListDocuments(db, "h1");
      expect(result.body.documents).toHaveLength(1);
      expect(result.body.documents[0].title).toBe("House Ops");
      expect(result.body.documents[0].chunk_count).toBe(5);
    });
  });

  describe("DELETE /documents/:id", () => {
    it("removes document and returns 204", () => {
      db.prepare(
        "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("d1", "h1", "drive1", "House Ops", "# Ops", "ready", new Date().toISOString());

      const result = handleDeleteDocument(db, "h1", "d1");
      expect(result.status).toBe(204);

      const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get("d1");
      expect(doc).toBeUndefined();
    });

    it("returns 404 for nonexistent document", () => {
      const result = handleDeleteDocument(db, "h1", "nope");
      expect(result.status).toBe(404);
    });
  });

  describe("GET /documents/:id/content", () => {
    it("returns cached markdown", () => {
      db.prepare(
        "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("d1", "h1", "drive1", "House Ops", "## Emergency Contacts\n| Name | Phone |", "ready", new Date().toISOString());

      const result = handleGetContent(db, "h1", "d1");
      expect(result.status).toBe(200);
      expect(result.body.title).toBe("House Ops");
      expect(result.body.markdown).toContain("Emergency Contacts");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test tests/routes/documents.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement documents.ts**

```typescript
// src/routes/documents.ts
import type Database from "better-sqlite3";
import { fetchDocAsMarkdown } from "../services/google-drive";
import { indexDocument, refreshDocument } from "../services/indexer";
import { embedBatch } from "../services/embeddings";
import { generateSuggestions } from "../services/suggestions";
import { randomBytes } from "crypto";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export function handleListDocuments(
  db: Database.Database,
  householdId: string
): { status: number; body: any } {
  const docs = db
    .prepare(
      "SELECT id, title, drive_file_id, status, chunk_count, last_synced FROM documents WHERE household_id = ?"
    )
    .all(householdId);

  return { status: 200, body: { documents: docs } };
}

export async function handleConnectDocument(
  db: Database.Database,
  householdId: string,
  personId: string,
  body: { drive_file_id: string; title?: string }
): Promise<{ status: number; body: any }> {
  if (!body.drive_file_id) {
    return { status: 422, body: { message: "Missing drive_file_id" } };
  }

  const person = db.prepare("SELECT google_refresh_token FROM persons WHERE id = ?").get(personId) as any;
  const documentId = generateId();

  try {
    const { title, markdown } = await fetchDocAsMarkdown(person.google_refresh_token, body.drive_file_id);

    // Index asynchronously — but for v1 we do it inline
    await indexDocument(db, {
      documentId,
      householdId,
      driveFileId: body.drive_file_id,
      title: body.title || title,
      markdown,
      embedBatch,
    });

    // Regenerate suggestion chips after new doc
    generateSuggestions(db, householdId).catch(() => {
      // Chip generation failure is non-fatal
    });

    const doc = db.prepare("SELECT id, title, status FROM documents WHERE id = ?").get(documentId) as any;
    return { status: 200, body: { id: doc.id, title: doc.title, status: doc.status } };
  } catch (err) {
    return { status: 502, body: { message: "Drive API unreachable" } };
  }
}

export async function handleRefreshDocument(
  db: Database.Database,
  householdId: string,
  personId: string,
  documentId: string
): Promise<{ status: number; body: any }> {
  const doc = db
    .prepare("SELECT * FROM documents WHERE id = ? AND household_id = ?")
    .get(documentId, householdId) as any;

  if (!doc) return { status: 404, body: { message: "Document not found" } };

  const person = db.prepare("SELECT google_refresh_token FROM persons WHERE id = ?").get(personId) as any;

  try {
    const { markdown } = await fetchDocAsMarkdown(person.google_refresh_token, doc.drive_file_id);

    await refreshDocument(db, {
      documentId,
      householdId,
      markdown,
      embedBatch,
    });

    // Regenerate suggestion chips after refresh
    generateSuggestions(db, householdId).catch(() => {});

    return { status: 200, body: { id: documentId, status: "indexing" } };
  } catch (err) {
    return { status: 502, body: { message: "Drive API unreachable" } };
  }
}

export function handleDeleteDocument(
  db: Database.Database,
  householdId: string,
  documentId: string
): { status: number; body: any } {
  const doc = db
    .prepare("SELECT id FROM documents WHERE id = ? AND household_id = ?")
    .get(documentId, householdId) as any;

  if (!doc) return { status: 404, body: { message: "Document not found" } };

  // Delete embeddings for this doc's chunks
  const chunks = db.prepare("SELECT id FROM chunks WHERE document_id = ?").all(documentId) as any[];
  for (const chunk of chunks) {
    db.prepare("DELETE FROM chunk_embeddings WHERE chunk_id = ?").run(chunk.id);
  }
  // Chunks cascade-delete with document
  db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);
  db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);

  return { status: 204, body: null };
}

export function handleGetContent(
  db: Database.Database,
  householdId: string,
  documentId: string
): { status: number; body: any } {
  const doc = db
    .prepare("SELECT id, title, markdown FROM documents WHERE id = ? AND household_id = ?")
    .get(documentId, householdId) as any;

  if (!doc) return { status: 404, body: { message: "Document not found" } };

  return {
    status: 200,
    body: { id: doc.id, title: doc.title, markdown: doc.markdown },
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test tests/routes/documents.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/documents.ts backend/tests/routes/documents.test.ts
git commit -m "feat(backend): document routes — connect, list, refresh, delete, content"
```

---

## Task 13: Route — Chat + Suggestions + Preview

**Files:**
- Create: `backend/src/routes/chat.ts`
- Create: `backend/tests/routes/chat.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/routes/chat.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations";
import { handleGetSuggestions } from "../../src/routes/chat";

describe("chat routes", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
  });

  describe("GET /chat/suggestions", () => {
    it("returns empty array when no suggestions exist", () => {
      const result = handleGetSuggestions(db, "h1");
      expect(result.body.suggestions).toEqual([]);
    });

    it("returns stored suggestions", () => {
      db.prepare("INSERT INTO suggestions (id, household_id, chips, created_at) VALUES (?, ?, ?, ?)").run(
        "s1", "h1", JSON.stringify(["What's the WiFi?", "Where are the keys?"]), new Date().toISOString()
      );

      const result = handleGetSuggestions(db, "h1");
      expect(result.body.suggestions).toHaveLength(2);
      expect(result.body.suggestions[0]).toBe("What's the WiFi?");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test tests/routes/chat.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement chat.ts**

```typescript
// src/routes/chat.ts
import type Database from "better-sqlite3";
import { embed } from "../services/embeddings";
import { chat, type ChatMessage } from "../services/chat-provider";
import { searchChunks } from "../services/search";
import { getSuggestions } from "../services/suggestions";

const SYSTEM_PROMPT = `You are a helpful household assistant. Answer questions using ONLY the provided document excerpts below. If the answer is not present in the excerpts, say exactly: "I don't have that information in the household docs." Do not make up information or use knowledge outside these documents.

Document excerpts:
`;

interface ChatRequest {
  message: string;
  history: Array<{ role: string; content: string }>;
}

export async function handleChat(
  db: Database.Database,
  householdId: string,
  body: ChatRequest
): Promise<Response> {
  // 1. Embed the query
  const queryEmbedding = await embed(body.message);
  const queryVec = new Float32Array(queryEmbedding);

  // 2. Search for relevant chunks
  const results = searchChunks(db, householdId, queryVec, 5);

  // 3. Build prompt with retrieved chunks
  const chunkContext = results
    .map((r, i) => `[${i + 1}] (${r.documentTitle}, section ${r.chunkIndex})\n${r.text}`)
    .join("\n\n---\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + chunkContext },
    ...body.history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: body.message },
  ];

  // 4. Stream response as SSE
  const sources = results.map((r) => ({
    document_id: r.documentId,
    title: r.documentTitle,
    chunk_index: r.chunkIndex,
  }));

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const delta of chat(messages)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`));
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: "Something went wrong. Please try again." })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function handleGetSuggestions(
  db: Database.Database,
  householdId: string
): { status: number; body: any } {
  const suggestions = getSuggestions(db, householdId);
  return { status: 200, body: { suggestions } };
}

// Preview uses the same logic as handleChat but is authenticated via owner session
export async function handleChatPreview(
  db: Database.Database,
  householdId: string,
  body: ChatRequest
): Promise<Response> {
  return handleChat(db, householdId, body);
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test tests/routes/chat.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/chat.ts backend/tests/routes/chat.test.ts
git commit -m "feat(backend): chat routes — streaming SSE, suggestions, owner preview"
```

---

## Task 14: HTTP Server + Route Dispatch

**Files:**
- Create: `backend/src/index.ts`

- [ ] **Step 1: Write index.ts**

```typescript
// src/index.ts
import { getDb } from "./db/connection";
import { config } from "./config";
import { authenticateOwner } from "./middleware/owner-auth";
import { authenticateGuest } from "./middleware/guest-auth";
import { handleGoogleAuthStart, handleGoogleCallback, handleInviteRedeem } from "./routes/auth";
import { handleUpdateHousehold } from "./routes/household";
import { handleListGuests, handleCreateGuest, handleRevokeGuest, handleDeleteGuest } from "./routes/guests";
import {
  handleListDocuments,
  handleConnectDocument,
  handleRefreshDocument,
  handleDeleteDocument,
  handleGetContent,
} from "./routes/documents";
import { handleChat, handleGetSuggestions, handleChatPreview } from "./routes/chat";

function json(body: any, status: number = 200): Response {
  if (status === 204) return new Response(null, { status: 204 });
  return Response.json(body, { status });
}

function parsePathParams(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

const server = Bun.serve({
  port: config.port,

  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    try {
      // --- Auth routes (no auth required) ---
      if (method === "POST" && pathname === "/auth/google") {
        return handleGoogleAuthStart();
      }

      if (method === "GET" && pathname === "/auth/google/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return json({ message: "Missing code or state" }, 400);
        const result = await handleGoogleCallback(getDb(), code, state);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/auth/invite/redeem") {
        const body = await req.json();
        const result = await handleInviteRedeem(getDb(), body);
        return json(result.body, result.status);
      }

      // --- Owner routes ---
      if (method === "PATCH" && pathname === "/household") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        const result = handleUpdateHousehold(getDb(), owner.householdId, body);
        return json(result.body, result.status);
      }

      if (method === "GET" && pathname === "/guests") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleListGuests(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/guests") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        const result = await handleCreateGuest(getDb(), owner.householdId, body);
        return json(result.body, result.status);
      }

      // Guest routes with :id param
      const revokeParams = parsePathParams("/guests/:id/revoke", pathname);
      if (method === "POST" && revokeParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleRevokeGuest(getDb(), owner.householdId, revokeParams.id);
        return json(result.body, result.status);
      }

      const deleteGuestParams = parsePathParams("/guests/:id", pathname);
      if (method === "DELETE" && deleteGuestParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleDeleteGuest(getDb(), owner.householdId, deleteGuestParams.id);
        return json(result.body, result.status);
      }

      // --- Document routes ---
      if (method === "GET" && pathname === "/documents") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleListDocuments(getDb(), owner.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/documents") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        const result = await handleConnectDocument(getDb(), owner.householdId, owner.personId, body);
        return json(result.body, result.status);
      }

      const refreshDocParams = parsePathParams("/documents/:id/refresh", pathname);
      if (method === "POST" && refreshDocParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = await handleRefreshDocument(getDb(), owner.householdId, owner.personId, refreshDocParams.id);
        return json(result.body, result.status);
      }

      const docContentParams = parsePathParams("/documents/:id/content", pathname);
      if (method === "GET" && docContentParams) {
        // This endpoint accepts BOTH owner and guest auth
        let householdId: string;
        try {
          const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
          householdId = owner.householdId;
        } catch {
          try {
            const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
            householdId = guest.householdId;
          } catch {
            return json({ message: "Unauthorized" }, 401);
          }
        }
        const result = handleGetContent(getDb(), householdId, docContentParams.id);
        return json(result.body, result.status);
      }

      const deleteDocParams = parsePathParams("/documents/:id", pathname);
      if (method === "DELETE" && deleteDocParams) {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const result = handleDeleteDocument(getDb(), owner.householdId, deleteDocParams.id);
        return json(result.body, result.status);
      }

      // --- Chat routes ---
      if (method === "POST" && pathname === "/chat") {
        const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
        const body = await req.json();
        return handleChat(getDb(), guest.householdId, body);
      }

      if (method === "GET" && pathname === "/chat/suggestions") {
        const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
        const result = handleGetSuggestions(getDb(), guest.householdId);
        return json(result.body, result.status);
      }

      if (method === "POST" && pathname === "/chat/preview") {
        const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
        const body = await req.json();
        return handleChatPreview(getDb(), owner.householdId, body);
      }

      return json({ message: "Not found" }, 404);
    } catch (err: any) {
      if (err.message === "unauthorized") {
        return json({ message: "Unauthorized" }, 401);
      }
      if (err.message === "session_expired") {
        return json({ message: "Your session has expired. Please use your invite link again." }, 401);
      }
      console.error("Unhandled error:", err);
      return json({ message: "Something went wrong. Please try again." }, 500);
    }
  },
});

console.log(`Hearthstone backend running on http://localhost:${server.port}`);
```

- [ ] **Step 2: Verify `bun run dev` starts without errors**

```bash
cd backend && bun run dev
```

Expected: Server starts, prints "Hearthstone backend running on http://localhost:3000". (Will fail on missing env vars — create a `.env` from `.env.example` with at least `JWT_SECRET` and placeholder values.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(backend): HTTP server with full route dispatch"
```

---

## Task 15: Integration Smoke Test

**Files:**
- Create: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/integration.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations";
import { handleInviteRedeem } from "../src/routes/auth";
import { handleCreateGuest, handleListGuests, handleRevokeGuest, handleDeleteGuest } from "../src/routes/guests";
import { handleUpdateHousehold } from "../src/routes/household";
import { handleGetSuggestions } from "../src/routes/chat";
import { handleListDocuments, handleDeleteDocument, handleGetContent } from "../src/routes/documents";
import { generateInviteToken, redeemInviteToken } from "../src/services/tokens";

describe("integration: full guest lifecycle", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh", new Date().toISOString()
    );
    db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      "h1", "p1", "Test Home", new Date().toISOString()
    );
  });

  it("owner creates guest → guest redeems invite → owner revokes → owner deletes", async () => {
    // 1. Owner creates guest
    const created = await handleCreateGuest(db, "h1", {
      name: "Maria",
      email: "maria@test.com",
      phone: null,
    });
    expect(created.status).toBe(200);
    const guestId = created.body.guest.id;
    const inviteToken = created.body.invite_token;

    // 2. Guest list shows pending
    const list1 = handleListGuests(db, "h1");
    expect(list1.body.guests[0].status).toBe("pending");

    // 3. Guest redeems invite
    const redeemed = await handleInviteRedeem(db, { invite_token: inviteToken });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.session_token).toMatch(/^hss_/);

    // 4. Guest is now active
    const list2 = handleListGuests(db, "h1");
    expect(list2.body.guests[0].status).toBe("active");

    // 5. Owner revokes
    const revoked = handleRevokeGuest(db, "h1", guestId);
    expect(revoked.status).toBe(200);

    // 6. Guest is revoked
    const list3 = handleListGuests(db, "h1");
    expect(list3.body.guests[0].status).toBe("revoked");

    // 7. Owner deletes
    const deleted = handleDeleteGuest(db, "h1", guestId);
    expect(deleted.status).toBe(204);

    // 8. Guest list empty
    const list4 = handleListGuests(db, "h1");
    expect(list4.body.guests).toHaveLength(0);
  });

  it("household name update works", () => {
    const result = handleUpdateHousehold(db, "h1", { name: "The Anderson Home" });
    expect(result.status).toBe(200);
    expect(result.body.name).toBe("The Anderson Home");
  });

  it("suggestions return empty when no docs connected", () => {
    const result = handleGetSuggestions(db, "h1");
    expect(result.body.suggestions).toEqual([]);
  });

  it("document content returns cached markdown", () => {
    db.prepare(
      "INSERT INTO documents (id, household_id, drive_file_id, title, markdown, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("d1", "h1", "drive1", "House Rules", "## Rules\nNo shoes inside.", "ready", new Date().toISOString());

    const result = handleGetContent(db, "h1", "d1");
    expect(result.status).toBe(200);
    expect(result.body.markdown).toContain("No shoes inside");
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
cd backend && bun test
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration.test.ts
git commit -m "test(backend): integration smoke test — full guest lifecycle"
```

---

## Task 16: Household Creation (Post-OAuth)

**Files:**
- Modify: `backend/src/routes/auth.ts`
- Create: `backend/src/routes/household-create.ts`

This fills a gap: after OAuth, the owner needs to name their household. The callback returns `household: null` for new users, and the iOS app will call this endpoint.

- [ ] **Step 1: Write the test**

```typescript
// Add to tests/routes/auth.test.ts

import { handleCreateHousehold } from "../../src/routes/household-create";

describe("POST /household (create)", () => {
  it("creates a household for a person who has none", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh", new Date().toISOString()
    );

    const result = handleCreateHousehold(db, "p1", { name: "The Anderson Home" });
    expect(result.status).toBe(200);
    expect(result.body.name).toBe("The Anderson Home");
    expect(result.body.id).toBeTruthy();
  });

  it("returns 422 if name is empty", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO persons (id, email, google_refresh_token, created_at) VALUES (?, ?, ?, ?)").run(
      "p1", "owner@test.com", "refresh", new Date().toISOString()
    );

    const result = handleCreateHousehold(db, "p1", { name: "" });
    expect(result.status).toBe(422);
  });
});
```

- [ ] **Step 2: Implement household-create.ts**

```typescript
// src/routes/household-create.ts
import type Database from "better-sqlite3";
import { randomBytes } from "crypto";

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export function handleCreateHousehold(
  db: Database.Database,
  personId: string,
  body: { name: string }
): { status: number; body: any } {
  if (!body.name || !body.name.trim()) {
    return { status: 422, body: { message: "Household name is required" } };
  }

  const id = generateId();
  const now = new Date().toISOString();

  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    id, personId, body.name.trim(), now
  );

  return {
    status: 200,
    body: { id, name: body.name.trim(), created_at: now },
  };
}
```

- [ ] **Step 3: Wire into index.ts**

Add this route to `src/index.ts` in the owner routes section:

```typescript
if (method === "POST" && pathname === "/household") {
  const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
  const body = await req.json();
  const result = handleCreateHousehold(getDb(), owner.personId, body);
  return json(result.body, result.status);
}
```

Add the import:
```typescript
import { handleCreateHousehold } from "./routes/household-create";
```

- [ ] **Step 4: Run all tests**

```bash
cd backend && bun test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/household-create.ts backend/src/index.ts backend/tests/routes/auth.test.ts
git commit -m "feat(backend): household creation endpoint for post-OAuth flow"
```
