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
}
