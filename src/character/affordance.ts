import type { Affordance, EraPack } from "../content/schema";
import type { Character } from "./schema";

export type Plausibility = "common" | "uncommon" | "rare" | "implausible";

export interface ResolvedAffordance {
  tag: string;
  /** What the era calls this. */
  eraName: string;
  /** How likely someone of this character's social position is to have it. */
  plausibility: Plausibility;
  /** Shown to the player: how their modern trait lands in this era. */
  translation: string;
  /** How the era reads a person who has this. */
  socialReading: string;
  /** State flags this unlocks. */
  enables: string[];
  sourceIds: string[];
}

/** A tag the player chose that this era simply has no equivalent for. */
export interface UntranslatedTag {
  tag: string;
  reason: "no-mapping";
}

export interface AffordanceResolution {
  resolved: ResolvedAffordance[];
  /** Tags with no mapping in this pack. Told to the player, not hidden. */
  untranslated: UntranslatedTag[];
  /** Union of every `enables` flag, for gating choices. */
  flags: string[];
  /**
   * Affordances the character has that are rare or implausible for their
   * position. These are the interesting ones — the friction is the teaching
   * moment, so they are surfaced rather than smoothed away.
   */
  remarkable: ResolvedAffordance[];
}

function plausibilityFor(
  affordance: Affordance,
  socialPosition: string,
): Plausibility {
  // An unlisted position means the pack author did not consider it. Treat that
  // as `rare` rather than `common`: assuming a capability is ordinary is the
  // failure mode that flattens a period, and assuming it is impossible would
  // silently drop the player's choice.
  return (affordance.plausibility[socialPosition] as Plausibility) ?? "rare";
}

/**
 * Resolve a character's tags against an Era Pack.
 *
 * This is the character-to-era bridge: it decides what a modern person's
 * skills, traits and interests actually mean in the setting, and it refuses to
 * either reject them or import them unchanged.
 */
export function resolveAffordances(
  character: Character,
  pack: EraPack,
): AffordanceResolution {
  const wanted = [
    ...character.skills,
    ...character.traits,
    ...character.interests,
  ];
  const byTag = new Map(pack.affordances.map((a) => [a.tag, a]));

  const resolved: ResolvedAffordance[] = [];
  const untranslated: UntranslatedTag[] = [];

  for (const tag of wanted) {
    const affordance = byTag.get(tag);
    if (!affordance) {
      untranslated.push({ tag, reason: "no-mapping" });
      continue;
    }
    const plausibility = plausibilityFor(affordance, character.social_position);
    resolved.push({
      tag,
      eraName: affordance.era_name,
      plausibility,
      translation: affordance.translation,
      socialReading: affordance.social_reading,
      // An implausible capability grants nothing mechanically. The story can
      // still discuss it — that conversation is the point — but it must not
      // unlock choices a person of this station could not have.
      enables: plausibility === "implausible" ? [] : affordance.enables,
      sourceIds: affordance.source_ids,
    });
  }

  const flags = [...new Set(resolved.flatMap((r) => r.enables))].sort();
  const remarkable = resolved.filter(
    (r) => r.plausibility === "rare" || r.plausibility === "implausible",
  );

  return { resolved, untranslated, flags, remarkable };
}

/** The social position record from the pack, for prompt and UI use. */
export function socialPosition(pack: EraPack, id: string) {
  return pack.meta.social_positions.find((p) => p.id === id) ?? null;
}
