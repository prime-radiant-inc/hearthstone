# Eval Decisions

The Hearthstone eval harness — what it measures, why it works the way it does, and what it deliberately doesn't try to be. The harness lives under `backend/eval/`. This doc is the conceptual layer; the runnable scripts and per-result JSON are the source of truth for behavior.

## What the eval is

A model-grounded regression harness for the RAG quality of the chat experience. Given a fixed sample household (`refdocs/sample/`), a fixed set of questions, and a chat model, the eval measures: *does the model answer correctly, citing the right facts, without inventing things that aren't in the documents?*

It exists because RAG quality is the product. Hearthstone's promise to a guest is "ask a question about this household and get a grounded answer or a graceful 'I don't know.'" If that promise breaks, the rest of the app is theater. The eval is how we know whether changing a chunker rule, a prompt, an embedding model, or a chat model preserves or breaks that promise.

## What it is *not*

- **Not a CI gate.** Eval runs cost OpenAI tokens and take minutes; running them on every PR would be expensive and slow. Eval is invoked manually when something it would catch has been touched (prompt, chunker, embedding model, retrieval logic, chat model).
- **Not a unit test substitute.** `bun test` covers handlers, contracts, schema, and middleware. The eval covers retrieval+generation quality, which unit tests can't capture.
- **Not a benchmark for score-chasing.** A 100% score on a fixed question set is not the goal; the goal is to detect regressions and to compare alternative prompts/models on roughly equal footing.

## The corpus

Lives in `refdocs/sample/Castillo-Park Household - *.{docx,md}`. Four documents covering a fictional household: emergency/general info, house operations, kid routines and rules, and pets. The `.docx` originals exist alongside `.md` versions so the eval exercises both the pandoc DOCX path and the direct-markdown path.

The household is fictional on purpose. Real household docs are full of personal info we don't want in a public eval, and synthetic data isn't textured enough to be a fair stand-in. Castillo-Park has the *kind* of structure real households have: tables, headings, lists, edge cases like "the trash goes out on Tuesday unless Tuesday is a holiday," and "the dog gets her medication crushed in cheese."

The corpus is committed to the repo (`refdocs/sample/` is excluded from the personal-refdocs gitignore). When the chunker changes, run `bun run reindex` to rebuild embeddings against the current corpus before re-running the eval — otherwise you're measuring the new chunker against the old chunks.

## Question shape

`backend/eval/questions.ts` is gitignored. Each question is an `EvalQuestion`:

```ts
interface EvalQuestion {
  id: string;
  persona: string;          // e.g. "babysitter", "house-sitter"
  question: string;         // the actual user-facing prompt
  keyFacts: string[];       // facts the answer must include
  antiHallucinations?: string[];  // facts that belong to a *different* household and must NOT appear
}
```

A few things to notice about this shape:

- **Key facts, not full answers.** The judge isn't comparing strings; it's checking whether each of N atomic facts appears in the response. This makes the scoring tolerant of phrasing variation and incremental wording changes. "The trash goes out on Tuesday" and "Take the trash to the curb on Tuesday evenings" both score `present` for the fact "trash → Tuesday."
- **Anti-hallucination facts.** Each question can list facts from a *different* fictional household — things the model might confidently invent if the prompt or retrieval is loose. These are scored separately as a hallucination count, not as missing key facts. A model that gets every key fact right but invents two anti-facts is doing something dangerous.
- **Persona.** Tagged but not fed to the model. It's metadata for the human reading the results: "the babysitter questions are the ones the model is failing on."
- **`id`.** Stable IDs let you filter (`bun run eval -- --question q-bedtime`) and let optimizer logs reference specific cases over time.

The question count has grown from ~30 in the initial pass to 39 today. Adding new questions is cheap as long as you write the key facts and anti-hallucinations carefully — the judge only checks what you tell it to check, so a sloppy fact list produces sloppy verdicts.

## Modes: `rag` and `full`

The harness can run each question in two modes:

- **`rag`** — The production retrieval path. Embed the query, KNN against `chunk_embeddings`, take the top chunks, prompt the model with `RAG_SYSTEM` + retrieved chunks + question. This is what real guests get.
- **`full`** — Skip retrieval entirely. Stuff the *entire* household's markdown into the prompt and ask the question against `FULL_SYSTEM`. This is the "ceiling" — what the model can do when it has perfect retrieval.

Comparing the two modes side-by-side is the main diagnostic. If `full` scores 95% and `rag` scores 60%, the chunker or retrieval is broken. If `full` scores 60%, the *prompt* or the *model* is the problem and improving retrieval won't help.

The current RAG baseline against the Castillo-Park corpus is around 99% (per `project_eval_harness` memory; verify against the latest `backend/eval/results/` snapshot before treating as fact). That's not because we're amazing at prompting; it's because the corpus is small, the questions are well-scoped, and `text-embedding-3-small` is more than adequate for this scale.

## Judging

The judge is a separate model invocation, isolated in `backend/eval/judge.ts`. Default model: `gpt-5.4-mini`, overridable via `EVAL_JUDGE_MODEL`. Judge model is intentionally smaller and cheaper than the chat model — it's doing fact extraction, not generation.

The judge prompt instructs the model to score each `keyFact` as one of:

- **`present`** — the fact is clearly stated, with matching numbers/names/details (score: 1)
- **`partial`** — the right concept but vague where specifics were needed, or wrong number (score: 0.5)
- **`absent`** — the fact isn't in the response at all (score: 0)

And each anti-hallucination as:

- **`absent`** — good, the response did not mention this fact
- **`present`** — bad, the response invented something it shouldn't have

The per-question score is `(sum of fact verdicts) / (count of facts)`. Hallucination count is a separate scalar. Both are tracked per-question and per-mode.

The judge runs against the chat model's full response in one pass. Output format is enforced via `response_format: { type: "json_object" }`.

### Why a model judge instead of string matching

String matching against a regex or a substring list would break on the first paraphrase. The whole point of the chat experience is that the model answers in natural language; if the eval can't tolerate paraphrase, the eval is measuring template adherence, not answer correctness.

The risk with a model judge is bias — the same model family judging itself can flatter itself. We mitigate by using a smaller judge model than the chat model, and by treating absolute scores as less interesting than *deltas between runs*. A 90→92 jump on a prompt change is signal; an 88 absolute score on its own is noise.

## Running the eval

```bash
cd backend

# Full run, both modes, all questions
bun run eval

# Single question, both modes
bun run eval -- --question q-trash-pickup

# RAG only
bun run eval -- --mode rag

# What would I run? (no API calls)
bun run eval:dry

# Higher concurrency for speed (default 1, costs more parallelism risk)
bun run eval -- --concurrency 5
```

Output is a stdout table (per-question scores per mode + averages + hallucination counts + latency + token totals) **and** a timestamped JSON snapshot in `backend/eval/results/`. The directory has 100+ snapshots from past runs — they're the audit trail for "did this change improve things or make them worse?"

The snapshot captures the chat model, judge model, modes, every question's response and per-fact verdicts, retrieved doc IDs, latency, and token usage. Diffing two snapshots is the cleanest way to understand what changed between two runs.

## The optimizer

`backend/eval/optimize.ts` is a GEPA-inspired prompt optimizer. The loop:

1. Run the eval with the current `prompt.txt`.
2. Collect per-question diagnostics: which facts were absent or partial, which hallucinations fired.
3. Ask a *proposer* model (default `gpt-5.4`) to propose a mutation of the prompt that targets the failing questions, given the diagnostics.
4. Run the eval again with the candidate prompt.
5. **Pareto check:** keep the candidate only if every question scores ≥ its previous best AND at least one question improves. Pure-average improvements that *regress* a question are rejected.
6. Repeat for `--iterations` rounds (default 10).

Two things to know:

- **Pareto, not average.** Average-improvement optimization is how you get a prompt that's great at the easy questions and terrible at the hard ones. Pareto enforces "no question got worse," which keeps the harness honest. *Reference:* `feedback_eval_design` memory — the user prefers Pareto selection over average.
- **`prompt.backup.txt`** is the safety net. The optimizer copies the current prompt before mutating, so a botched run is `cp prompt.backup.txt prompt.txt` away from being undone.

The `variations/` folder holds prompt persona experiments (`v1-knowledgeable-neighbor`, `v2-concierge`, `v3-house-speaks`, `v4-drill-sergeant`, `v5-empathetic-completionist`, `v6-charlotte`). Each has a base prompt, an optimized version after the optimizer pass, and a log of the optimization run. They're not all in active rotation — they're a record of voices we tried and the eval verdict on each.

## Model comparison

`backend/eval/compare-models.ts` runs the eval against six models — `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano` — and produces a side-by-side comparison. Useful for "could we run on a cheaper model?" decisions and for tracking when a new release of the same model family changes scores.

```bash
bun run eval:compare                              # all six
bun run eval:compare -- --models gpt-5.4,gpt-5.4-mini   # subset
bun run eval:compare -- --concurrency 3
```

Output is the same JSON shape, one file per model, plus a comparison summary.

## Reindexing

`bun run reindex` re-embeds every chunk against the configured embedding model. Run it any time you change:

- The chunker (`services/chunker.ts`)
- The embedding decoration (`buildEmbeddingText` in `chunker.ts`)
- The embedding model (`text-embedding-3-small` in `services/embeddings.ts`)
- The corpus itself

Without a reindex, eval results conflate "old chunks against new prompt" with "new chunks against new prompt." The flag is "expensive but quick to forget" — if eval scores move suddenly, suspect a stale index first.

## Open questions

| Question | Status |
|---|---|
| Different judge models for different question types | Not implemented. Some questions (numeric, table-lookup) might judge more reliably with a specialist model. |
| Per-document evals | Today everything runs against the whole household. There's no way to ask "how does the chat do on just the Pets doc?" without filtering questions by hand. |
| Cost guardrails | A full eval run isn't free. There's no budget cap or warning today. |
| Real (non-fictional) corpora | The eval is locked to Castillo-Park. Adding a second household would help test corpus-shape sensitivity. |
| Deterministic retrieval | Vector search is deterministic in principle but there's no seed control. Hasn't bitten us. |

## Resolved

1. **Key-fact scoring over reference-answer matching.** Tolerant of paraphrase; surfaces partial answers as `partial` (0.5) instead of all-or-nothing. *Why:* the model's freedom to phrase is the point of the chat experience, so the eval has to accept it.
2. **Anti-hallucination tracking as a separate metric.** Hallucinations don't lower the fact score; they're counted on their own axis. *Why:* a 100% answer with one invented detail is still dangerous and we want it to scream, not blend in.
3. **Pareto selection in the optimizer, not average improvement.** *Why:* see `feedback_eval_design` memory — average-improvement loops drift toward prompts that are good on average and brittle on the long tail.
4. **Smaller judge model than chat model.** Default `gpt-5.4-mini` for the judge, `gpt-5.4` for the chat. *Why:* judge is doing structured fact extraction, which a smaller model handles fine; using a peer-or-larger model to judge itself invites flattery bias.
5. **`rag` vs `full` as parallel modes.** Both modes run by default. *Why:* the diff between them is the core diagnostic — it tells you whether retrieval or generation is the failing layer.
6. **Question file gitignored.** `backend/eval/questions.ts` is in `.gitignore`. *Why:* the original eval set leaks personal-document signals from earlier work; the public corpus is intentionally fictional, but the question file's history isn't fully scrubbed. Re-tracking the question file should follow a deliberate cleanup pass.
7. **Snapshot every run.** Every `bun run eval` writes a timestamped JSON to `backend/eval/results/`. *Why:* eval history is what makes "did this change help?" a tractable question. Without it, you're remembering numbers from terminal scrollback.
