import { z } from "zod";

import { ask } from "@/lib/agent/pipeline";
import { serializeResult, type StreamEvent } from "@/lib/agent/serialize";

/**
 * The pipeline reads a SQLite file from disk and may hold a local embedding
 * model in memory, so this route runs on Node rather than the edge runtime.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .max(20)
    .optional(),
});

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Please send a message between 1 and 4000 characters." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        const result = await ask(parsed.data.message, {
          history: parsed.data.history,
          onStage: (stage) => send({ type: "stage", stage }),
        });
        send({ type: "result", result: serializeResult(result) });
      } catch (err) {
        // The message may name a missing API key or an unbuilt corpus, both of
        // which are actionable for whoever is running this.
        console.error("ask failed:", err);
        send({
          type: "error",
          message:
            err instanceof Error ? err.message : "Something went wrong.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
