const MAX_TOKENS_APPROX = 500;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = MAX_TOKENS_APPROX * CHARS_PER_TOKEN;

export function chunkMarkdown(markdown: string): string[] {
  if (!markdown.trim()) return [];

  const sections = splitOnHeadings(markdown);
  const chunks: string[] = [];

  for (const section of sections) {
    if (estimateChars(section) <= MAX_CHARS) {
      chunks.push(section);
    } else {
      chunks.push(...splitLargeSection(section));
    }
  }

  return chunks;
}

function splitOnHeadings(markdown: string): string[] {
  const lines = markdown.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      const text = current.join("\n").trim();
      if (text) sections.push(text);
      current = [line];
    } else {
      current.push(line);
    }
  }

  const text = current.join("\n").trim();
  if (text) sections.push(text);

  return sections;
}

function splitLargeSection(section: string): string[] {
  const lines = section.split("\n");
  const headingMatch = lines[0].match(/^#{1,6}\s.*/);
  const heading = headingMatch ? lines[0] : "";
  const body = heading ? lines.slice(1).join("\n").trim() : section;

  if (containsTable(body)) {
    return [section];
  }

  const paragraphs = body.split(/\n\n+/).filter((p) => p.trim());
  const chunks: string[] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const para of paragraphs) {
    const paraChars = estimateChars(para);

    if (currentChars + paraChars > MAX_CHARS && current.length > 0) {
      const chunkBody = current.join("\n\n");
      chunks.push(heading ? `${heading}\n\n${chunkBody}` : chunkBody);
      current = [para];
      currentChars = paraChars;
    } else {
      current.push(para);
      currentChars += paraChars;
    }
  }

  if (current.length > 0) {
    const chunkBody = current.join("\n\n");
    chunks.push(heading ? `${heading}\n\n${chunkBody}` : chunkBody);
  }

  return chunks;
}

function containsTable(text: string): boolean {
  return /\|.+\|/.test(text) && /\|[-:]+\|/.test(text);
}

function estimateChars(text: string): number {
  return text.length;
}
