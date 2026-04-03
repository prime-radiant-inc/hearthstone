const MAX_TOKENS_APPROX = 500;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = MAX_TOKENS_APPROX * CHARS_PER_TOKEN;

export function chunkMarkdown(markdown: string): string[] {
  if (!markdown.trim()) return [];

  const sections = splitOnHeadings(markdown);
  const chunks: string[] = [];

  for (const section of sections) {
    if (estimateChars(section.body) <= MAX_CHARS) {
      chunks.push(formatChunk(section.breadcrumb, section.body));
    } else {
      chunks.push(...splitLargeSection(section.breadcrumb, section.body));
    }
  }

  return chunks;
}

interface Section {
  breadcrumb: string; // e.g. "House Manual > Kids & Family > Bedtime Routines"
  body: string;       // content without the heading line
}

function buildBreadcrumb(stack: string[]): string {
  return stack.join(" > ");
}

function formatChunk(breadcrumb: string, body: string): string {
  if (!breadcrumb) return body;
  return `> ${breadcrumb}\n\n${body}`;
}

function splitOnHeadings(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];

  // heading stack: each entry is { level, text }
  const headingStack: { level: number; text: string }[] = [];
  let currentBreadcrumb = "";
  let currentBody: string[] = [];
  let inSection = false;

  function flush() {
    const body = currentBody.join("\n").trim();
    if (body) {
      sections.push({ breadcrumb: currentBreadcrumb, body });
    }
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      flush();
      currentBody = [];

      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();

      // Pop anything at this level or deeper
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });

      currentBreadcrumb = buildBreadcrumb(headingStack.map((h) => h.text));
      inSection = true;
    } else {
      currentBody.push(line);
    }
  }

  flush();

  return sections;
}

function splitLargeSection(breadcrumb: string, body: string): string[] {
  if (containsTable(body)) {
    return [formatChunk(breadcrumb, body)];
  }

  const paragraphs = body.split(/\n\n+/).filter((p) => p.trim());
  const chunks: string[] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const para of paragraphs) {
    const paraChars = estimateChars(para);

    if (currentChars + paraChars > MAX_CHARS && current.length > 0) {
      chunks.push(formatChunk(breadcrumb, current.join("\n\n")));
      current = [para];
      currentChars = paraChars;
    } else {
      current.push(para);
      currentChars += paraChars;
    }
  }

  if (current.length > 0) {
    chunks.push(formatChunk(breadcrumb, current.join("\n\n")));
  }

  return chunks;
}

function containsTable(text: string): boolean {
  return /\|.+\|/.test(text) && /\|[-:]+\|/.test(text);
}

function estimateChars(text: string): number {
  return text.length;
}
