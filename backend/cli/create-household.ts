#!/usr/bin/env bun
import { createInterface } from "node:readline";
import { getDb } from "../src/db/connection";
import { generateId } from "../src/utils";
import { createAuthPin } from "../src/services/pins";
import { config } from "../src/config";

const db = getDb();

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
  db.prepare("INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)").run(
    householdId, name.trim(), now
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
  console.log(`  Join URL: ${config.hearthstonePublicUrl}/join/${pin}`);
  console.log(`\nOpen the Join URL on the new owner's phone to sign in.`);

  rl.close();
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
