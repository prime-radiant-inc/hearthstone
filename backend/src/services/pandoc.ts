// src/services/pandoc.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function docxToMarkdown(docxBuffer: Buffer): Promise<string> {
  const { stdout } = await execFileAsync(
    "pandoc",
    ["-f", "docx", "-t", "markdown", "--wrap=none"],
    { encoding: "buffer", input: docxBuffer, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout.toString("utf8");
}
