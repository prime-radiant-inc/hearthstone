import { describe, it, expect } from "bun:test";
import { chunkMarkdown } from "../../src/services/chunker";

describe("chunkMarkdown", () => {
  it("splits on heading boundaries", () => {
    const md = `# Welcome\nIntro text.\n\n## WiFi\nPassword is abc123.\n\n## Parking\nStreet parking only.`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain("Welcome");
    expect(chunks[1]).toContain("WiFi");
    expect(chunks[2]).toContain("Parking");
  });

  it("keeps table intact even if section is large", () => {
    const tableRows = Array.from({ length: 50 }, (_, i) => `| Contact ${i} | 555-000${i} |`).join("\n");
    const md = `## Emergency Contacts\n| Name | Phone |\n|------|-------|\n${tableRows}`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("Contact 49");
  });

  it("splits large sections on paragraph boundaries with breadcrumb prepended", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}. ${"Word ".repeat(40)}`
    ).join("\n\n");
    const md = `## Big Section\n\n${paragraphs}`;
    const chunks = chunkMarkdown(md);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toMatch(/^> Big Section/);
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

  it("prepends full breadcrumb path to each chunk", () => {
    const md = `# House Manual\n\nGeneral info.\n\n## Kids & Family\n\nFamily overview.\n\n### Bedtime Routines\n\nBath at 7:30, one story of her choosing.`;
    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe("> House Manual\n\nGeneral info.");
    expect(chunks[1]).toBe("> House Manual > Kids & Family\n\nFamily overview.");
    expect(chunks[2]).toBe("> House Manual > Kids & Family > Bedtime Routines\n\nBath at 7:30, one story of her choosing.");
  });

  it("chunk with no heading above it gets no breadcrumb", () => {
    const md = `Preamble content before any heading.\n\n# First Heading\n\nSection content.`;
    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("Preamble content before any heading.");
    expect(chunks[1]).toBe("> First Heading\n\nSection content.");
  });

  it("resets heading stack when encountering sibling headings", () => {
    const md = `# Doc\n\nRoot.\n\n## Section A\n\n### Deep A\n\nDeep content.\n\n## Section B\n\nB content.`;
    const chunks = chunkMarkdown(md);

    // Section B should NOT include "Section A" or "Deep A" in its breadcrumb
    const sectionBChunk = chunks.find((c) => c.includes("B content"));
    expect(sectionBChunk).toBeDefined();
    expect(sectionBChunk).toBe("> Doc > Section B\n\nB content.");
  });

  it("heading text is not duplicated in the chunk body", () => {
    const md = `## WiFi\nPassword is abc123.`;
    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(1);
    // breadcrumb line only, no raw "## WiFi" heading in body
    expect(chunks[0]).toBe("> WiFi\n\nPassword is abc123.");
    expect(chunks[0]).not.toContain("## WiFi");
  });
});
