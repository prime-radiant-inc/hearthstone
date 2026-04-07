# Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable evaluation harness that runs 27 household Q&A questions through 4 retrieval modes (RAG, mRAG, mFRAG, FULL) and scores responses against key facts using an LLM judge.

**Architecture:** Standalone `eval/` directory with 4 files — questions (pure data), harness (retrieval + chat), judge (LLM scoring), runner (orchestrator). Uses the same DB and OpenAI APIs as the CLI but with programmatic (non-streaming) interfaces. No dependency on `src/` services to avoid config requirements (`RESEND_API_KEY`, `JWT_SECRET`) that the eval doesn't need.

**Tech Stack:** TypeScript, better-sqlite3, sqlite-vec, OpenAI SDK (gpt-4o for chat, gpt-4o-mini for judging), bun/tsx for execution.

---

### Task 1: Question Battery

**Files:**
- Create: `eval/questions.ts`

- [ ] **Step 1: Create eval/questions.ts with type definitions and all 27 questions**

```ts
export type Persona =
  | "dog_sitter"
  | "childcare"
  | "house_sitter"
  | "overnight_guest"
  | "long_term_guest"
  | "relative";

export interface EvalQuestion {
  id: string;
  persona: Persona;
  question: string;
  keyFacts: string[];
  antiHallucinations?: string[];
  sourceDoc: string;
}

export const QUESTIONS: EvalQuestion[] = [
  // ── Dog Sitter ──────────────────────────────────────────────

  {
    id: "wifi-password",
    persona: "dog_sitter",
    question: "What's the wifi password?",
    keyFacts: [
      "Network name is Perpetual Pantomime NG",
      "Password is wecanspellcinnamon",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "dog-food-adler",
    persona: "dog_sitter",
    question: "How much food does Adler get and when?",
    keyFacts: [
      "¾ cup of Hill's kibble per meal",
      "½ can of Hills wet food per meal",
      "AM and PM meals are the same base amounts",
      "PM includes 1 crushed dasuquin mixed in",
      "Cut up chicken mixed in",
    ],
    antiHallucinations: ["Fromm", "pumpkin"],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "dog-food-ketch",
    persona: "dog_sitter",
    question: "What does Ketch eat?",
    keyFacts: [
      "Two ¾ cup scoops of Fromm",
      "¼ can of pumpkin mixed in",
      "Chopped chicken mixed in",
      "AM and PM are the same base",
      "PM includes 1 dasuquin crumbled and 1 omega 3 pill",
    ],
    antiHallucinations: ["Hill's"],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "dog-meds-adler",
    persona: "dog_sitter",
    question: "What medications does Adler take?",
    keyFacts: [
      "1 Prozac in the AM",
      "Stuffed in cheese (baby bells)",
    ],
    antiHallucinations: ["baytril", "galliprant"],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "dog-meds-ketch",
    persona: "dog_sitter",
    question: "What medications does Ketch need?",
    keyFacts: [
      "1.5 baytril pills",
      "1 galliprant split in half",
      "Baytril is more important than galliprant",
      "Stuff in cheese or coat in whipped cream",
      "Take with food",
    ],
    antiHallucinations: ["Prozac"],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "dog-trazodone",
    persona: "dog_sitter",
    question: "When do the dogs need trazodone?",
    keyFacts: [
      "Home alone more than 6 hours during the day",
      "Home alone more than 2 hours at night",
      "Give at or up to 60 minutes before departure",
      "Adler gets 1.5 pills",
      "Ketch gets 2 pills",
      "Located in refrigerator door",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "vet-regular",
    persona: "dog_sitter",
    question: "What's the vet's phone number?",
    keyFacts: [
      "Pacifica Pet Hospital",
      "650-359-3685",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "vet-emergency",
    persona: "dog_sitter",
    question: "Where is the emergency vet?",
    keyFacts: [
      "Sage Veterinary Centers",
      "934 Charter St",
      "Redwood City",
      "Adler has been seen there",
      "Card on file",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "dog-rain-protocol",
    persona: "dog_sitter",
    question: "What should I do if it starts raining?",
    keyFacts: [
      "Prop orange dog bed against glass",
      "Open the pool",
      "Pool drain pump near cactus if water level is high",
      "Dog towels in closet near front door",
      "Dog rain jackets in bucket near front door",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "dog-treats-indoor",
    persona: "dog_sitter",
    question: "What treats can I give the dogs inside the house?",
    keyFacts: [
      "Happy howies from the fridge (cut up)",
      "Kiwi treats from dog closet in hallway",
      "Chicken hearts from dog closet (cut small)",
      "Do NOT use london broil indoors",
      "London broil is for walks only",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },

  // ── Childcare / Au Pair ─────────────────────────────────────

  {
    id: "child-nap-schedule",
    persona: "childcare",
    question: "What's Finneas' nap schedule?",
    keyFacts: [
      "Naps for 90-120 minutes",
      "About 5-6 hours after waking up",
      "Needs at least 4 hours between last nap and bedtime",
    ],
    sourceDoc: "Emergency & General Info - Finneas",
  },
  {
    id: "child-favorite-toys",
    persona: "childcare",
    question: "What are Finneas' favorite toys and books?",
    keyFacts: [
      "Woody",
      "Sophie the squeaky Giraffe",
      "Giant ice cream cone",
      "Blue shaky toy",
      "Books: Lady Bug Hug",
      "Books: I Love my Body",
      "Books: Bear Snores",
    ],
    sourceDoc: "Emergency & General Info - Finneas",
  },
  {
    id: "child-pediatrician",
    persona: "childcare",
    question: "Who is Finneas' pediatrician and what's their number?",
    keyFacts: [
      "Dr. Jacqueline Phillips",
      "The Village Doctor",
      "650-851-4747",
      "Available 24/7",
      "2979 Woodside Road, Woodside",
    ],
    sourceDoc: "Emergency & General Info - Finneas",
  },
  {
    id: "child-nearest-er",
    persona: "childcare",
    question: "Where's the nearest ER?",
    keyFacts: [
      "Closest: San Mateo Medical Center",
      "222 W 39th Ave, San Mateo",
      "650-573-2222",
      "Preferred: Stanford Pediatric ER",
      "900 Quarry Road Extension, Palo Alto",
    ],
    sourceDoc: "Emergency & General Info - Finneas",
  },
  {
    id: "child-fall-crying",
    persona: "childcare",
    question: "Finneas fell and is crying, what should I do?",
    keyFacts: [
      "Pause and wait for his reaction first",
      "Pick him up and snuggle him",
      "Tell him you saw what happened",
      "If surprised, tell him it was surprising",
      "If it looks like it hurt, say it looks like it hurt",
      "If won't stop crying after 10 minutes, contact a parent",
    ],
    sourceDoc: "Emergency & General Info - Finneas",
  },
  {
    id: "childcare-schedule-april",
    persona: "childcare",
    question: "What's the work schedule starting April 7th?",
    keyFacts: [
      "Monday 8AM-4PM",
      "Tuesday 1PM-8PM",
      "Wednesday 8AM-4PM",
      "Thursday 1PM-8PM",
      "Friday 8AM-4PM",
    ],
    sourceDoc: "Scheduling & Daily Tasks with Finneas",
  },
  {
    id: "childcare-preschool-pickup",
    persona: "childcare",
    question: "What's the preschool pickup routine?",
    keyFacts: [
      "Tuesdays and Thursdays",
      "Preschool runs about 8AM to 3:30 or 4PM",
      "Last pickup is 4:45",
      "Have snack or milk ready for the car",
      "Set up activity stations at home before leaving for pickup",
      "Calm re-entry: snack then quiet play then dinner",
    ],
    sourceDoc: "Scheduling & Daily Tasks with Finneas",
  },
  {
    id: "childcare-naptime-tasks",
    persona: "childcare",
    question: "What should I do during Finneas' nap time?",
    keyFacts: [
      "Baby laundry and dishes",
      "Put away toys and books",
      "Reset play areas and play table",
      "Wipe down toys periodically",
      "Vacuum his room (once a week max)",
      "Put away or reload dishwasher",
      "Add items to shared grocery list",
    ],
    sourceDoc: "Scheduling & Daily Tasks with Finneas",
  },
  {
    id: "childcare-emergency-contact-order",
    persona: "childcare",
    question: "Who should I contact first if something comes up on a Tuesday?",
    keyFacts: [
      "Contact Matt first on Tuesdays",
      "All other days contact Alexis first",
      "If emergency, call both",
      "Alexis sometimes has Do Not Disturb on",
      "Calling twice in a row pushes through DND",
    ],
    sourceDoc: "Scheduling & Daily Tasks with Finneas",
  },
  {
    id: "child-screen-time",
    persona: "childcare",
    question: "Is screen time allowed for Finneas?",
    keyFacts: [
      "No screen time",
      "If you use your phone near him, make sure he can't see the screen",
    ],
    sourceDoc: "Emergency & General Info - Finneas",
  },

  // ── House / Overnight Guest ────────────────────────────────

  {
    id: "house-entry",
    persona: "house_sitter",
    question: "How do I get into the house?",
    keyFacts: [
      "Enter through the garage",
      "Code is last 4 digits of your phone number",
      "Enter and exit through the garage",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "house-hvac",
    persona: "overnight_guest",
    question: "How do I control the heating and cooling?",
    keyFacts: [
      "Use Comfort app on the iPhone",
      "iPhone is on the green credenza in the dining room",
      "Splits turn off automatically every morning at 0900",
      "Remote: press yellow button then arrows to adjust",
      "One light on split means it's on and at target temp",
      "Two lights means it's working to reach target temp",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "house-trash",
    persona: "house_sitter",
    question: "When is trash day?",
    keyFacts: [
      "Tuesday night put cans to the curb",
      "Wednesday mid-day or evening bring them back in",
      "Trash cans are just outside the garage",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "house-lights",
    persona: "overnight_guest",
    question: "How do I control the lights?",
    keyFacts: [
      "iPhone on the green credenza",
      "Do not touch any switches",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },

  // ── Multi-hop / Scenario ───────────────────────────────────

  {
    id: "scenario-leaving-3hrs-night",
    persona: "dog_sitter",
    question: "I need to leave the house for 3 hours tonight. What do I need to do for the dogs?",
    keyFacts: [
      "Give trazodone (Adler 1.5 pills, Ketch 2 pills)",
      "Give 60 minutes before leaving",
      "Turn on Spa Music on the Sonos",
      "Close dogs in the bedroom",
      "Make sure they have fresh water",
      "Make sure they've pottied",
      "40 minute walk beforehand",
      "Leave bedroom light on",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
  {
    id: "scenario-teething-fussy",
    persona: "childcare",
    question: "Finneas seems to be teething and is very fussy. What should I do?",
    keyFacts: [
      "Cold teether from the fridge (pineapple or apple shape)",
      "Teether straws or chews",
      "Popsicle chew in silicone ring pop holder",
      "BIBS pacifier can help manage frustration",
      "Talk to parents about medication (Tylenol or Motrin)",
    ],
    sourceDoc: "Emergency & General Info - Finneas",
  },
  {
    id: "scenario-dog-reactivity",
    persona: "dog_sitter",
    question: "A dog across the street is barking and my dogs are pulling and barking. What do I do?",
    keyFacts: [
      "Hide behind a car if one is available",
      "Treat party / find it on the ground",
      "Let's Go - emergency u-turn",
      "Quick quick to move faster",
      "Increase distance from the other dog",
      "Use front clip harness / leash management to keep moving",
    ],
    sourceDoc: "2024- Staying With Adler Ketch",
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add eval/questions.ts
git commit -m "eval: add question battery with 27 key-fact questions across 5 personas"
```

---

### Task 2: Eval Harness — Retrieval + Chat

**Files:**
- Create: `eval/harness.ts`

This file handles DB setup, embedding, search, query expansion, and running each retrieval mode. It mirrors the logic in `cli-chat.ts` but returns structured results instead of streaming to stdout.

- [ ] **Step 1: Create eval/harness.ts**

```ts
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import OpenAI from "openai";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// --- Env loading (same approach as cli-chat.ts) ---

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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in backend/.env");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- Types ---

export type Mode = "rag" | "mrag" | "mfrag" | "full";

export interface EvalResult {
  questionId: string;
  mode: Mode;
  response: string;
  retrievedDocs: string[];
  retrievedChunkCount?: number;
  latencyMs: number;
}

interface DocChunk {
  documentTitle: string;
  documentId: string;
  chunkIndex: number;
  text: string;
}

interface Doc {
  id: string;
  title: string;
  markdown: string;
}

// --- Database ---

const dbPath = resolve(import.meta.dirname, "..", "hearthstone.db");
const db = new Database(dbPath, { readonly: true });
sqliteVec.load(db);

// --- Data loading ---

function loadAllChunks(): DocChunk[] {
  return (db.prepare(`
    SELECT c.document_id, c.chunk_index, c.text, d.title as document_title
    FROM chunks c JOIN documents d ON d.id = c.document_id
    ORDER BY d.title, c.chunk_index
  `).all() as any[]).map(r => ({
    documentTitle: r.document_title,
    documentId: r.document_id,
    chunkIndex: r.chunk_index,
    text: r.text,
  }));
}

function loadAllDocs(): Doc[] {
  return db.prepare("SELECT id, title, markdown FROM documents ORDER BY title").all() as any[];
}

// --- Embedding + Search ---

async function embedText(text: string): Promise<number[]> {
  const resp = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
  return resp.data[0].embedding;
}

function searchChunks(queryEmbedding: Float32Array, limit: number = 5): DocChunk[] {
  const rows = db.prepare(`
    SELECT ce.chunk_id, ce.distance FROM chunk_embeddings ce
    WHERE ce.embedding MATCH ? AND k = ? ORDER BY ce.distance
  `).all(Buffer.from(queryEmbedding.buffer), limit) as any[];

  const chunks = loadAllChunks();
  const chunkMap = new Map(chunks.map(c => [`${c.documentId}-${c.chunkIndex}`, c]));

  return rows
    .map(r => {
      const chunk = db.prepare("SELECT document_id, chunk_index FROM chunks WHERE id = ?").get(r.chunk_id) as any;
      if (!chunk) return null;
      return chunkMap.get(`${chunk.document_id}-${chunk.chunk_index}`) ?? null;
    })
    .filter((c): c is DocChunk => c !== null);
}

// --- Query expansion ---

async function expandQuery(query: string): Promise<string[]> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{
      role: "system",
      content: `You expand search queries for a household knowledge base (home info, pet care, childcare, emergency contacts, schedules).

Given the question, generate 3-5 diverse search queries. Think about:
- Synonyms (doctor → pediatrician, physician, medical)
- What section might contain this (emergency contacts, vet info)
- Implicit context (baby's doctor → pediatrician, medical contacts)

Return ONLY a JSON array of strings.`
    }, {
      role: "user",
      content: `Question: "${query}"`
    }],
    temperature: 0.3,
  });

  try {
    const text = resp.choices[0]?.message?.content || "[]";
    const queries = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || "[]") as string[];
    return [query, ...queries];
  } catch {
    return [query];
  }
}

// --- Prompts (same as cli-chat.ts) ---

const CHAT_STYLE = `Response style:
- You're a knowledgeable friend, not a search engine. A babysitter at 10pm needs quick, clear answers.
- Lead with the answer. No preamble, no "According to the document..."
- Bold key details: names, phone numbers, times, addresses.
- Bullet points for lists. Keep it short.
- Do not mention document titles in your answer.
- Do not invent names, numbers, or details. Ever.`;

const HELPFULNESS = `If the documents don't directly answer the question but contain clearly relevant information (emergency contacts, vet numbers, related procedures), share what IS there and briefly note what's not covered. Be helpful, not rigid — a question about a sick pet deserves the vet's number even if there's no "sick pet protocol."

Only say "I don't have that information in the household docs" if the documents contain genuinely nothing relevant.`;

const RAG_SYSTEM = `You are a helpful household assistant. Answer using ONLY the provided excerpts. Do not make up information.

${CHAT_STYLE}
${HELPFULNESS}

After your answer, on a new line: Sources: [1], [3]

Document excerpts:
`;

const FULL_SYSTEM = `You are a helpful household assistant. Answer using ONLY the provided documents. Do not make up information.

${CHAT_STYLE}
${HELPFULNESS}

After your answer, on a new line: Sources: "Document Title"

Household documents:
`;

// --- Chat (non-streaming) ---

async function chatComplete(systemContent: string, question: string): Promise<string> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: question },
    ],
  });
  return resp.choices[0]?.message?.content || "";
}

// --- Unique doc names helper ---

function uniqueDocNames(chunks: DocChunk[]): string[] {
  const seen = new Set<string>();
  return chunks.filter(r => {
    if (seen.has(r.documentTitle)) return false;
    seen.add(r.documentTitle);
    return true;
  }).map(r => r.documentTitle);
}

// --- Mode runners ---

const allChunks = loadAllChunks();
const allDocs = loadAllDocs();
const fullContextDoc = allDocs
  .map(d => `--- Document: "${d.title}" ---\n\n${d.markdown}`)
  .join("\n\n" + "=".repeat(40) + "\n\n");

async function runRag(question: string): Promise<EvalResult & { _chunks: DocChunk[] }> {
  const start = Date.now();
  const emb = await embedText(question);
  const results = searchChunks(new Float32Array(emb), 5);
  const context = results.map((r, i) => `[${i + 1}] (from "${r.documentTitle}")\n${r.text}`).join("\n\n---\n\n");
  const response = await chatComplete(RAG_SYSTEM + context, question);
  return {
    questionId: "",
    mode: "rag",
    response,
    retrievedDocs: uniqueDocNames(results),
    retrievedChunkCount: results.length,
    latencyMs: Date.now() - start,
    _chunks: results,
  };
}

async function runMrag(question: string): Promise<EvalResult> {
  const start = Date.now();
  const expanded = await expandQuery(question);
  const seen = new Set<string>();
  const allResults: DocChunk[] = [];
  for (const q of expanded) {
    const results = searchChunks(new Float32Array(await embedText(q)), 3);
    for (const r of results) {
      const key = `${r.documentId}-${r.chunkIndex}`;
      if (!seen.has(key)) { seen.add(key); allResults.push(r); }
    }
  }
  const top = allResults.slice(0, 10);
  const context = top.map((r, i) => `[${i + 1}] (from "${r.documentTitle}")\n${r.text}`).join("\n\n---\n\n");
  const response = await chatComplete(RAG_SYSTEM + context, question);
  return {
    questionId: "",
    mode: "mrag",
    response,
    retrievedDocs: uniqueDocNames(top),
    retrievedChunkCount: top.length,
    latencyMs: Date.now() - start,
  };
}

async function runMfrag(question: string): Promise<EvalResult> {
  const start = Date.now();
  const expanded = await expandQuery(question);
  const docHits = new Map<string, number>();
  for (const q of expanded) {
    const results = searchChunks(new Float32Array(await embedText(q)), 3);
    for (const r of results) {
      docHits.set(r.documentId, (docHits.get(r.documentId) || 0) + 1);
    }
  }
  const selectedDocs = [...docHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => allDocs.find(d => d.id === id))
    .filter((d): d is Doc => d !== null);

  const context = selectedDocs
    .map(d => `--- Document: "${d.title}" ---\n\n${d.markdown}`)
    .join("\n\n" + "=".repeat(40) + "\n\n");

  const response = await chatComplete(FULL_SYSTEM + context, question);
  return {
    questionId: "",
    mode: "mfrag",
    response,
    retrievedDocs: selectedDocs.map(d => d.title),
    latencyMs: Date.now() - start,
  };
}

async function runFull(question: string): Promise<EvalResult> {
  const start = Date.now();
  const response = await chatComplete(FULL_SYSTEM + fullContextDoc, question);
  return {
    questionId: "",
    mode: "full",
    response,
    retrievedDocs: allDocs.map(d => d.title),
    latencyMs: Date.now() - start,
  };
}

// --- Public API ---

const MODE_RUNNERS: Record<Mode, (q: string) => Promise<EvalResult>> = {
  rag: runRag,
  mrag: runMrag,
  mfrag: runMfrag,
  full: runFull,
};

export async function runQuestion(question: string, mode: Mode, questionId: string): Promise<EvalResult> {
  const result = await MODE_RUNNERS[mode](question);
  result.questionId = questionId;
  return result;
}

export function closeDb() {
  db.close();
}
```

- [ ] **Step 2: Commit**

```bash
git add eval/harness.ts
git commit -m "eval: add retrieval harness — 4 modes, programmatic output"
```

---

### Task 3: LLM Judge

**Files:**
- Create: `eval/judge.ts`

The judge sends each response + key facts to gpt-4o-mini and gets back a structured JSON verdict.

- [ ] **Step 1: Create eval/judge.ts**

```ts
import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load env (same as harness — both files can be run independently)
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface FactVerdict {
  fact: string;
  verdict: "present" | "partial" | "absent";
}

export interface AntiHallucinationVerdict {
  fact: string;
  verdict: "absent" | "present";
}

export interface JudgeResult {
  questionId: string;
  mode: string;
  facts: FactVerdict[];
  antiHallucinations: AntiHallucinationVerdict[];
  score: number;
  hallucinationCount: number;
}

const JUDGE_PROMPT = `You are a strict factual judge for a household Q&A system. You will be given:
1. A question that was asked
2. The system's response
3. A list of key facts that SHOULD appear in the response
4. A list of anti-hallucination facts that should NOT appear (they belong to a different context)

For each key fact, judge whether it is:
- "present": The fact is clearly stated in the response (exact numbers, names, details match)
- "partial": The fact is partially present (e.g., right concept but wrong number, or vague where specifics were needed)
- "absent": The fact is not mentioned at all

For each anti-hallucination fact, judge whether it is:
- "absent": Good — the response does not mention this (correct behavior)
- "present": Bad — the response incorrectly includes this fact

Return ONLY valid JSON in this exact format:
{
  "facts": [{"fact": "...", "verdict": "present|partial|absent"}, ...],
  "antiHallucinations": [{"fact": "...", "verdict": "absent|present"}, ...]
}`;

export async function judgeResponse(
  questionId: string,
  mode: string,
  question: string,
  response: string,
  keyFacts: string[],
  antiHallucinations: string[] = [],
): Promise<JudgeResult> {
  const userContent = `Question: "${question}"

Response:
"""
${response}
"""

Key facts to check:
${keyFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")}

${antiHallucinations.length > 0
    ? `Anti-hallucination facts (should NOT appear):\n${antiHallucinations.map((f, i) => `${i + 1}. ${f}`).join("\n")}`
    : "No anti-hallucination facts to check."}`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: JUDGE_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const raw = JSON.parse(resp.choices[0]?.message?.content || "{}");

  const facts: FactVerdict[] = (raw.facts || []).map((f: any) => ({
    fact: f.fact,
    verdict: f.verdict,
  }));

  const antiHallucinationResults: AntiHallucinationVerdict[] = (raw.antiHallucinations || []).map((f: any) => ({
    fact: f.fact,
    verdict: f.verdict,
  }));

  // Score: present=1, partial=0.5, absent=0
  const totalFacts = facts.length || 1;
  const factScore = facts.reduce((sum, f) => {
    if (f.verdict === "present") return sum + 1;
    if (f.verdict === "partial") return sum + 0.5;
    return sum;
  }, 0);

  const hallucinationCount = antiHallucinationResults.filter(a => a.verdict === "present").length;

  return {
    questionId,
    mode,
    facts,
    antiHallucinations: antiHallucinationResults,
    score: factScore / totalFacts,
    hallucinationCount,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add eval/judge.ts
git commit -m "eval: add LLM-as-judge with key fact scoring"
```

---

### Task 4: Runner — Orchestrator + Output

**Files:**
- Create: `eval/run.ts`

The main entry point. Runs all questions through all modes, judges each, and outputs results.

- [ ] **Step 1: Create eval/run.ts**

```ts
#!/usr/bin/env npx tsx
import { QUESTIONS, type EvalQuestion } from "./questions";
import { runQuestion, closeDb, type Mode } from "./harness";
import { judgeResponse, type JudgeResult } from "./judge";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// --- Args ---

const args = process.argv.slice(2);
const ALL_MODES: Mode[] = ["rag", "mrag", "mfrag", "full"];

function getArg(name: string): string | undefined {
  const flag = `--${name}=`;
  const found = args.find(a => a.startsWith(flag));
  if (found) return found.slice(flag.length);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

const modeFilter = getArg("mode") as Mode | undefined;
const questionFilter = getArg("question");
const dryRun = args.includes("--dry-run");
const concurrency = parseInt(getArg("concurrency") || "1", 10);

const modes = modeFilter ? [modeFilter] : ALL_MODES;
const questions = questionFilter
  ? QUESTIONS.filter(q => q.id === questionFilter)
  : QUESTIONS;

if (questions.length === 0) {
  console.error(`No question found matching: ${questionFilter}`);
  console.error(`Available: ${QUESTIONS.map(q => q.id).join(", ")}`);
  process.exit(1);
}

// --- Dry run ---

if (dryRun) {
  console.log(`\n📋 Eval: ${questions.length} questions × ${modes.length} modes = ${questions.length * modes.length} runs\n`);
  for (const q of questions) {
    console.log(`  ${q.id} (${q.persona})`);
    console.log(`    Q: ${q.question}`);
    console.log(`    Facts: ${q.keyFacts.length}${q.antiHallucinations?.length ? `, Anti: ${q.antiHallucinations.length}` : ""}`);
  }
  process.exit(0);
}

// --- Run ---

interface RunResult {
  question: EvalQuestion;
  mode: Mode;
  response: string;
  retrievedDocs: string[];
  latencyMs: number;
  judge: JudgeResult;
}

async function runOne(question: EvalQuestion, mode: Mode): Promise<RunResult> {
  const evalResult = await runQuestion(question.question, mode, question.id);
  const judge = await judgeResponse(
    question.id,
    mode,
    question.question,
    evalResult.response,
    question.keyFacts,
    question.antiHallucinations,
  );
  return {
    question,
    mode,
    response: evalResult.response,
    retrievedDocs: evalResult.retrievedDocs,
    latencyMs: evalResult.latencyMs,
    judge,
  };
}

async function runAll(): Promise<RunResult[]> {
  const total = questions.length * modes.length;
  let completed = 0;
  const results: RunResult[] = [];

  // Build work items
  const work: { question: EvalQuestion; mode: Mode }[] = [];
  for (const question of questions) {
    for (const mode of modes) {
      work.push({ question, mode });
    }
  }

  // Execute with concurrency
  const executing = new Set<Promise<void>>();
  for (const item of work) {
    const p = (async () => {
      const result = await runOne(item.question, item.mode);
      results.push(result);
      completed++;
      const pct = Math.round((completed / total) * 100);
      const scoreStr = `${Math.round(result.judge.score * 100)}%`;
      const halStr = result.judge.hallucinationCount > 0
        ? ` ⚠ ${result.judge.hallucinationCount} hallucination(s)`
        : "";
      process.stderr.write(
        `\r  [${completed}/${total}] ${pct}% — ${item.question.id} / ${item.mode}: ${scoreStr}${halStr}    `
      );
    })();

    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);

  process.stderr.write("\n");
  return results;
}

// --- Output formatting ---

function printResults(results: RunResult[]) {
  // Per-question table
  console.log("\n" + "=".repeat(80));
  console.log(" EVAL RESULTS");
  console.log("=".repeat(80));

  // Header
  const idWidth = Math.max(30, ...questions.map(q => q.id.length + 2));
  const header = "Question".padEnd(idWidth) + modes.map(m => m.toUpperCase().padStart(8)).join("");
  console.log(`\n${header}`);
  console.log("-".repeat(header.length));

  // Group results by question
  const byQuestion = new Map<string, Map<Mode, RunResult>>();
  for (const r of results) {
    if (!byQuestion.has(r.question.id)) byQuestion.set(r.question.id, new Map());
    byQuestion.get(r.question.id)!.set(r.mode, r);
  }

  for (const q of questions) {
    const modeResults = byQuestion.get(q.id);
    if (!modeResults) continue;

    const cells = modes.map(m => {
      const r = modeResults.get(m);
      if (!r) return "—".padStart(8);
      const present = r.judge.facts.filter(f => f.verdict === "present").length;
      const partial = r.judge.facts.filter(f => f.verdict === "partial").length;
      const total = r.judge.facts.length;
      const halMark = r.judge.hallucinationCount > 0 ? "!" : " ";
      const partialMark = partial > 0 ? `+${partial}` : "";
      return `${present}${partialMark}/${total}${halMark}`.padStart(8);
    });

    console.log(`${q.id.padEnd(idWidth)}${cells.join("")}`);
  }

  // Summary
  console.log("-".repeat(header.length));

  const summaryRow = modes.map(m => {
    const modeResults = results.filter(r => r.mode === m);
    if (modeResults.length === 0) return "—".padStart(8);
    const avg = modeResults.reduce((s, r) => s + r.judge.score, 0) / modeResults.length;
    return `${Math.round(avg * 100)}%`.padStart(8);
  });
  console.log(`${"Average Score".padEnd(idWidth)}${summaryRow.join("")}`);

  const halRow = modes.map(m => {
    const modeResults = results.filter(r => r.mode === m);
    const total = modeResults.reduce((s, r) => s + r.judge.hallucinationCount, 0);
    return `${total}`.padStart(8);
  });
  console.log(`${"Hallucinations".padEnd(idWidth)}${halRow.join("")}`);

  const latRow = modes.map(m => {
    const modeResults = results.filter(r => r.mode === m);
    if (modeResults.length === 0) return "—".padStart(8);
    const avg = modeResults.reduce((s, r) => s + r.latencyMs, 0) / modeResults.length;
    return `${(avg / 1000).toFixed(1)}s`.padStart(8);
  });
  console.log(`${"Avg Latency".padEnd(idWidth)}${latRow.join("")}`);

  console.log("=".repeat(80));
  console.log(`\nLegend: 3/5 = 3 of 5 facts present, +1 = partial matches, ! = hallucination detected\n`);
}

function saveResults(results: RunResult[]) {
  const dir = resolve(import.meta.dirname, "results");
  mkdirSync(dir, { recursive: true });

  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const path = resolve(dir, `${stamp}.json`);

  const output = {
    timestamp: now.toISOString(),
    modes,
    questionCount: questions.length,
    results: results.map(r => ({
      questionId: r.question.id,
      persona: r.question.persona,
      question: r.question.question,
      mode: r.mode,
      response: r.response,
      retrievedDocs: r.retrievedDocs,
      latencyMs: r.latencyMs,
      score: r.judge.score,
      hallucinationCount: r.judge.hallucinationCount,
      facts: r.judge.facts,
      antiHallucinations: r.judge.antiHallucinations,
    })),
    summary: Object.fromEntries(modes.map(m => {
      const modeResults = results.filter(r => r.mode === m);
      return [m, {
        avgScore: modeResults.reduce((s, r) => s + r.judge.score, 0) / (modeResults.length || 1),
        totalHallucinations: modeResults.reduce((s, r) => s + r.judge.hallucinationCount, 0),
        avgLatencyMs: modeResults.reduce((s, r) => s + r.latencyMs, 0) / (modeResults.length || 1),
      }];
    })),
  };

  writeFileSync(path, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${path}`);
}

// --- Main ---

async function main() {
  console.log(`\n🏠 Hearthstone Eval`);
  console.log(`Questions: ${questions.length} | Modes: ${modes.join(", ")} | Concurrency: ${concurrency}\n`);

  const results = await runAll();

  printResults(results);
  saveResults(results);

  closeDb();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add eval/run.ts
git commit -m "eval: add runner — orchestrates questions, judges, outputs scorecard"
```

---

### Task 5: Package Script + .gitignore + Smoke Test

**Files:**
- Modify: `package.json` — add `eval` script
- Create: `eval/results/.gitkeep`

- [ ] **Step 1: Add eval script to package.json**

Add to the `"scripts"` section:

```json
"eval": "npx tsx eval/run.ts",
"eval:dry": "npx tsx eval/run.ts --dry-run"
```

- [ ] **Step 2: Create eval/results/.gitkeep and add results/ to .gitignore**

Create `eval/results/.gitkeep` (empty file).

Append to `.gitignore` (create if it doesn't exist in backend/):

```
eval/results/*.json
```

- [ ] **Step 3: Run dry-run to verify questions load**

Run: `cd /Users/mw/Code/mhat/hearthstone/backend && bun run eval:dry`

Expected output:
```
📋 Eval: 27 questions × 4 modes = 108 runs

  wifi-password (dog_sitter)
    Q: What's the wifi password?
    Facts: 2
  dog-food-adler (dog_sitter)
    Q: How much food does Adler get and when?
    Facts: 5, Anti: 2
  ...
```

- [ ] **Step 4: Run single-question smoke test**

Run: `cd /Users/mw/Code/mhat/hearthstone/backend && bun run eval -- --question wifi-password --mode full`

Expected: Should complete, show 1 result row, save a JSON file. Verify the response contains the wifi password and the judge scores it.

- [ ] **Step 5: Commit**

```bash
git add package.json eval/results/.gitkeep .gitignore
git commit -m "eval: wire up bun run eval script, gitignore results"
```
