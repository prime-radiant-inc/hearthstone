// src/services/embeddings.ts
import OpenAI from "openai";
import { config } from "../config";
import { tracer, SpanStatusCode } from "../tracing";

export async function embed(text: string): Promise<number[]> {
  if (config.embeddingProvider === "openai") {
    return embedOpenAI(text);
  }
  throw new Error(`Unknown embedding provider: ${config.embeddingProvider}`);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (config.embeddingProvider === "openai") {
    return embedBatchOpenAI(texts);
  }
  throw new Error(`Unknown embedding provider: ${config.embeddingProvider}`);
}

async function embedOpenAI(text: string): Promise<number[]> {
  return tracer.startActiveSpan("openai.embeddings", async (span) => {
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
  });
}

async function embedBatchOpenAI(texts: string[]): Promise<number[][]> {
  return tracer.startActiveSpan("openai.embeddings.batch", async (span) => {
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
  });
}
