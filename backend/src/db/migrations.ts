import type Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";

export function runMigrations(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  // Add heading column to chunks if it doesn't exist (added for clean chunk storage)
  const columns = db.prepare("PRAGMA table_info(chunks)").all() as any[];
  if (!columns.some((c: any) => c.name === "heading")) {
    db.exec("ALTER TABLE chunks ADD COLUMN heading TEXT NOT NULL DEFAULT ''");
  }
}
