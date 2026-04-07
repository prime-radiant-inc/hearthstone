// src/services/embeddings.ts
import OpenAI from "openai";
import { config } from "../config";
import { startSpan, SpanStatusCode, type Context } from "../tracing";

export async function embed(text: string, ctx?: Context): Promise<number[]> {
  if (config.embeddingProvider === "openai") {
    return embedOpenAI(text, ctx);
  }
  throw new Error(`Unknown embedding provider: ${config.embeddingProvider}`);
}

export async function embedBatch(texts: string[], ctx?: Context): Promise<number[][]> {
  if (config.embeddingProvider === "openai") {
    return embedBatchOpenAI(texts, ctx);
  }
  throw new Error(`Unknown embedding provider: ${config.embeddingProvider}`);
}

async function embedOpenAI(text: string, ctx?: Context): Promise<number[]> {
  const span = startSpan("openai.embeddings", ctx);
  span.setAttribute("openai.model", "text-embedding-3-small");
  span.setAttribute("app.chunk_count", 1);
  try {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

async function embedBatchOpenAI(texts: string[], ctx?: Context): Promise<number[][]> {
  const span = startSpan("openai.embeddings.batch", ctx);
  span.setAttribute("openai.model", "text-embedding-3-small");
  span.setAttribute("app.chunk_count", texts.length);
  try {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: texts,
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  } catch (err: any) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
