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

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export type LoopMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export async function chatCompleteWithTools(
  ctx: Context | undefined,
  messages: LoopMessage[],
  tools: any[]
): Promise<AssistantMessage> {
  if (config.chatProvider !== "openai") {
    throw new Error(`chatCompleteWithTools only supports openai provider, got: ${config.chatProvider}`);
  }
  const span = startSpan("openai.chat.complete.tools", ctx);
  span.setAttribute("openai.model", "gpt-5.4");
  span.setAttribute("tools.count", tools.length);
  try {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.chat.completions.create({
      model: "gpt-5.4",
      messages: messages as any,
      tools,
    });
    const message = response.choices[0]?.message;
    if (!message) throw new Error("OpenAI returned no message");
    return {
      role: "assistant",
      content: message.content ?? null,
      tool_calls: (message as any).tool_calls,
    };
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
