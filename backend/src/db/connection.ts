import "./setup-sqlite";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "./migrations";
import { config } from "../config";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    db = new Database(config.databaseUrl);
    sqliteVec.load(db);
    runMigrations(db);
    db.run(`
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
