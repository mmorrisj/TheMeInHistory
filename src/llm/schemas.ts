import { z } from "zod";
import { StateDelta } from "../engine/state";

/**
 * Structured output contracts for every model call.
 *
 * Prose is one field among several. Choices are never parsed out of free text,
 * and `invented` is required — see below.
 */

export const HistoryRef = z.object({
  /** Id of a timeline event, person, or place in the Era Pack. */
  ref_id: z.string(),
  /** The exact phrase in the prose this backs, so the UI can mark it. */
  phrase: z.string(),
  kind: z.enum(["event", "person", "place", "material"]),
});
export type HistoryRef = z.infer<typeof HistoryRef>;

export const Invention = z.object({
  /** The invented thing: a minor character, an unrecorded conversation. */
  what: z.string(),
  /** Why it is defensible: consistent with the period even if unattested. */
  basis: z.string(),
});
export type Invention = z.infer<typeof Invention>;

export const Choice = z.object({
  id: z.string(),
  /** Second person, present tense, an action rather than an outcome. */
  text: z.string(),
  /** Flags the character must hold for this to be offered. */
  requires_flags: z.array(z.string()).default([]),
});

export const NarratorOutput = z.object({
  /** The scene. 200-400 words. */
  prose: z.string(),
  choices: z.array(Choice).min(2).max(4),
  state_delta: StateDelta,
  /** Every historical claim in the prose, tied to a pack id. */
  history_refs: z.array(HistoryRef).default([]),
  /**
   * Everything in the prose that is NOT in the pack.
   *
   * This field is what makes the Fact & Fiction ledger honest. Anything
   * historical that appears in neither `history_refs` nor here is a grounding
   * failure, and the auditor exists to catch exactly that gap.
   */
  invented: z.array(Invention).default([]),
  /** Period terms worth a footnote, for the glossary. */
  new_terms: z.array(
    z.object({ term: z.string(), meaning: z.string() }),
  ).default([]),
});
export type NarratorOutput = z.infer<typeof NarratorOutput>;

export const AuditFinding = z.object({
  /** The claim in the prose that is not supported. */
  claim: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  /** What is wrong: unsupported, anachronistic, or contradicts the pack. */
  problem: z.enum(["unsupported", "anachronism", "contradiction", "undeclared-invention"]),
  explanation: z.string(),
});
export type AuditFinding = z.infer<typeof AuditFinding>;

export const AuditorOutput = z.object({
  /** Fraction of historical claims properly grounded, 0-1. */
  grounding_rate: z.number().min(0).max(1),
  findings: z.array(AuditFinding).default([]),
});
export type AuditorOutput = z.infer<typeof AuditorOutput>;

export const SynthesistOutput = z.object({
  /** Compressed narrative of the chapter, carried forward instead of turns. */
  story_so_far: z.string(),
  /** Title for the completed chapter. */
  chapter_title: z.string(),
  /** The Fact & Fiction ledger for this chapter. */
  ledger: z.array(
    z.object({
      kind: z.enum(["fact", "reconstruction", "invention", "contested"]),
      claim: z.string(),
      refs: z.array(z.string()).default([]),
      source_ids: z.array(z.string()).default([]),
      note: z.string().optional(),
    }),
  ).default([]),
});
export type SynthesistOutput = z.infer<typeof SynthesistOutput>;
