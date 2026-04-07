#!/usr/bin/env bun
import "../src/db/setup-sqlite";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createAuthPin } from "../src/services/pins";
import { runMigrations } from "../src/db/migrations";

// Load .env
const envPath = resolve(import.meta.dirname, "..", ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const dbPath = resolve(import.meta.dirname, "..", process.env.DATABASE_URL || "./hearthstone.db");
const db = new Database(dbPath);
sqliteVec.load(db);
runMigrations(db);
db.run(`
  CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
    chunk_id TEXT PRIMARY KEY,
    embedding float[1536]
  );
`);

const householdId = process.argv[2];
if (!householdId) {
  const households = db.prepare("SELECT h.id, h.name, p.email FROM households h JOIN persons p ON p.id = h.owner_id ORDER BY h.name").all() as any[];
  if (households.length === 0) {
    console.log("No households found. Run `bun run create-household` first.");
  } else {
    console.log("Households:\n");
    for (const h of households) {
      console.log(`  ${h.id}  ${h.name} (${h.email})`);
    }
    console.log(`\nUsage: bun run owner-pin <household-id>`);
  }
  process.exit(0);
}

const household = db.prepare("SELECT h.id, h.name, h.owner_id FROM households h WHERE h.id = ?").get(householdId) as any;
if (!household) {
  console.error(`Household "${householdId}" not found.`);
  process.exit(1);
}

const { pin, expiresAt } = createAuthPin(db, {
  role: "owner",
  personId: household.owner_id,
  householdId: household.id,
});

const expiresDate = new Date(expiresAt).toLocaleDateString();

console.log(`\n✓ New owner PIN for "${household.name}": ${pin}`);
console.log(`  Expires: ${expiresDate}`);

db.close();
