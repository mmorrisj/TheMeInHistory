import { NextResponse } from "next/server";
import { z } from "zod";
import { getPack } from "@/content/loader";
import { Character } from "@/character/schema";
import { normaliseAll } from "@/character/ontology";
import { resolveAffordances } from "@/character/affordance";
import { startSession } from "@/engine/turn";
import { describeApiError } from "@/llm/client";
import type { TranslationPreview } from "@/ui/types";

export const runtime = "nodejs";

const CreateBody = z.object({
  pack_id: z.string(),
  hook_id: z.string(),
  character: Character.omit({ skills: true, traits: true, interests: true }).extend({
    skills_text: z.array(z.string()).default([]),
    traits_text: z.array(z.string()).default([]),
    interests_text: z.array(z.string()).default([]),
  }),
});

/** POST /api/session — normalise a character draft and open a session. */
export async function POST(req: Request) {
  try {
    const body = CreateBody.parse(await req.json());
    const pack = getPack(body.pack_id);

    const skills = normaliseAll(body.character.skills_text, "skills");
    const traits = normaliseAll(body.character.traits_text, "traits");
    const interests = normaliseAll(body.character.interests_text, "interests");

    const character = Character.parse({
      ...body.character,
      skills: skills.tags,
      traits: traits.tags,
      interests: interests.tags,
    });

    const affordances = resolveAffordances(character, pack);
    const state = await startSession({
      packId: body.pack_id,
      hookId: body.hook_id,
      character,
    });

    const translations: TranslationPreview[] = affordances.resolved.map((a) => ({
      tag: a.tag,
      label: a.tag.split(".")[1] ?? a.tag,
      eraName: a.eraName,
      plausibility: a.plausibility,
      translation: a.translation,
    }));

    return NextResponse.json({
      session_id: state.session_id,
      translations,
      untranslated: affordances.untranslated.map((u) => u.tag),
      // Told to the player rather than silently dropped.
      unmatched: [...skills.unmatched, ...traits.unmatched, ...interests.unmatched],
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 400 },
      );
    }
    const { status, message } = describeApiError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
