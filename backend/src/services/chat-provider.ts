// src/services/chat-provider.ts
import OpenAI from "openai";
import { config } from "../config";
import { startSpan, SpanStatusCode, type Context } from "../tracing";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function* chat(ctx: Context | undefined, messages: ChatMessage[]): AsyncGenerator<string> {
  if (config.chatProvider === "openai") {
    yield* chatOpenAI(ctx, messages);
    return;
  }
  throw new Error(`Unknown chat provider: ${config.chatProvider}`);
}

async function* chatOpenAI(ctx: Context | undefined, messages: ChatMessage[]): AsyncGenerator<string> {
  const span = startSpan("openai.chat.stream", ctx);
  span.setAttribute("openai.model", "gpt-5.4");
  try {
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
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

export async function chatComplete(ctx: Context | undefined, messages: ChatMessage[]): Promise<string> {
  if (config.chatProvider === "openai") {
    const span = startSpan("openai.chat.complete", ctx);
    span.setAttribute("openai.model", "gpt-5.4");
    try {
      const client = new OpenAI({ apiKey: config.openaiApiKey });
      const response = await client.chat.completions.create({
        model: "gpt-5.4",
        messages,
      });
      return response.choices[0]?.message?.content || "";
    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  }
  throw new Error(`Unknown chat provider: ${config.chatProvider}`);
}
