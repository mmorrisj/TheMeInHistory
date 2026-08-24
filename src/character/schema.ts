import { z } from "zod";

/** A tag from the shared ontology, e.g. `skill.carpentry`. */
export const Tag = z
  .string()
  .regex(/^(skill|trait|interest)\.[a-z-]+$/, "tags look like `skill.carpentry`");

/**
 * A player character.
 *
 * `social_position` is captured explicitly and first because in most historical
 * settings it constrains the story far more than personality does. Treating it
 * as a core field rather than a detail is a deliberate design position.
 */
export const Character = z.object({
  name: z.string().min(1).max(60),
  age: z.number().int().min(12).max(80),
  /** Free text, shown to the narrator verbatim. Optional colour. */
  background: z.string().max(600).default(""),
  /** Id of a social position defined by the Era Pack. */
  social_position: z.string(),
  skills: z.array(Tag).max(8).default([]),
  traits: z.array(Tag).max(6).default([]),
  interests: z.array(Tag).max(6).default([]),
  /** Pronouns used for the character in narration. */
  pronouns: z.enum(["she/her", "he/him", "they/them"]).default("they/them"),
});
export type Character = z.infer<typeof Character>;

/** What a raw, unnormalised character intake looks like from the UI. */
export const CharacterDraft = Character.omit({
  skills: true,
  traits: true,
  interests: true,
}).extend({
  /** Free text the player typed; normalised into tags by the ontology. */
  skills_text: z.array(z.string()).default([]),
  traits_text: z.array(z.string()).default([]),
  interests_text: z.array(z.string()).default([]),
});
export type CharacterDraft = z.infer<typeof CharacterDraft>;
