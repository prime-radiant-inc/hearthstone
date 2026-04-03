// src/services/chat-provider.ts
import OpenAI from "openai";
import { config } from "../config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function* chat(messages: ChatMessage[]): AsyncGenerator<string> {
  if (config.chatProvider === "openai") {
    yield* chatOpenAI(messages);
    return;
  }
  throw new Error(`Unknown chat provider: ${config.chatProvider}`);
}

async function* chatOpenAI(messages: ChatMessage[]): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const stream = await client.chat.completions.create({
    model: "gpt-5.4",
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

export async function chatComplete(messages: ChatMessage[]): Promise<string> {
  if (config.chatProvider === "openai") {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.chat.completions.create({
      model: "gpt-5.4",
      messages,
    });
    return response.choices[0]?.message?.content || "";
  }
  throw new Error(`Unknown chat provider: ${config.chatProvider}`);
}
