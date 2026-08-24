import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { EraPack } from "../content/schema";
import type { AffordanceResolution } from "../character/affordance";
import type { GameState } from "../engine/state";
import type { RetrievedContext } from "../engine/retrieval";
import { getClient, MODELS, NarrationError } from "./client";
import { NarratorOutput } from "./schemas";
import { retrievedContext, stableEraContext, stateContext } from "./context";

const NARRATOR_RULES = `
You are the narrator of a historical-fiction adventure. The reader plays one
character inside a real past, and learns history by being invested in what
happens to that character.

## What you produce
Second-person, present-tense prose of 200 to 400 words, then two to four
choices. Write like a novelist, not a textbook: concrete detail, physical
sensation, people who want things. Exposition that stops the story to explain
the period is a failure — the period must arrive through what the character
sees, smells, eats, fears, and cannot do.

## The grounding contract — this is the part that matters
You are given a set of retrieved historical facts, each with an id in square
brackets. These are the ONLY historical claims you may assert.

- Every historical claim in your prose goes in \`history_refs\` with the id that
  backs it and the exact phrase from your prose it applies to.
- Everything else historical-seeming that you write — a minor character, an
  unrecorded conversation, the specific weather, an ordinary object nobody
  documented — goes in \`invented\`, with a one-line basis for why it is
  consistent with the period.
- If a fact is not in the retrieved context and you cannot honestly declare it
  as an invention, do not write it. Write around it. You will be audited on
  exactly this gap, and a plausible-sounding invention presented as fact is the
  worst thing you can produce.
- Entries marked \`contested\` must never be asserted as settled. Write them as
  disputed, or leave them out.

## State
You do not own the state. Propose changes in \`state_delta\` and they will be
validated and applied by code. Do not narrate a state change you did not put in
the delta, and do not put one in the delta that your prose did not earn.
Advance \`date\` realistically: travel takes the hours the routes say it takes.

## Choices
Two to four. Each is an action the character takes, in second person, not an
outcome. They should be genuinely different in kind — not three flavours of
the same decision. At least one should be available to a person of this
character's exact station; do not offer a labourer a choice only a gentleman
could make. Use \`requires_flags\` when a choice depends on a capability.

## Fixed history
Some events cannot be averted. When a choice would change one, the story bends:
the character witnesses it, is caught in it, arrives too late, or tries and
fails. Never break frame to tell the reader they cannot do something.
`.trim();

export interface NarrateArgs {
  pack: EraPack;
  state: GameState;
  affordances: AffordanceResolution;
  context: RetrievedContext;
  /** The choice the player took, or null to open the story. */
  choice: string | null;
  /** Violations from a rejected previous attempt, fed back for a retry. */
  corrections?: string[];
}

export async function narrate(args: NarrateArgs): Promise<NarratorOutput> {
  const { pack, state, affordances, context, choice, corrections } = args;

  const instruction = choice
    ? `The player chose: "${choice}"\n\nWrite what happens next.`
    : `Open the story. Establish where and when the character is, who is near ` +
      `them, and what is pressing on them right now. Do not summarise the era; ` +
      `drop the reader into a specific moment.`;

  const userContent = [
    retrievedContext(context),
    stateContext(state, pack, affordances),
    corrections?.length
      ? `# YOUR PREVIOUS ATTEMPT WAS REJECTED\n` +
        corrections.map((c) => `- ${c}`).join("\n") +
        `\nFix these and write the scene again.`
      : "",
    `# NOW`,
    instruction,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const response = await getClient().messages.parse({
      model: MODELS.narrator,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: zodOutputFormat(NarratorOutput),
      },
      system: [
        {
          type: "text",
          text: `${NARRATOR_RULES}\n\n${stableEraContext(pack)}`,
          // The era rules are identical on every turn of a session and are by
          // far the largest stable block. Caching them is the single biggest
          // cost lever in the whole turn loop.
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
    });

    if (response.stop_reason === "refusal") {
      throw new NarrationError(
        `The narrator declined to write this scene` +
          (response.stop_details?.explanation
            ? `: ${response.stop_details.explanation}`
            : "."),
      );
    }

    if (!response.parsed_output) {
      throw new NarrationError("Narrator returned no parseable output.");
    }
    return response.parsed_output;
  } catch (err) {
    if (err instanceof NarrationError) throw err;
    throw new NarrationError("Narrator call failed", err);
  }
}
