import { z } from "zod";
import { Character } from "../character/schema";

/**
 * Durable game state.
 *
 * The model never owns this. It proposes a `StateDelta`; `applyDelta` below is
 * the only thing that mutates state, and it is ordinary deterministic code. If
 * the narrator says "you now have the letter", the letter exists only after a
 * validated delta has been applied here.
 */

export const Relationship = z.object({
  /** Person id from the Era Pack, or a `fictional:` id for invented characters. */
  person_id: z.string(),
  /** -100 hostile to 100 devoted. Coarse on purpose; fine gradations are noise. */
  regard: z.number().int().min(-100).max(100),
  /** How the relationship reads right now, in a phrase. */
  standing: z.string(),
});
export type Relationship = z.infer<typeof Relationship>;

export const LedgerEntry = z.object({
  /** Turn this was recorded on. */
  turn: z.number().int().nonnegative(),
  kind: z.enum(["fact", "reconstruction", "invention", "contested"]),
  claim: z.string(),
  /** Timeline/person/place ids backing it, empty for inventions. */
  refs: z.array(z.string()).default([]),
  source_ids: z.array(z.string()).default([]),
  note: z.string().optional(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const Turn = z.object({
  index: z.number().int().nonnegative(),
  /** The choice the player took to arrive here; null for the opening scene. */
  chose: z.string().nullable(),
  prose: z.string(),
  choices: z.array(z.object({ id: z.string(), text: z.string() })),
  /** ISO timestamp, stamped by the server. */
  at: z.string(),
});
export type Turn = z.infer<typeof Turn>;

export const GameState = z.object({
  session_id: z.string(),
  pack_id: z.string(),
  hook_id: z.string(),
  character: Character,

  /** Where and when the story currently is. Retrieval and canon run off these. */
  date: z.string(),
  place_id: z.string(),

  /** Capability flags from affordance resolution plus anything earned in play. */
  flags: z.array(z.string()).default([]),
  inventory: z.array(z.string()).default([]),
  relationships: z.array(Relationship).default([]),

  /** Physical and social condition, 0-100. Coarse and legible. */
  health: z.number().int().min(0).max(100).default(80),
  standing: z.number().int().min(0).max(100).default(50),

  chapter: z.number().int().positive().default(1),
  /** Turns within the current chapter. Chapters cap at CHAPTER_LENGTH. */
  turns: z.array(Turn).default([]),
  /** Compressed summary of completed chapters, rebuilt by the synthesist. */
  story_so_far: z.string().default(""),

  ledger: z.array(LedgerEntry).default([]),
  /** Timeline event ids the player has witnessed or been caught up in. */
  witnessed: z.array(z.string()).default([]),

  created_at: z.string(),
  updated_at: z.string(),
});
export type GameState = z.infer<typeof GameState>;

/** Turns per chapter before the synthesist compresses and starts a new one. */
export const CHAPTER_LENGTH = 12;

/**
 * A state change proposed by the narrator.
 *
 * Everything is optional and additive-by-default. There is no "set arbitrary
 * field" escape hatch, so a hallucinated key cannot reach state at all.
 */
export const StateDelta = z.object({
  /** Advance the story clock. Must not move backwards. */
  date: z.string().optional(),
  place_id: z.string().optional(),
  add_flags: z.array(z.string()).default([]),
  remove_flags: z.array(z.string()).default([]),
  add_inventory: z.array(z.string()).default([]),
  remove_inventory: z.array(z.string()).default([]),
  /** Relative adjustments, clamped on apply. */
  health_change: z.number().int().min(-100).max(100).default(0),
  standing_change: z.number().int().min(-100).max(100).default(0),
  relationships: z.array(
    z.object({
      person_id: z.string(),
      regard_change: z.number().int().min(-100).max(100).default(0),
      standing: z.string().optional(),
    }),
  ).default([]),
  /** Timeline event ids the player has now witnessed. */
  witnessed: z.array(z.string()).default([]),
});
export type StateDelta = z.infer<typeof StateDelta>;

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/**
 * Apply a delta. Pure: returns new state, never mutates the input.
 *
 * Rejections are silent by design at this layer — `checkCanon` is what refuses
 * a delta outright, and it runs first. By the time we are here the delta has
 * already been judged legal, and clamping is just arithmetic hygiene.
 */
export function applyDelta(state: GameState, delta: StateDelta): GameState {
  const flags = new Set(state.flags);
  for (const f of delta.add_flags) flags.add(f);
  for (const f of delta.remove_flags) flags.delete(f);

  const inventory = new Set(state.inventory);
  for (const i of delta.add_inventory) inventory.add(i);
  for (const i of delta.remove_inventory) inventory.delete(i);

  const relationships = [...state.relationships];
  for (const change of delta.relationships) {
    const idx = relationships.findIndex(
      (r) => r.person_id === change.person_id,
    );
    if (idx === -1) {
      relationships.push({
        person_id: change.person_id,
        regard: clamp(change.regard_change, -100, 100),
        standing: change.standing ?? "newly met",
      });
    } else {
      const existing = relationships[idx]!;
      relationships[idx] = {
        person_id: existing.person_id,
        regard: clamp(existing.regard + change.regard_change, -100, 100),
        standing: change.standing ?? existing.standing,
      };
    }
  }

  return {
    ...state,
    date: delta.date ?? state.date,
    place_id: delta.place_id ?? state.place_id,
    flags: [...flags].sort(),
    inventory: [...inventory].sort(),
    relationships,
    health: clamp(state.health + delta.health_change, 0, 100),
    standing: clamp(state.standing + delta.standing_change, 0, 100),
    witnessed: [...new Set([...state.witnessed, ...delta.witnessed])],
    updated_at: new Date().toISOString(),
  };
}

/** Append a turn, rolling the chapter counter when the budget is spent. */
export function appendTurn(state: GameState, turn: Turn): GameState {
  return { ...state, turns: [...state.turns, turn] };
}

/** True when the chapter has run its budget and should be synthesised. */
export function chapterComplete(state: GameState): boolean {
  return state.turns.length >= CHAPTER_LENGTH;
}
