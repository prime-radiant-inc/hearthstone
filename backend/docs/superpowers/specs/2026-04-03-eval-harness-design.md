# Hearthstone Eval Harness — Design Spec

## Purpose

Measure which retrieval strategy (RAG, mRAG, mFRAG, FULL) best surfaces correct information from Hearthstone's household document corpus. The harness runs a battery of questions through each mode, judges responses against key facts, and produces a scorecard. Designed for repeated runs as prompts and retrieval are tuned.

## Corpus

Three documents:

| Document | Content | ~Tokens |
|---|---|---|
| Staying With Adler Ketch | Dog care: food, meds, walks, reactivity, house rules, rain protocol | ~5,500 |
| Emergency & General Info - Finneas | Baby info, emergency contacts, medical, home info, soothing | ~2,800 |
| Scheduling & Daily Tasks with Finneas | Au pair schedule, compensation, daily tasks, activities, communication | ~3,200 |

## Question Battery

~25 questions grouped by guest persona. Each question defines:

```ts
interface EvalQuestion {
  id: string;                    // e.g. "dog-meds-ketch"
  persona: Persona;              // who would ask this
  question: string;              // the natural language question
  keyFacts: string[];            // facts that MUST appear in a correct answer
  antiHallucinations?: string[]; // facts that must NOT appear (from other contexts)
  sourceDoc: string;             // primary document(s) containing the answer
}

type Persona =
  | "dog_sitter"
  | "childcare"
  | "house_sitter"
  | "overnight_guest"
  | "long_term_guest"
  | "relative";
```

### Persona Coverage

**Dog Sitter (8-10 questions)**
- Feeding amounts per dog, medication schedules, vet contacts, trazodone rules, reactivity management, potty schedule, leaving-home protocol, rain protocol, treat rules (london broil outdoors only)

**Childcare / Au Pair (8-10 questions)**
- Nap schedule, feeding schedule, soothing techniques, pediatrician contact, nearest ER, preschool pickup routine, nap-time tasks, who to contact on Tuesdays, favorite toys/books, screen time rules

**House / Overnight Guest (4-5 questions)**
- Wifi password, HVAC operation, trash schedule, how to enter the house, lights control

**Multi-hop / Scenario (3-4 questions)**
- "Leaving for 3 hours at night" (dogs: trazodone + sonos + bedroom + potty)
- "Finneas is teething and won't stop crying" (teether + pacifier + contact parents about meds)
- "Dog is barking at neighbor's dog" (recall + treat + management techniques)
- "Ketch won't eat his food" (put away, try later, mix with chicken/pumpkin)

### Calibration Process

1. Sokka drafts all questions with key facts
2. Matt reviews and adjusts key facts
3. Run the eval, inspect failures, refine fact definitions
4. Repeat until the eval reliably distinguishes mode quality

## Architecture

```
eval/
  questions.ts    — question battery (pure data)
  harness.ts      — retrieval + chat execution per mode
  judge.ts        — LLM-as-judge scoring
  run.ts          — orchestrator + output formatting
  results/        — timestamped JSON output per run
```

### eval/questions.ts

Exports an array of `EvalQuestion` objects. Pure data, no logic. Easy to add/edit/remove questions.

### eval/harness.ts

For each (question, mode) pair:

1. **RAG**: Embed query → vector search top-5 chunks → chat
2. **mRAG**: Expand query → embed each → union top-10 chunks → chat
3. **mFRAG**: Expand query → embed each → identify docs by chunk hits → full doc context → chat
4. **FULL**: All documents as context → chat

Reuses the same DB, embedding, search, and prompt logic as `cli-chat.ts`. Shared code extracted to `src/` where practical. Returns non-streaming text responses.

```ts
interface EvalResult {
  questionId: string;
  mode: Mode;
  response: string;
  retrievedDocs: string[];      // which docs were in context
  retrievedChunkCount?: number; // for RAG/mRAG modes
  latencyMs: number;
}
```

### eval/judge.ts

Sends each response to gpt-4o-mini with a structured judging prompt:

```
Given this response to a household Q&A question, check each key fact.
For each fact, respond: "present", "partial", or "absent".
For each anti-hallucination, respond: "absent" (good) or "present" (bad).
Return JSON only.
```

```ts
interface JudgeResult {
  questionId: string;
  mode: Mode;
  facts: Record<string, "present" | "partial" | "absent">;
  antiHallucinations: Record<string, "absent" | "present">;
  score: number;           // facts_present / total_facts (partial = 0.5)
  hallucinationCount: number;
}
```

### eval/run.ts

Entry point. Orchestrates the full pipeline:

1. Load questions and DB
2. For each question × mode: run harness, then judge
3. Output per-question results table
4. Output summary table (mode × avg score, avg hallucinations)
5. Save full results to `eval/results/YYYY-MM-DD-HHmm.json`

**CLI flags:**
- `--mode rag` — run single mode only
- `--question dog-meds-ketch` — run single question only
- `--dry-run` — show questions without calling OpenAI
- `--concurrency N` — parallel question execution (default: 1, sequential)

**Output format (terminal):**

```
Question                    | RAG  | mRAG | mFRAG | FULL
----------------------------|------|------|-------|-----
dog-food-adler              | 3/4  | 4/4  | 4/4   | 4/4
dog-meds-ketch              | 2/4  | 3/4  | 4/4   | 4/4
child-pediatrician          | 0/3  | 2/3  | 3/3   | 3/3
...
----------------------------|------|------|-------|-----
Average                     | 0.62 | 0.78 | 0.91  | 0.95
Hallucinations              | 2    | 1    | 0     | 0
```

## Cost and Performance

- ~25 questions × 4 modes = 100 chat completions (gpt-4o) + 100 judge calls (gpt-4o-mini)
- Estimated cost: $1-2 per full run
- Estimated time: 3-5 minutes sequential, faster with concurrency

## Out of Scope

- Web UI or dashboard — terminal + JSON is sufficient
- Automatic prompt tuning — that's phase (b), manual and collaborative
- Statistical significance — 25 questions gives qualitative signal, not p-values
- Conversation history / multi-turn — each question is independent (for now)

## Implementation Plan

To be generated via writing-plans skill after spec approval.
