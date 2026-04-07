#!/usr/bin/env bun
import "../src/db/setup-sqlite";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { generateId } from "../src/utils";
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

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const name = await ask("Household name: ");
  if (!name.trim()) {
    console.error("Household name is required.");
    process.exit(1);
  }

  const email = await ask("Owner email: ");
  if (!email.trim()) {
    console.error("Owner email is required.");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const personId = generateId();
  const householdId = generateId();

  const existing = db.prepare("SELECT id FROM persons WHERE email = ?").get(email.trim().toLowerCase());
  if (existing) {
    console.error(`\nError: A person with email "${email.trim().toLowerCase()}" already exists.`);
    process.exit(1);
  }

  db.prepare("INSERT INTO persons (id, email, created_at) VALUES (?, ?, ?)").run(
    personId, email.trim().toLowerCase(), now
  );
  db.prepare("INSERT INTO households (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    householdId, personId, name.trim(), now
  );

  const { pin, expiresAt } = createAuthPin(db, {
    role: "owner",
    personId,
    householdId,
  });

  const expiresDate = new Date(expiresAt).toLocaleDateString();

  console.log(`\n✓ Created household "${name.trim()}"`);
  console.log(`✓ Owner PIN: ${pin}`);
  console.log(`  Expires: ${expiresDate}`);
  console.log(`\nEnter this PIN in the Hearthstone app to sign in as the owner.`);

  rl.close();
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
