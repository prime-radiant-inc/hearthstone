import type { Database } from "bun:sqlite";
import { embed } from "../services/embeddings";
import { chat, type ChatMessage } from "../services/chat-provider";
import { searchChunks } from "../services/search";
import { getSuggestions } from "../services/suggestions";
import { RAG_SYSTEM } from "../services/prompt";

interface ChatRequest {
  message: string;
  history: Array<{ role: string; content: string }>;
}

export async function handleChat(
  db: Database,
  householdId: string,
  body: ChatRequest
): Promise<Response> {
  const queryEmbedding = await embed(body.message);
  const queryVec = new Float32Array(queryEmbedding);

  const results = searchChunks(db, householdId, queryVec, 5);

  const chunkContext = results
    .map((r, i) => {
      const header = `[${i + 1}] (from "${r.documentTitle}"${r.heading ? ` — ${r.heading}` : ""})`;
      return `${header}\n${r.text}`;
    })
    .join("\n\n---\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: RAG_SYSTEM + chunkContext },
    ...body.history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: body.message },
  ];

  // Map source index to source metadata
  const allSources = results.map((r, i) => ({
    index: i + 1,
    document_id: r.documentId,
    title: r.documentTitle,
    chunk_index: r.chunkIndex,
  }));

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullResponse = "";
      try {
        for await (const delta of chat(messages)) {
          fullResponse += delta;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
        }

        // Parse which sources the model cited
        const citedIndices = new Set<number>();
        const sourceLineMatch = fullResponse.match(/Sources?:\s*(.+)/i);
        if (sourceLineMatch) {
          const refs = sourceLineMatch[1].matchAll(/\[(\d+)\]/g);
          for (const ref of refs) {
            citedIndices.add(parseInt(ref[1]));
          }
        }

        // Filter to only cited sources, deduplicated by document_id
        const seenDocs = new Set<string>();
        const citedSources = allSources
          .filter((s) => citedIndices.has(s.index))
          .filter((s) => {
            if (seenDocs.has(s.document_id)) return false;
            seenDocs.add(s.document_id);
            return true;
          })
          .map(({ document_id, title, chunk_index }) => ({ document_id, title, chunk_index }));

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources: citedSources })}\n\n`));
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
  db: Database,
  householdId: string
): { status: number; body: any } {
  const suggestions = getSuggestions(db, householdId);
  return { status: 200, body: { suggestions } };
}

export async function handleChatPreview(
  db: Database,
  householdId: string,
  body: ChatRequest
): Promise<Response> {
  return handleChat(db, householdId, body);
}
