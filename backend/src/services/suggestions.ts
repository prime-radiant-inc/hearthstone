import type Database from "better-sqlite3";
import { chatComplete, type ChatMessage } from "./chat-provider";
import { generateId } from "../utils";

export async function generateSuggestions(db: Database.Database, householdId: string): Promise<string[]> {
  const chunks = db
    .prepare("SELECT text FROM chunks WHERE household_id = ? ORDER BY document_id, chunk_index")
    .all(householdId) as any[];

  if (chunks.length === 0) return [];

  const sampleText = chunks
    .slice(0, 20)
    .map((c: any) => c.text)
    .join("\n\n---\n\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "You generate suggested questions for household guests.",
    },
    {
      role: "user",
      content: `Given these household documents, what are the 5 most likely questions a guest would ask? Return as a JSON array of short question strings.\n\nDocuments:\n${sampleText}`,
    },
  ];

  const response = await chatComplete(messages);

  try {
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const chips = JSON.parse(match[0]) as string[];
    if (!Array.isArray(chips)) return [];

    const now = new Date().toISOString();
    db.prepare("DELETE FROM suggestions WHERE household_id = ?").run(householdId);
    db.prepare("INSERT INTO suggestions (id, household_id, chips, created_at) VALUES (?, ?, ?, ?)").run(
      generateId(), householdId, JSON.stringify(chips.slice(0, 5)), now
    );

    return chips.slice(0, 5);
  } catch {
    return [];
  }
}

export function getSuggestions(db: Database.Database, householdId: string): string[] {
  const row = db.prepare("SELECT chips FROM suggestions WHERE household_id = ?").get(householdId) as any;
  if (!row) return [];
  try {
    return JSON.parse(row.chips);
  } catch {
    return [];
  }
}
