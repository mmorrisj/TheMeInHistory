import { NextResponse } from "next/server";
import { z } from "zod";
import { takeTurn } from "@/engine/turn";
import { describeApiError } from "@/llm/client";
import type { TurnPayload } from "@/ui/types";

export const runtime = "nodejs";
// Narration on a strong model with high effort can run well past the default.
export const maxDuration = 300;

const TurnBody = z.object({ choice: z.string().nullable() });

/** POST /api/session/:id/turn — advance the story one turn. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { choice } = TurnBody.parse(await req.json());
    const result = await takeTurn({ sessionId: id, choice });

    const payload: TurnPayload = {
      prose: result.turn.prose,
      choices: result.turn.choices,
      date: result.state.date,
      placeId: result.state.place_id,
      chapter: result.state.chapter,
      health: result.state.health,
      standing: result.state.standing,
      terms: result.terms,
      refs: result.refs,
      // Only errors reach the reader's screen; warnings are for the eval suite.
      warnings: result.blocklistHits
        .filter((h) => h.severity === "error")
        .map((h) => `"${h.matched}" — ${h.why}`),
      chapterClosed: result.chapter
        ? { title: result.chapter.title, ledger: result.chapter.ledger }
        : undefined,
    };

    return NextResponse.json(payload);
  } catch (err) {
    const { status, message } = describeApiError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
