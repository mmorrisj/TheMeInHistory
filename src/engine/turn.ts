import { randomUUID } from "node:crypto";
import type { EraPack } from "../content/schema";
import { getPack } from "../content/loader";
import { resolveAffordances } from "../character/affordance";
import type { Character } from "../character/schema";
import { checkCanon, type CanonViolation } from "./canon";
import { queryFromState, retrieve } from "./retrieval";
import {
  applyDelta,
  appendTurn,
  chapterComplete,
  GameState,
  type LedgerEntry,
  type Turn,
} from "./state";
import { getStore } from "./store";
import { narrate } from "../llm/narrator";
import { audit, scanBlocklist, type BlocklistHit } from "../llm/auditor";
import { synthesise } from "../llm/synthesist";
import type { NarratorOutput } from "../llm/schemas";

/** How many times a rejected scene is re-requested before we give up. */
const MAX_NARRATOR_RETRIES = 2;

export interface TurnResult {
  state: GameState;
  turn: Turn;
  /** Period terms from this scene, for the glossary sidebar. */
  terms: { term: string; meaning: string }[];
  /** Phrase-to-id links, for inline footnote markers. */
  refs: NarratorOutput["history_refs"];
  /** Deterministic anachronism hits. Surfaced in dev, logged in prod. */
  blocklistHits: BlocklistHit[];
  /** Set when the chapter closed on this turn. */
  chapter?: { title: string; ledger: LedgerEntry[] };
}

/** Create a new session from a character and a story hook. */
export async function startSession(args: {
  packId: string;
  hookId: string;
  character: Character;
}): Promise<GameState> {
  const pack = getPack(args.packId);
  const hook = pack.hooks.hooks.find((h) => h.id === args.hookId);
  if (!hook) throw new Error(`No hook "${args.hookId}" in pack ${args.packId}`);
  if (!hook.social_positions.includes(args.character.social_position)) {
    throw new Error(
      `Hook "${hook.id}" does not support the social position ` +
        `"${args.character.social_position}". Supported: ${hook.social_positions.join(", ")}`,
    );
  }

  const affordances = resolveAffordances(args.character, pack);
  const now = new Date().toISOString();

  const state: GameState = GameState.parse({
    session_id: randomUUID().replace(/-/g, "").slice(0, 24),
    pack_id: args.packId,
    hook_id: args.hookId,
    character: args.character,
    date: hook.opens.date,
    place_id: hook.opens.place_id,
    flags: affordances.flags,
    inventory: [],
    relationships: [],
    health: 80,
    standing: 50,
    chapter: 1,
    turns: [],
    story_so_far: "",
    ledger: [],
    witnessed: [],
    created_at: now,
    updated_at: now,
  });

  await getStore().save(state);
  return state;
}

function violationMessages(v: CanonViolation[]): string[] {
  return v.filter((x) => x.blocking).map((x) => x.message);
}

/** Ledger entries derived from what the narrator declared on this turn. */
function ledgerFromOutput(
  pack: EraPack,
  output: NarratorOutput,
  turnIndex: number,
): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const byId = new Map<string, { certainty: string; sources: string[]; note?: string }>();
  for (const e of pack.timeline) {
    byId.set(e.id, { certainty: e.certainty, sources: e.source_ids, note: e.note });
  }
  for (const p of pack.people) {
    byId.set(p.id, { certainty: p.certainty, sources: p.source_ids, note: p.note });
  }
  for (const p of pack.places) {
    byId.set(p.id, { certainty: p.certainty, sources: p.source_ids, note: p.note });
  }

  for (const ref of output.history_refs) {
    const meta = byId.get(ref.ref_id);
    if (!meta) continue;
    entries.push({
      turn: turnIndex,
      kind:
        meta.certainty === "contested"
          ? "contested"
          : meta.certainty === "established"
            ? "fact"
            : "reconstruction",
      claim: ref.phrase,
      refs: [ref.ref_id],
      source_ids: meta.sources,
      note: meta.note,
    });
  }

  for (const inv of output.invented) {
    entries.push({
      turn: turnIndex,
      kind: "invention",
      claim: inv.what,
      refs: [],
      source_ids: [],
      note: inv.basis,
    });
  }

  return entries;
}

/**
 * Advance the story by one turn.
 *
 * Order matters: narrate, validate against canon, retry on a blocking
 * violation, apply the delta deterministically, persist, and only then run the
 * grounding audit. The audit is intentionally last and non-blocking.
 */
export async function takeTurn(args: {
  sessionId: string;
  /** Choice id or free text. Null opens the story. */
  choice: string | null;
  /** Skip the model audit — used by tests and by the offline pack linter. */
  skipAudit?: boolean;
}): Promise<TurnResult> {
  const store = getStore();
  const state = await store.load(args.sessionId);
  if (!state) throw new Error(`No session ${args.sessionId}`);

  const pack = getPack(state.pack_id);
  const affordances = resolveAffordances(state.character, pack);
  const context = retrieve(pack, queryFromState(state, pack, args.choice ?? undefined));

  let output: NarratorOutput | null = null;
  let corrections: string[] = [];

  for (let attempt = 0; attempt <= MAX_NARRATOR_RETRIES; attempt++) {
    const candidate = await narrate({
      pack,
      state,
      affordances,
      context,
      choice: args.choice,
      corrections: corrections.length ? corrections : undefined,
    });

    const violations = checkCanon(pack, state, candidate.state_delta);
    const blocking = violationMessages(violations);
    if (blocking.length === 0) {
      output = candidate;
      break;
    }
    corrections = blocking;
    // On the last attempt, take the scene but drop the parts of the delta that
    // broke canon rather than failing the turn outright. A slightly under-
    // applied delta is recoverable; a dead session is not.
    if (attempt === MAX_NARRATOR_RETRIES) {
      output = {
        ...candidate,
        state_delta: {
          ...candidate.state_delta,
          date: undefined,
          place_id: undefined,
        },
      };
    }
  }

  if (!output) throw new Error("Narrator produced no usable scene.");

  const turnIndex = state.turns.length;
  const turn: Turn = {
    index: turnIndex,
    chose: args.choice,
    prose: output.prose,
    choices: output.choices.map((c) => ({ id: c.id, text: c.text })),
    at: new Date().toISOString(),
  };

  let next = applyDelta(state, output.state_delta);
  next = appendTurn(next, turn);
  next = {
    ...next,
    ledger: [...next.ledger, ...ledgerFromOutput(pack, output, turnIndex)],
  };

  const blocklistHits = scanBlocklist(pack, output.prose);

  let chapter: TurnResult["chapter"];
  if (chapterComplete(next)) {
    const synth = await synthesise({ pack, state: next });
    const ledger: LedgerEntry[] = synth.ledger.map((l) => ({
      turn: turnIndex,
      kind: l.kind,
      claim: l.claim,
      refs: l.refs,
      source_ids: l.source_ids,
      note: l.note,
    }));
    chapter = { title: synth.chapter_title, ledger };
    next = {
      ...next,
      chapter: next.chapter + 1,
      turns: [],
      story_so_far: synth.story_so_far,
      ledger: [...next.ledger, ...ledger],
    };
  }

  await store.save(next);

  // Fire-and-forget: the reader already has the prose. Findings are folded into
  // the ledger on completion and never gate the response.
  if (!args.skipAudit) {
    void audit({ pack, context, output })
      .then(async (result) => {
        if (result.findings.length === 0) return;
        const current = await store.load(next.session_id);
        if (!current) return;
        await store.save({
          ...current,
          ledger: [
            ...current.ledger,
            ...result.findings
              .filter((f) => f.severity !== "low")
              .map((f) => ({
                turn: turnIndex,
                kind: "invention" as const,
                claim: f.claim,
                refs: [],
                source_ids: [],
                note: `Flagged by the grounding audit (${f.problem}): ${f.explanation}`,
              })),
          ],
        });
      })
      .catch((err: unknown) => {
        console.error("Grounding audit failed:", err);
      });
  }

  return {
    state: next,
    turn,
    terms: output.new_terms,
    refs: output.history_refs,
    blocklistHits,
    chapter,
  };
}
