import { describe, it, expect } from "bun:test";
import { chunkMarkdown } from "../../src/services/chunker";

describe("chunkMarkdown", () => {
  it("splits on heading boundaries", () => {
    const md = `# Welcome\nIntro text.\n\n## WiFi\nPassword is abc123.\n\n## Parking\nStreet parking only.`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain("# Welcome");
    expect(chunks[1]).toContain("## WiFi");
    expect(chunks[2]).toContain("## Parking");
  });

  it("keeps table intact even if section is large", () => {
    const tableRows = Array.from({ length: 50 }, (_, i) => `| Contact ${i} | 555-000${i} |`).join("\n");
    const md = `## Emergency Contacts\n| Name | Phone |\n|------|-------|\n${tableRows}`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("Contact 49");
  });

  it("splits large sections on paragraph boundaries with heading prepended", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}. ${"Word ".repeat(40)}`
    ).join("\n\n");
    const md = `## Big Section\n\n${paragraphs}`;
    const chunks = chunkMarkdown(md);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toMatch(/^## Big Section/);
    }
  });

  it("handles doc with no headings as single chunk", () => {
    const md = "Just some plain text without any headings.";
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(md);
  });

  it("handles empty document", () => {
    const chunks = chunkMarkdown("");
    expect(chunks).toHaveLength(0);
  });

  it("preserves heading hierarchy", () => {
    const md = `# Top\nIntro.\n## Sub A\nContent A.\n### Sub Sub\nDeep content.\n## Sub B\nContent B.`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(4);
  });
});
