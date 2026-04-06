#!/usr/bin/env npx tsx
import { QUESTIONS, type EvalQuestion } from "./questions";
import { runQuestion, closeDb, type Mode, CHAT_MODEL, type TokenUsage } from "./harness";
import { judgeResponse, type JudgeResult, JUDGE_MODEL } from "./judge";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// --- Args ---

const args = process.argv.slice(2);
const ALL_MODES: Mode[] = ["rag", "full"];

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
  usage?: TokenUsage;
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
    usage: evalResult.usage,
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
  console.log(` Chat model: ${CHAT_MODEL} | Judge model: ${JUDGE_MODEL}`);

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

  const fmtTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;

  const tokInRow = modes.map(m => {
    const modeResults = results.filter(r => r.mode === m && r.usage);
    if (modeResults.length === 0) return "—".padStart(8);
    const total = modeResults.reduce((s, r) => s + (r.usage?.promptTokens || 0), 0);
    return fmtTokens(total).padStart(8);
  });
  console.log(`${"Total In Tokens".padEnd(idWidth)}${tokInRow.join("")}`);

  const tokOutRow = modes.map(m => {
    const modeResults = results.filter(r => r.mode === m && r.usage);
    if (modeResults.length === 0) return "—".padStart(8);
    const total = modeResults.reduce((s, r) => s + (r.usage?.completionTokens || 0), 0);
    return fmtTokens(total).padStart(8);
  });
  console.log(`${"Total Out Tokens".padEnd(idWidth)}${tokOutRow.join("")}`);

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
    chatModel: CHAT_MODEL,
    judgeModel: JUDGE_MODEL,
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
      usage: r.usage,
    })),
    summary: Object.fromEntries(modes.map(m => {
      const modeResults = results.filter(r => r.mode === m);
      return [m, {
        avgScore: modeResults.reduce((s, r) => s + r.judge.score, 0) / (modeResults.length || 1),
        totalHallucinations: modeResults.reduce((s, r) => s + r.judge.hallucinationCount, 0),
        avgLatencyMs: modeResults.reduce((s, r) => s + r.latencyMs, 0) / (modeResults.length || 1),
        totalPromptTokens: modeResults.reduce((s, r) => s + (r.usage?.promptTokens || 0), 0),
        totalCompletionTokens: modeResults.reduce((s, r) => s + (r.usage?.completionTokens || 0), 0),
        totalTokens: modeResults.reduce((s, r) => s + (r.usage?.totalTokens || 0), 0),
      }];
    })),
  };

  writeFileSync(path, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${path}`);
}

// --- Main ---

async function main() {
  console.log(`\n🏠 Hearthstone Eval`);
  console.log(`Questions: ${questions.length} | Modes: ${modes.join(", ")} | Concurrency: ${concurrency}`);
  console.log(`Chat model: ${CHAT_MODEL} | Judge model: ${JUDGE_MODEL}\n`);

  const results = await runAll();

  printResults(results);
  saveResults(results);

  closeDb();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
