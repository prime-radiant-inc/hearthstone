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
}
