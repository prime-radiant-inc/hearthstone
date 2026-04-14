import type { Database } from "bun:sqlite";
import { getSuggestions } from "../services/suggestions";
import { runChatLoop, type RunChatLoopOptions, type ChunkRef } from "../services/chat-loop";
import type { Context } from "../tracing";

interface ChatRequest {
  message: string;
  history: Array<{ role: string; content: string }>;
}

export interface HandleChatOptions {
  chatLoopOptions?: RunChatLoopOptions;
}

export async function handleChat(
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  body: ChatRequest,
  options: HandleChatOptions = {}
): Promise<Response> {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullResponse = "";

      // Accumulate every chunk the loop publishes so we can resolve
      // the cited [N] indices to source pills after the model is done.
      const allChunks: ChunkRef[] = [];

      try {
        for await (const event of runChatLoop(
          ctx,
          db,
          householdId,
          body.message,
          body.history,
          options.chatLoopOptions
        )) {
          if (event.type === "delta") {
            fullResponse += event.delta;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta: event.delta })}\n\n`)
            );
          } else if (event.type === "status") {
            const payload: Record<string, any> = { status: event.status };
            if (event.query !== undefined) payload.query = event.query;
            if (event.document_id !== undefined) payload.document_id = event.document_id;
            if (event.title !== undefined) payload.title = event.title;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } else if (event.type === "chunks") {
            // Internal — not forwarded to the client.
            for (const c of event.chunks) allChunks.push(c);
          }
        }

        // Resolve cited [N] indices to source pills.
        const citedIndices = new Set<number>();
        const sourceLineMatch = fullResponse.match(/Sources?:\s*(.+)/i);
        if (sourceLineMatch) {
          for (const ref of sourceLineMatch[1].matchAll(/\[(\d+)\]/g)) {
            citedIndices.add(parseInt(ref[1]));
          }
        }

        const seenDocs = new Set<string>();
        const citedSources = allChunks
          .filter((c) => citedIndices.has(c.index))
          .filter((c) => {
            if (seenDocs.has(c.document_id)) return false;
            seenDocs.add(c.document_id);
            return true;
          })
          .map(({ document_id, title, chunk_index }) => ({
            document_id,
            title,
            chunk_index,
          }));

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ sources: citedSources })}\n\n`)
        );
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: "Something went wrong. Please try again." })}\n\n`
          )
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
  ctx: Context | undefined,
  db: Database,
  householdId: string,
  body: ChatRequest
): Promise<Response> {
  return handleChat(ctx, db, householdId, body);
}
