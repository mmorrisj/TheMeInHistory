import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { EraPack } from "../content/schema";
import type { GameState } from "../engine/state";
import { getClient, MODELS } from "./client";
import { SynthesistOutput } from "./schemas";

/**
 * Chapter synthesis.
 *
 * Two jobs at once, and they belong together: compress the chapter into durable
 * state so later turns are prompted from state rather than a growing
 * transcript, and build the Fact & Fiction ledger from what the chapter
 * actually claimed.
 */

const SYNTHESIST_RULES = `
You are closing a chapter of a historical-fiction adventure.

Produce two things.

1. story_so_far — a compressed account of everything that has happened,
   including what came before this chapter. 200-350 words, past tense, third
   person, naming what the character did, who they now know, what they carry
   and what is unresolved. This replaces the raw scene text in all future
   prompts, so anything you omit is forgotten permanently. Prioritise
   consequences and relationships over description.

2. ledger — the Fact & Fiction ledger for this chapter. One entry for each
   substantive historical claim the chapter made, sorted so the reader can see
   what was real:
   - "fact": documented, with the pack ids that back it and their sources.
   - "reconstruction": inferred from archaeology or comparable cases, not
     directly attested. Say what the inference rests on.
   - "contested": historians disagree. Say who disagrees and why — this is the
     most valuable kind of entry and readers should meet several.
   - "invention": made up for the story. Say so plainly and without apology;
     the point is that the reader can tell the difference.

   Write the claims as a reader would want to check them, not as the story
   phrased them. "Jamestown's water was brackish and made the colonists ill" is
   a good entry. "You drank from the river" is not.
`.trim();

export interface SynthesiseArgs {
  pack: EraPack;
  state: GameState;
}

export async function synthesise(args: SynthesiseArgs): Promise<SynthesistOutput> {
  const { pack, state } = args;

  const chapterText = state.turns
    .map((t) => `--- turn ${t.index}\n${t.prose}${t.chose ? `\n(chose: ${t.chose})` : ""}`)
    .join("\n\n");

  // Only the pack entries this chapter actually touched, so the synthesist
  // cites real ids and real sources rather than reaching for memory.
  const touchedIds = new Set(state.ledger.flatMap((l) => l.refs));
  const cited = [
    ...pack.timeline.filter((e) => touchedIds.has(e.id)),
  ].map(
    (e) =>
      `[${e.id}] ${e.date} ${e.title} (${e.certainty}) sources: ${e.source_ids.join(", ")}` +
      (e.note ? `\n  NOTE: ${e.note}` : ""),
  );

  const priorRefs = state.ledger
    .map(
      (l) =>
        `- ${l.kind}: ${l.claim}` +
        (l.refs.length ? ` [refs: ${l.refs.join(", ")}]` : "") +
        (l.source_ids.length ? ` [sources: ${l.source_ids.join(", ")}]` : ""),
    )
    .join("\n");

  const userContent = [
    `# PREVIOUS STORY SO FAR`,
    state.story_so_far || "(this is the first chapter)",
    ``,
    `# THIS CHAPTER`,
    chapterText,
    ``,
    `# PACK ENTRIES THIS CHAPTER REFERENCED`,
    cited.length ? cited.join("\n") : "(none recorded)",
    ``,
    `# CLAIMS AND INVENTIONS RECORDED DURING PLAY`,
    priorRefs || "(none recorded)",
    ``,
    `# CHARACTER`,
    `${state.character.name}, ${state.character.social_position}, currently at ` +
      `${state.place_id} on ${state.date}.`,
  ].join("\n");

  const response = await getClient().messages.parse({
    model: MODELS.synthesist,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(SynthesistOutput) },
    system: SYNTHESIST_RULES,
    messages: [{ role: "user", content: userContent }],
  });

  return (
    response.parsed_output ?? {
      story_so_far: state.story_so_far,
      chapter_title: `Chapter ${state.chapter}`,
      ledger: [],
    }
  );
}
