import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations";

export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
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
  return `test_owner_${personId}_${householdId}`;
}
