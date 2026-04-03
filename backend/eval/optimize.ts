#!/usr/bin/env npx tsx
/**
 * Prompt optimizer for Hearthstone eval.
 *
 * Uses GEPA-inspired approach: run eval, collect per-question diagnostics (ASI),
 * ask a proposer LLM to mutate the prompt, keep if Pareto-improving
 * (any question improved, no question degraded).
 *
 * Usage:
 *   bun run optimize                    # default 10 iterations
 *   bun run optimize -- --iterations 20
 *   bun run optimize -- --mode mfrag    # optimize for a specific mode
 */

import { QUESTIONS } from "./questions";
import { runQuestion, closeDb, type Mode, CHAT_MODEL } from "./harness";
import { judgeResponse, type JudgeResult, JUDGE_MODEL } from "./judge";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";

// --- Env ---
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
const PROPOSER_MODEL = process.env.EVAL_PROPOSER_MODEL || "gpt-4o";

// --- Args ---
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const flag = `--${name}=`;
  const found = args.find(a => a.startsWith(flag));
  if (found) return found.slice(flag.length);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

const maxIterations = parseInt(getArg("iterations") || "10", 10);
const evalMode: Mode = (getArg("mode") as Mode) || "full";

// --- Paths ---
const promptPath = resolve(import.meta.dirname, "prompt.txt");
const backupPath = resolve(import.meta.dirname, "prompt.backup.txt");

// --- Types ---
interface QuestionScore {
  questionId: string;
  score: number;
  hallucinationCount: number;
  absentFacts: string[];
  partialFacts: string[];
  response: string;
}

// --- Eval runner ---
async function runEval(mode: Mode): Promise<QuestionScore[]> {
  const results: QuestionScore[] = [];

  for (const q of QUESTIONS) {
    const evalResult = await runQuestion(q.question, mode, q.id);
    const judge = await judgeResponse(
      q.id, mode, q.question, evalResult.response,
      q.keyFacts, q.antiHallucinations,
    );

    results.push({
      questionId: q.id,
      score: judge.score,
      hallucinationCount: judge.hallucinationCount,
      absentFacts: judge.facts.filter(f => f.verdict === "absent").map(f => f.fact),
      partialFacts: judge.facts.filter(f => f.verdict === "partial").map(f => f.fact),
      response: evalResult.response,
    });
  }

  return results;
}

function avgScore(results: QuestionScore[]): number {
  return results.reduce((s, r) => s + r.score, 0) / results.length;
}

// --- Pareto comparison ---
// Returns true if candidate is a Pareto improvement: at least one question
// improved and no question got worse.
function isParetoImprovement(
  baseline: QuestionScore[],
  candidate: QuestionScore[],
): { improved: boolean; details: string } {
  const baseMap = new Map(baseline.map(r => [r.questionId, r]));
  let anyImproved = false;
  let anyDegraded = false;
  const changes: string[] = [];

  for (const c of candidate) {
    const b = baseMap.get(c.questionId)!;
    const delta = c.score - b.score;

    if (delta > 0.01) {
      anyImproved = true;
      changes.push(`  ▲ ${c.questionId}: ${(b.score * 100).toFixed(0)}% → ${(c.score * 100).toFixed(0)}%`);
    } else if (delta < -0.01) {
      anyDegraded = true;
      changes.push(`  ▼ ${c.questionId}: ${(b.score * 100).toFixed(0)}% → ${(c.score * 100).toFixed(0)}%`);
    }

    // Hallucination introduced = always degraded
    if (c.hallucinationCount > b.hallucinationCount) {
      anyDegraded = true;
      changes.push(`  ⚠ ${c.questionId}: new hallucination`);
    }
  }

  const improved = anyImproved && !anyDegraded;
  const details = changes.length > 0 ? changes.join("\n") : "  (no changes)";
  return { improved, details };
}

// --- ASI: build diagnostic feedback for proposer ---
function buildASI(results: QuestionScore[]): string {
  const failures = results.filter(r => r.score < 1.0 || r.hallucinationCount > 0);

  if (failures.length === 0) return "All questions scored 100% with no hallucinations. The prompt is working perfectly.";

  const lines: string[] = [`${failures.length} of ${results.length} questions have room for improvement:\n`];

  for (const f of failures.sort((a, b) => a.score - b.score)) {
    const q = QUESTIONS.find(q => q.id === f.questionId)!;
    lines.push(`Question: "${q.question}" (${f.questionId})`);
    lines.push(`  Score: ${(f.score * 100).toFixed(0)}%`);

    if (f.absentFacts.length > 0) {
      lines.push(`  ABSENT facts (not mentioned at all):`);
      for (const fact of f.absentFacts) {
        lines.push(`    - ${fact}`);
      }
    }
    if (f.partialFacts.length > 0) {
      lines.push(`  PARTIAL facts (vaguely mentioned but not specific enough):`);
      for (const fact of f.partialFacts) {
        lines.push(`    - ${fact}`);
      }
    }
    if (f.hallucinationCount > 0) {
      lines.push(`  ⚠ ${f.hallucinationCount} hallucination(s) detected`);
    }

    // Show what the model actually said (truncated)
    lines.push(`  Model's response (first 300 chars):`);
    lines.push(`    "${f.response.slice(0, 300)}..."`);
    lines.push("");
  }

  return lines.join("\n");
}

// --- Proposer: ask LLM to mutate the prompt ---
async function proposeEdit(currentPrompt: string, asi: string, history: string[]): Promise<string> {
  const historyContext = history.length > 0
    ? `\nPrevious attempts and outcomes:\n${history.join("\n")}\n`
    : "";

  const resp = await openai.chat.completions.create({
    model: PROPOSER_MODEL,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: `You are a prompt engineer optimizing a system prompt for a household Q&A assistant.

The system prompt instructs an LLM to answer questions about household documents (pet care, baby care, home info).
The prompt has two sections separated by "---":
1. Response style and completeness rules
2. Helpfulness guidelines

Your job: propose a TARGETED edit to the prompt that fixes one or more of the failures described in the diagnostics, WITHOUT breaking anything that currently works.

Rules:
- Make minimal, surgical changes. Do NOT rewrite the whole prompt.
- Focus on the worst failures first.
- The prompt must remain general — don't add question-specific hacks.
- Keep the "---" separator between the two sections.
- Return ONLY the complete new prompt text. No commentary, no markdown fences.
- Look at what the model actually said vs. what was expected. Diagnose WHY it failed, then fix the instruction that caused the failure.`,
      },
      {
        role: "user",
        content: `Current prompt:
"""
${currentPrompt}
"""
${historyContext}
Diagnostic feedback (failures from latest eval):
${asi}

Return the improved prompt text:`,
      },
    ],
  });

  return resp.choices[0]?.message?.content?.trim() || currentPrompt;
}

// --- Main loop ---
async function main() {
  console.log(`\n🔧 Hearthstone Prompt Optimizer`);
  console.log(`Mode: ${evalMode} | Iterations: ${maxIterations} | Proposer: ${PROPOSER_MODEL}`);
  console.log(`Chat: ${CHAT_MODEL} | Judge: ${JUDGE_MODEL}\n`);

  // Backup original prompt
  copyFileSync(promptPath, backupPath);
  console.log(`Original prompt backed up to eval/prompt.backup.txt\n`);

  // Initial eval
  console.log(`Running baseline eval...`);
  let baseline = await runEval(evalMode);
  let baselineAvg = avgScore(baseline);
  console.log(`Baseline: ${(baselineAvg * 100).toFixed(1)}%\n`);

  const history: string[] = [];
  let keepCount = 0;
  let revertCount = 0;

  for (let i = 1; i <= maxIterations; i++) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Iteration ${i}/${maxIterations}`);
    console.log(`${"─".repeat(60)}`);

    const currentPrompt = readFileSync(promptPath, "utf-8");

    // Build ASI from current baseline
    const asi = buildASI(baseline);
    console.log(`\nFailures to address:\n${asi.slice(0, 500)}${asi.length > 500 ? "..." : ""}\n`);

    // Propose mutation
    console.log(`Proposing edit...`);
    const newPrompt = await proposeEdit(currentPrompt, asi, history.slice(-5));

    if (newPrompt === currentPrompt) {
      console.log(`Proposer returned identical prompt. Skipping.`);
      continue;
    }

    // Show diff summary
    const oldLines = currentPrompt.split("\n").length;
    const newLines = newPrompt.split("\n").length;
    console.log(`Prompt: ${oldLines} lines → ${newLines} lines`);

    // Write and eval
    writeFileSync(promptPath, newPrompt);
    console.log(`Evaluating candidate...`);

    // Need to re-import the prompt since harness reads it at module load.
    // We re-run via a subprocess to pick up the new prompt.
    const candidate = await runEvalFresh(evalMode);
    const candidateAvg = avgScore(candidate);

    // Pareto check
    const { improved, details } = isParetoImprovement(baseline, candidate);

    console.log(`\nCandidate: ${(candidateAvg * 100).toFixed(1)}% (baseline: ${(baselineAvg * 100).toFixed(1)}%)`);
    console.log(`Changes:\n${details}`);

    if (improved) {
      console.log(`\n✅ KEPT — Pareto improvement`);
      baseline = candidate;
      baselineAvg = candidateAvg;
      keepCount++;
      history.push(`Iteration ${i}: KEPT (${(baselineAvg * 100).toFixed(1)}%) — ${details.split("\n")[0]}`);
    } else {
      console.log(`\n❌ REVERTED — not a Pareto improvement`);
      writeFileSync(promptPath, currentPrompt);
      revertCount++;
      history.push(`Iteration ${i}: REVERTED — ${details.split("\n")[0]}`);
    }
  }

  // Final summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`OPTIMIZATION COMPLETE`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Iterations: ${maxIterations} | Kept: ${keepCount} | Reverted: ${revertCount}`);
  console.log(`Score: ${((avgScore(await runEval(evalMode))) * 100).toFixed(1)}%`);
  console.log(`\nFinal prompt saved to: eval/prompt.txt`);
  console.log(`Original backed up to: eval/prompt.backup.txt`);

  closeDb();
}

// Run eval in a subprocess so the new prompt.txt is picked up fresh
async function runEvalFresh(mode: Mode): Promise<QuestionScore[]> {
  // Since harness.ts reads prompt.txt at import time, and we've already
  // imported it, we need to re-evaluate. The cleanest way is to call
  // the eval runner as a subprocess and parse the JSON output.
  const { execSync } = await import("node:child_process");
  const cmd = `npx tsx eval/run.ts --mode ${mode} --concurrency 1 2>/dev/null`;
  execSync(cmd, { cwd: resolve(import.meta.dirname, ".."), timeout: 600000 });

  // Read the latest results file
  const { readdirSync } = await import("node:fs");
  const resultsDir = resolve(import.meta.dirname, "results");
  const files = readdirSync(resultsDir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();

  const latest = JSON.parse(readFileSync(resolve(resultsDir, files[0]), "utf-8"));

  return latest.results.map((r: any) => ({
    questionId: r.questionId,
    score: r.score,
    hallucinationCount: r.hallucinationCount,
    absentFacts: r.facts.filter((f: any) => f.verdict === "absent").map((f: any) => f.fact),
    partialFacts: r.facts.filter((f: any) => f.verdict === "partial").map((f: any) => f.fact),
    response: r.response,
  }));
}

main().catch(err => {
  console.error(err);
  // Restore backup on error
  try {
    copyFileSync(backupPath, promptPath);
    console.error("Prompt restored from backup.");
  } catch {}
  process.exit(1);
});
