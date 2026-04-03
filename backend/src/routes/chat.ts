import type Database from "better-sqlite3";
import { embed } from "../services/embeddings";
import { chat, type ChatMessage } from "../services/chat-provider";
import { searchChunks } from "../services/search";
import { getSuggestions } from "../services/suggestions";

const SYSTEM_PROMPT = `You are a helpful household assistant. Answer questions using ONLY the provided document excerpts below. If the answer is not present in the excerpts, say exactly: "I don't have that information in the household docs." Do not make up information or use knowledge outside these documents.

Document excerpts:
`;

interface ChatRequest {
  message: string;
  history: Array<{ role: string; content: string }>;
}

export async function handleChat(
  db: Database.Database,
  householdId: string,
  body: ChatRequest
): Promise<Response> {
  const queryEmbedding = await embed(body.message);
  const queryVec = new Float32Array(queryEmbedding);

  const results = searchChunks(db, householdId, queryVec, 5);

  const chunkContext = results
    .map((r, i) => `[${i + 1}] (${r.documentTitle}, section ${r.chunkIndex})\n${r.text}`)
    .join("\n\n---\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + chunkContext },
    ...body.history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: body.message },
  ];

  const sources = results.map((r) => ({
    document_id: r.documentId,
    title: r.documentTitle,
    chunk_index: r.chunkIndex,
  }));

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const delta of chat(messages)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`));
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: "Something went wrong. Please try again." })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function handleGetSuggestions(
  db: Database.Database,
  householdId: string
): { status: number; body: any } {
  const suggestions = getSuggestions(db, householdId);
  return { status: 200, body: { suggestions } };
}

export async function handleChatPreview(
  db: Database.Database,
  householdId: string,
  body: ChatRequest
): Promise<Response> {
  return handleChat(db, householdId, body);
}
