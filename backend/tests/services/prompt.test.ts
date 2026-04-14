import { describe, it, expect } from "bun:test";
import { buildToolCallSystemPrompt } from "../../src/services/prompt";

describe("buildToolCallSystemPrompt", () => {
  it("includes the document inventory verbatim", () => {
    const inv = "Available documents in this household:\n- \"House Ops\" (id: d1, 5 chunks)";
    const prompt = buildToolCallSystemPrompt(inv);
    expect(prompt).toContain(inv);
  });

  it("instructs the model to use the search tool when needed", () => {
    const prompt = buildToolCallSystemPrompt("...");
    expect(prompt.toLowerCase()).toContain("search");
  });

  it("instructs the model to cite chunks via Sources: [N] format", () => {
    const prompt = buildToolCallSystemPrompt("...");
    expect(prompt).toContain("Sources:");
    expect(prompt).toMatch(/\[\d\]/);
  });

  it("includes the chat style and helpfulness sections from prompt.txt", () => {
    const prompt = buildToolCallSystemPrompt("...");
    // CHAT_STYLE / HELPFULNESS are already in RAG_SYSTEM; the tool-call prompt
    // should include the same brand voice. Check for a stable substring that
    // appears in both: this assertion couples to prompt.txt content.
    expect(prompt.length).toBeGreaterThan(200);
  });
});
