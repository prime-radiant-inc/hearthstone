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
export const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || "gpt-4o-mini";

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
    model: JUDGE_MODEL,
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
