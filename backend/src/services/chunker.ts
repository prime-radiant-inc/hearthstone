const MAX_TOKENS_APPROX = 500;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = MAX_TOKENS_APPROX * CHARS_PER_TOKEN;
const MIN_CHARS = 200;

export interface Chunk {
  heading: string; // section breadcrumb, e.g. "Kids & Family > Bedtime Routines"
  text: string;    // clean body text, no decorations
}

export function chunkMarkdown(markdown: string): Chunk[] {
  if (!markdown.trim()) return [];

  const sections = splitOnHeadings(markdown);
  const rawChunks: Chunk[] = [];

  for (const section of sections) {
    if (estimateChars(section.body) <= MAX_CHARS) {
      rawChunks.push({ heading: section.breadcrumb, text: section.body });
    } else {
      rawChunks.push(...splitLargeSection(section.breadcrumb, section.body));
    }
  }

  return mergeSmallChunks(rawChunks);
}

/**
 * Build the text sent to the embedding model.
 * Includes document title and section heading for retrieval quality.
 */
export function buildEmbeddingText(chunk: Chunk, documentTitle: string): string {
  const parts: string[] = [];
  if (documentTitle) parts.push(`[${documentTitle}]`);
  if (chunk.heading) parts.push(`> ${chunk.heading}`);
  parts.push(chunk.text);
  return parts.join("\n\n");
}

interface Section {
  breadcrumb: string;
  body: string;
}

function buildBreadcrumb(stack: string[]): string {
  return stack.join(" > ");
}

function splitOnHeadings(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];

  const headingStack: { level: number; text: string }[] = [];
  let currentBreadcrumb = "";
  let currentBody: string[] = [];

  function flush() {
    const body = currentBody.join("\n").trim();
    if (body) {
      sections.push({ breadcrumb: currentBreadcrumb, body });
    }
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,2})\s+(.*)/);
    if (headingMatch) {
      // Only split on H1 and H2. H3+ are treated as body text —
      // they're often just bold labels in Google Docs that pandoc
      // promoted to headings.
      flush();
      currentBody = [];

      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });

      currentBreadcrumb = buildBreadcrumb(headingStack.map((h) => h.text));
    } else {
      currentBody.push(line);
    }
  }

  flush();

  return sections;
}

function splitLargeSection(breadcrumb: string, body: string): Chunk[] {
  if (containsTable(body)) {
    return [{ heading: breadcrumb, text: body }];
  }

  const paragraphs = body.split(/\n\n+/).filter((p) => p.trim());
  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const para of paragraphs) {
    const paraChars = estimateChars(para);

    if (currentChars + paraChars > MAX_CHARS && current.length > 0) {
      chunks.push({ heading: breadcrumb, text: current.join("\n\n") });
      current = [para];
      currentChars = paraChars;
    } else {
      current.push(para);
      currentChars += paraChars;
    }
  }

  if (current.length > 0) {
    chunks.push({ heading: breadcrumb, text: current.join("\n\n") });
  }

  return chunks;
}

function containsTable(text: string): boolean {
  return /\|.+\|/.test(text) && /\|[-:]+\|/.test(text);
}

function estimateChars(text: string): number {
  return text.length;
}

function mergeSmallChunks(chunks: Chunk[]): Chunk[] {
  if (chunks.length <= 1) return chunks;

  const result: Chunk[] = [];
  let i = 0;

  while (i < chunks.length) {
    if (estimateChars(chunks[i].text) < MIN_CHARS && result.length > 0) {
      result[result.length - 1] = {
        heading: result[result.length - 1].heading,
        text: result[result.length - 1].text + "\n\n" + chunks[i].text,
      };
    } else if (estimateChars(chunks[i].text) < MIN_CHARS && i + 1 < chunks.length) {
      chunks[i + 1] = {
        heading: chunks[i].heading,
        text: chunks[i].text + "\n\n" + chunks[i + 1].text,
      };
    } else {
      result.push(chunks[i]);
    }
    i++;
  }

  return result;
}
