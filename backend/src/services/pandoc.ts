// src/services/pandoc.ts
import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export async function docxToMarkdown(docxBuffer: Buffer): Promise<string> {
  const tmpPath = join(tmpdir(), `hearthstone-${randomBytes(8).toString("hex")}.docx`);

  try {
    await writeFile(tmpPath, docxBuffer);

    return await new Promise((resolve, reject) => {
      execFile(
        "pandoc",
        [tmpPath, "-f", "docx", "-t", "markdown", "--wrap=none"],
        { maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) reject(new Error(`Pandoc conversion failed: ${stderr || error.message}`));
          else resolve(stdout);
        }
      );
    });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
