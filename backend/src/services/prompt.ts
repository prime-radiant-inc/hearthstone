import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const promptPath = resolve(import.meta.dirname, "..", "..", "eval", "prompt.txt");
const promptContent = readFileSync(promptPath, "utf-8");
const [CHAT_STYLE, HELPFULNESS] = promptContent.split("\n---\n").map(s => s.trim());

export const RAG_SYSTEM = `You are a helpful household assistant. Answer using ONLY the provided excerpts. Do not make up information.

${CHAT_STYLE}
${HELPFULNESS}

After your answer, on a new line: Sources: [1], [3]

Document excerpts:
`;

export const FULL_SYSTEM = `You are a helpful household assistant. Answer using ONLY the provided documents. Do not make up information.

${CHAT_STYLE}
${HELPFULNESS}

After your answer, on a new line: Sources: "Document Title"

Household documents:
`;
