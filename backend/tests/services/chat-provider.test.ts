import "../helpers";
import { describe, it, expect, mock } from "bun:test";
import type { ChatMessage } from "../../src/services/chat-provider";

const mockCreate = mock(async () => ({
  choices: [{
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "search", arguments: JSON.stringify({ query: "garage" }) },
      }],
    },
  }],
}));

mock.module("openai", () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

import { chatCompleteWithTools } from "../../src/services/chat-provider";

describe("chatCompleteWithTools", () => {
  it("passes tool definitions to the OpenAI client", async () => {
    const tools = [{ type: "function", function: { name: "search", description: "x", parameters: { type: "object" } } }];
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    await chatCompleteWithTools(undefined, messages, tools as any);
    const call = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
    expect(call.tools).toEqual(tools);
  });

  it("returns the assistant message including tool_calls", async () => {
    const tools = [{ type: "function", function: { name: "search", description: "x", parameters: { type: "object" } } }];
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    const response = await chatCompleteWithTools(undefined, messages, tools as any);
    expect(response.role).toBe("assistant");
    expect(response.tool_calls).toBeDefined();
    expect(response.tool_calls?.[0].function.name).toBe("search");
  });
});
