#!/usr/bin/env bun
/**
 * Multi-model eval comparison.
 * Runs the eval harness for each model and produces a side-by-side comparison.
 *
 * Usage:
 *   bun eval/compare-models.ts                     # all 6 models, both modes
 *   bun eval/compare-models.ts --concurrency 3     # parallel questions per model
 *   bun eval/compare-models.ts --models gpt-5.4,gpt-5.4-mini
 */

import { resolve } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";

const MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
];

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

const concurrency = getArg("concurrency") || "5";
const modelFilter = getArg("models");
const models = modelFilter ? modelFilter.split(",") : MODELS;

// --- Types matching run.ts output ---

interface ResultFile {
  timestamp: string;
  chatModel: string;
  judgeModel: string;
  modes: string[];
  questionCount: number;
  results: Array<{
    questionId: string;
    mode: string;
    score: number;
    hallucinationCount: number;
    latencyMs: number;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }>;
  summary: Record<string, {
    avgScore: number;
    totalHallucinations: number;
    avgLatencyMs: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
  }>;
}

// --- Run each model ---

const resultsDir = resolve(import.meta.dirname, "results");
const runScript = resolve(import.meta.dirname, "run.ts");

const JUDGE_MODEL = "gpt-5.4";

async function runModel(model: string): Promise<string> {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`  Running: ${model}`);
  console.log("=".repeat(80));

  const beforeTime = Date.now();

  const proc = Bun.spawn(
    ["bun", runScript, "--concurrency", concurrency],
    {
      env: { ...process.env, EVAL_CHAT_MODEL: model, EVAL_JUDGE_MODEL: JUDGE_MODEL },
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Eval failed for ${model} (exit code ${exitCode})`);
  }

  // Find the newest JSON file created after we started
  const files = readdirSync(resultsDir)
    .filter(f => f.endsWith(".json") && !f.includes("comparison"))
    .map(f => ({ name: f, mtime: statSync(resolve(resultsDir, f)).mtimeMs }))
    .filter(f => f.mtime >= beforeTime)
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    throw new Error(`No result file found for ${model}`);
  }

  return resolve(resultsDir, files[0].name);
}

// --- Comparison output ---

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function printComparison(resultFiles: Map<string, ResultFile>) {
  const modelNames = [...resultFiles.keys()];
  const modes = ["rag", "full"];

  console.log("\n" + "=".repeat(100));
  console.log("  MODEL COMPARISON");
  console.log("=".repeat(100));

  for (const mode of modes) {
    console.log(`\n${"─".repeat(100)}`);
    console.log(`  ${mode.toUpperCase()} MODE`);
    console.log("─".repeat(100));

    const colWidth = 14;
    const labelWidth = 20;

    // Header
    const header = "".padEnd(labelWidth) + modelNames.map(m => m.padStart(colWidth)).join("");
    console.log(`\n${header}`);
    console.log("─".repeat(labelWidth + modelNames.length * colWidth));

    // Avg Score
    const scoreRow = modelNames.map(m => {
      const s = resultFiles.get(m)!.summary[mode];
      return s ? `${Math.round(s.avgScore * 100)}%`.padStart(colWidth) : "—".padStart(colWidth);
    });
    console.log(`${"Avg Score".padEnd(labelWidth)}${scoreRow.join("")}`);

    // Hallucinations
    const halRow = modelNames.map(m => {
      const s = resultFiles.get(m)!.summary[mode];
      return s ? `${s.totalHallucinations}`.padStart(colWidth) : "—".padStart(colWidth);
    });
    console.log(`${"Hallucinations".padEnd(labelWidth)}${halRow.join("")}`);

    // Avg Latency
    const latRow = modelNames.map(m => {
      const s = resultFiles.get(m)!.summary[mode];
      return s ? `${(s.avgLatencyMs / 1000).toFixed(1)}s`.padStart(colWidth) : "—".padStart(colWidth);
    });
    console.log(`${"Avg Latency".padEnd(labelWidth)}${latRow.join("")}`);

    // Input tokens
    const inRow = modelNames.map(m => {
      const s = resultFiles.get(m)!.summary[mode];
      return s ? fmtTokens(s.totalPromptTokens).padStart(colWidth) : "—".padStart(colWidth);
    });
    console.log(`${"Input Tokens".padEnd(labelWidth)}${inRow.join("")}`);

    // Output tokens
    const outRow = modelNames.map(m => {
      const s = resultFiles.get(m)!.summary[mode];
      return s ? fmtTokens(s.totalCompletionTokens).padStart(colWidth) : "—".padStart(colWidth);
    });
    console.log(`${"Output Tokens".padEnd(labelWidth)}${outRow.join("")}`);

    // Total tokens
    const totalRow = modelNames.map(m => {
      const s = resultFiles.get(m)!.summary[mode];
      return s ? fmtTokens(s.totalTokens).padStart(colWidth) : "—".padStart(colWidth);
    });
    console.log(`${"Total Tokens".padEnd(labelWidth)}${totalRow.join("")}`);
  }

  // Per-question breakdown (RAG only, to keep it readable)
  console.log(`\n${"─".repeat(100)}`);
  console.log("  PER-QUESTION SCORES (RAG)");
  console.log("─".repeat(100));

  const colWidth = 14;
  const qWidth = 30;
  const qHeader = "Question".padEnd(qWidth) + modelNames.map(m => m.padStart(colWidth)).join("");
  console.log(`\n${qHeader}`);
  console.log("─".repeat(qWidth + modelNames.length * colWidth));

  // Get question IDs from first result file
  const firstResult = resultFiles.values().next().value!;
  const questionIds = [...new Set(firstResult.results.filter(r => r.mode === "rag").map(r => r.questionId))];

  for (const qid of questionIds) {
    const cells = modelNames.map(m => {
      const r = resultFiles.get(m)!.results.find(r => r.questionId === qid && r.mode === "rag");
      if (!r) return "—".padStart(colWidth);
      const pct = `${Math.round(r.score * 100)}%`;
      const hal = r.hallucinationCount > 0 ? "!" : "";
      return `${pct}${hal}`.padStart(colWidth);
    });
    console.log(`${qid.padEnd(qWidth)}${cells.join("")}`);
  }

  console.log("\n" + "=".repeat(100));
  console.log("Legend: ! = hallucination detected");
  console.log("=".repeat(100) + "\n");
}

function saveComparison(resultFiles: Map<string, ResultFile>) {
  const dir = resolve(import.meta.dirname, "results");
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const path = resolve(dir, `${stamp}-comparison.json`);

  const output = {
    timestamp: now.toISOString(),
    models: [...resultFiles.keys()],
    perModel: Object.fromEntries(
      [...resultFiles.entries()].map(([model, data]) => [
        model,
        {
          resultFile: data.timestamp,
          summary: data.summary,
        },
      ]),
    ),
  };

  Bun.write(path, JSON.stringify(output, null, 2));
  console.log(`Comparison saved to: ${path}`);
}

// --- Main ---

async function main() {
  console.log(`\n🏠 Hearthstone Model Comparison`);
  console.log(`Models: ${models.join(", ")}`);
  console.log(`Judge: ${JUDGE_MODEL} (constant across all runs)`);
  console.log(`Modes: rag, full | Concurrency: ${concurrency}\n`);

  const collected = new Map<string, ResultFile>();

  for (const model of models) {
    const resultPath = await runModel(model);
    const data: ResultFile = JSON.parse(readFileSync(resultPath, "utf-8"));
    collected.set(model, data);
  }

  printComparison(collected);
  saveComparison(collected);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
