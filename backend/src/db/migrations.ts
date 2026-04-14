import { Database } from "bun:sqlite";
import { SCHEMA_SQL } from "./schema";

export function runMigrations(db: Database): void {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run(SCHEMA_SQL);

  // Add heading column to chunks if it doesn't exist (added for clean chunk storage)
  const columns = db.prepare("PRAGMA table_info(chunks)").all() as any[];
  if (!columns.some((c: any) => c.name === "heading")) {
    db.run("ALTER TABLE chunks ADD COLUMN heading TEXT NOT NULL DEFAULT ''");
  }

  // Create auth_pins table if it doesn't exist (added for PIN-based auth)
  db.run(`
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
  `);

  // Add household_members table
  db.run(`
    CREATE TABLE IF NOT EXISTS household_members (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id),
      person_id TEXT NOT NULL REFERENCES persons(id),
      role TEXT NOT NULL CHECK(role IN ('owner')),
      created_at TEXT NOT NULL,
      UNIQUE(household_id, person_id)
    );
  `);

  // Migrate existing owner_id data into household_members
  const households = db.prepare("SELECT id, owner_id, created_at FROM households").all() as any[];
  for (const h of households) {
    const exists = db.prepare(
      "SELECT id FROM household_members WHERE household_id = ? AND person_id = ?"
    ).get(h.id, h.owner_id);
    if (!exists) {
      db.prepare(
        "INSERT INTO household_members (id, household_id, person_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)"
      ).run(crypto.randomUUID(), h.id, h.owner_id, h.created_at);
    }
  }

  // Add name column to persons if not present
  const personCols = db.prepare("PRAGMA table_info(persons)").all() as any[];
  if (!personCols.some((c: any) => c.name === "name")) {
    db.run("ALTER TABLE persons ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }

  // FTS5 virtual table over chunks. External-content table — index lives here,
  // canonical text stays in `chunks`. Triggers keep them in sync.
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text, heading,
      content='chunks',
      content_rowid='rowid'
    );
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text, heading)
      VALUES (new.rowid, new.text, new.heading);
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, heading)
      VALUES('delete', old.rowid, old.text, old.heading);
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, heading)
      VALUES('delete', old.rowid, old.text, old.heading);
      INSERT INTO chunks_fts(rowid, text, heading)
      VALUES (new.rowid, new.text, new.heading);
    END;
  `);

  // Backfill from existing chunks. Idempotent — rebuild is the FTS5 way to
  // recompute the index from external content.
  db.run("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');");
}
