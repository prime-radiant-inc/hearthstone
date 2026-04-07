#!/usr/bin/env bun
import { getDb } from "../src/db/connection";
import { createAuthPin } from "../src/services/pins";

const db = getDb();

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
