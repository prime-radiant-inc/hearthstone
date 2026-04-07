import { describe, it, expect } from "bun:test";
import { chunkMarkdown, buildEmbeddingText } from "../../src/services/chunker";

// Helper: generate text long enough to avoid small-chunk merging (>200 chars)
const pad = (text: string) => text + " " + "Context details here. ".repeat(10);

describe("chunkMarkdown", () => {
  it("splits on heading boundaries", () => {
    const md = `# Welcome\n${pad("Intro text.")}\n\n## WiFi\n${pad("Password is abc123.")}\n\n## Parking\n${pad("Street parking only.")}`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].text).toContain("Intro text");
    expect(chunks[1].text).toContain("Password is abc123");
    expect(chunks[2].text).toContain("Street parking only");
  });

  it("keeps table intact even if section is large", () => {
    const tableRows = Array.from({ length: 50 }, (_, i) => `| Contact ${i} | 555-000${i} |`).join("\n");
    const md = `## Emergency Contacts\n| Name | Phone |\n|------|-------|\n${tableRows}`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("Contact 49");
  });

  it("splits large sections on paragraph boundaries with heading preserved", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}. ${"Word ".repeat(40)}`
    ).join("\n\n");
    const md = `## Big Section\n\n${paragraphs}`;
    const chunks = chunkMarkdown(md);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.heading).toBe("Big Section");
    }
  });

  it("handles doc with no headings as single chunk", () => {
    const md = pad("Just some plain text without any headings.");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBe("");
    expect(chunks[0].text).toContain("Just some plain text");
  });

  it("handles empty document", () => {
    const chunks = chunkMarkdown("");
    expect(chunks).toHaveLength(0);
  });

  it("preserves heading hierarchy", () => {
    const md = `# Top\n${pad("Intro.")}\n## Sub A\n${pad("Content A.")}\n### Sub Sub\n${pad("Deep content.")}\n## Sub B\n${pad("Content B.")}`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(4);
  });

  it("stores breadcrumb path in heading field", () => {
    const md = `# House Manual\n\n${pad("General info.")}\n\n## Kids & Family\n\n${pad("Family overview.")}\n\n### Bedtime Routines\n\n${pad("Bath at 7:30, one story of her choosing.")}`;
    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].heading).toBe("House Manual");
    expect(chunks[0].text).toContain("General info.");
    expect(chunks[1].heading).toBe("House Manual > Kids & Family");
    expect(chunks[1].text).toContain("Family overview.");
    expect(chunks[2].heading).toBe("House Manual > Kids & Family > Bedtime Routines");
    expect(chunks[2].text).toContain("Bath at 7:30");
  });

  it("chunk with no heading above it gets empty heading", () => {
    const md = `${pad("Preamble content before any heading.")}\n\n# First Heading\n\n${pad("Section content.")}`;
    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].heading).toBe("");
    expect(chunks[0].text).toContain("Preamble content");
    expect(chunks[1].heading).toBe("First Heading");
    expect(chunks[1].text).toContain("Section content.");
  });

  it("resets heading stack when encountering sibling headings", () => {
    const md = `# Doc\n\n${pad("Root.")}\n\n## Section A\n\n### Deep A\n\n${pad("Deep content.")}\n\n## Section B\n\n${pad("B content.")}`;
    const chunks = chunkMarkdown(md);

    const sectionBChunk = chunks.find((c) => c.text.includes("B content"));
    expect(sectionBChunk).toBeDefined();
    expect(sectionBChunk!.heading).toBe("Doc > Section B");
  });

  it("heading text is not in the chunk body", () => {
    const md = `## WiFi\n${pad("Password is abc123.")}`;
    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBe("WiFi");
    expect(chunks[0].text).toContain("Password is abc123.");
    expect(chunks[0].text).not.toContain("## WiFi");
  });

  it("merges tiny chunks into neighbors", () => {
    const md = `# Intro\nShort.\n\n## Details\n${pad("Longer section with real content.")}`;
    const chunks = chunkMarkdown(md);
    // "Short." is < 200 chars, so it merges into the next chunk
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("Short.");
    expect(chunks[0].text).toContain("Longer section");
  });
});

describe("buildEmbeddingText", () => {
  it("includes title and heading for embedding", () => {
    const result = buildEmbeddingText({ heading: "Kids > Bedtime", text: "Bath at 7:30." }, "House Manual");
    expect(result).toBe("[House Manual]\n\n> Kids > Bedtime\n\nBath at 7:30.");
  });

  it("handles empty heading", () => {
    const result = buildEmbeddingText({ heading: "", text: "Preamble." }, "My Doc");
    expect(result).toBe("[My Doc]\n\nPreamble.");
  });

  it("handles empty title", () => {
    const result = buildEmbeddingText({ heading: "WiFi", text: "Password is abc." }, "");
    expect(result).toBe("> WiFi\n\nPassword is abc.");
  });
});
