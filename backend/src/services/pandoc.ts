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

    const raw = await new Promise<string>((resolve, reject) => {
      execFile(
        "pandoc",
        [tmpPath, "-f", "docx", "-t", "markdown-grid_tables+pipe_tables", "--wrap=none"],
        { maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) reject(new Error(`Pandoc conversion failed: ${stderr || error.message}`));
          else resolve(stdout);
        }
      );
    });

    return promoteImpliedHeadings(raw);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Many Google Docs use bold/underline text instead of heading styles.
 * Detect these patterns and promote them to Markdown headings so the
 * chunker can split on them.
 *
 * Patterns detected:
 * - Standalone bold lines: **Section Name**
 * - Bold + underline: **[Section Name]{.underline}**
 * - Underline-only: [Section Name]{.underline}
 * - Lines that are just bold text with no other content
 *
 * A "standalone" line is one that is its own paragraph (blank lines before/after)
 * and is short enough to be a heading (< 80 chars of actual text).
 */
function promoteImpliedHeadings(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      result.push(lines[i]);
      continue;
    }

    // Check if this line looks like an implied heading
    const headingText = extractImpliedHeading(line);

    if (headingText && headingText.length < 80) {
      // Check context: is this a standalone line? (not part of a paragraph)
      const prevLine = i > 0 ? lines[i - 1].trim() : "";
      const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : "";
      const isStandalone = prevLine === "" || i === 0;
      const isFollowedByContent = nextLine === "" || nextLine.startsWith("-") || nextLine.startsWith("*") || nextLine.startsWith("<");

      if (isStandalone) {
        result.push(`## ${headingText}`);
        continue;
      }
    }

    result.push(lines[i]);
  }

  return result.join("\n");
}

function extractImpliedHeading(line: string): string | null {
  // **[Text]{.underline}** or **[Text]{.underline}:**
  let match = line.match(/^\*\*\[([^\]]+)\]\{\.underline\}\*\*:?$/);
  if (match) return cleanHeadingText(match[1]);

  // [**Text**]{.underline} or [**Text**]{.underline}:
  match = line.match(/^\[\*\*([^*]+)\*\*\]\{\.underline\}:?$/);
  if (match) return cleanHeadingText(match[1]);

  // [Text]{.underline} (underline only, standalone)
  match = line.match(/^\[([^\]]+)\]\{\.underline\}:?$/);
  if (match) return cleanHeadingText(match[1]);

  // **Text** (bold only, standalone — but not if it looks like inline emphasis)
  match = line.match(/^\*\*([^*]+)\*\*:?$/);
  if (match) return cleanHeadingText(match[1]);

  return null;
}

function cleanHeadingText(text: string): string | null {
  // Strip any remaining markdown formatting
  let clean = text
    .replace(/\*\*/g, "")           // bold
    .replace(/\*/g, "")             // italic
    .replace(/\[([^\]]+)\]\{[^}]+\}/g, "$1")  // pandoc spans like {.underline}
    .replace(/\{[^}]+\}/g, "")      // stray pandoc attributes
    .replace(/:$/, "")              // trailing colon
    .trim();

  // Skip if it's just punctuation or too short to be a heading
  if (clean.length < 2) return null;
  if (/^[.\-_:;,!?]+$/.test(clean)) return null;

  return clean;
}
