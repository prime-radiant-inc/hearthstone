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
