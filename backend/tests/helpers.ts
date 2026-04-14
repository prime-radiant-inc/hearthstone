// Set required env vars BEFORE any import that may transitively load
// `src/config.ts` — config uses `required()` which throws at import time
// if these are missing. Tests never actually hit these endpoints, so the
// values just need to parse.
process.env.HEARTHSTONE_PUBLIC_URL ||= "http://test.example";
process.env.JWT_SECRET ||= "test-jwt-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";

import "../src/db/setup-sqlite";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { runMigrations } from "../src/db/migrations";

export function createTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

export function createTestDbWithVec(): Database {
  const db = new Database(":memory:");
  sqliteVec.load(db);
  runMigrations(db);
  return db;
}

export function makeOwnerJwt(personId: string, householdId: string): string {
  return `test_owner_${personId}_${householdId}`;
}
