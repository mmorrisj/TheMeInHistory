import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CONTENT_ROOT } from "../content/loader";

const TagEntry = z.object({
  id: z.string(),
  label: z.string(),
  aliases: z.array(z.string()).default([]),
});

const OntologyFile = z.object({
  skills: z.array(TagEntry),
  traits: z.array(TagEntry),
  interests: z.array(TagEntry),
});

export type TagEntry = z.infer<typeof TagEntry>;
export type TagKind = "skills" | "traits" | "interests";

let ontology: z.infer<typeof OntologyFile> | null = null;

export function getOntology(): z.infer<typeof OntologyFile> {
  ontology ??= OntologyFile.parse(
    parseYaml(readFileSync(join(CONTENT_ROOT, "ontology", "tags.yaml"), "utf8")),
  );
  return ontology;
}

export function allTags(): TagEntry[] {
  const o = getOntology();
  return [...o.skills, ...o.traits, ...o.interests];
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Map a free-text phrase the player typed onto an ontology tag.
 *
 * Deliberately conservative: an exact label or alias match, or a whole-word
 * containment either way. A near-miss returning nothing is better than a wrong
 * tag, because a wrong tag produces a confidently wrong era translation.
 */
export function resolveTag(input: string, kind?: TagKind): TagEntry | null {
  const needle = normalise(input);
  if (!needle) return null;
  const pool = kind ? getOntology()[kind] : allTags();

  for (const entry of pool) {
    if (normalise(entry.label) === needle) return entry;
    if (entry.aliases.some((a) => normalise(a) === needle)) return entry;
  }

  // Whole-word containment, longest candidate first so "first aid" beats "aid".
  const words = new Set(needle.split(" "));
  const scored = pool
    .map((entry) => {
      const candidates = [entry.label, ...entry.aliases].map(normalise);
      let best = 0;
      for (const c of candidates) {
        const cw = c.split(" ");
        if (cw.every((w) => words.has(w))) best = Math.max(best, cw.length);
        else if (needle.split(" ").every((w) => c.split(" ").includes(w))) {
          best = Math.max(best, needle.split(" ").length);
        }
      }
      return { entry, best };
    })
    .filter((s) => s.best > 0)
    .sort((a, b) => b.best - a.best);

  return scored[0]?.entry ?? null;
}

export interface NormalisedInput {
  /** Tags successfully resolved from the player's text. */
  tags: string[];
  /** Phrases that matched nothing, kept so the UI can say so honestly. */
  unmatched: string[];
}

/** Normalise a list of free-text phrases into ontology tags. */
export function normaliseAll(inputs: string[], kind: TagKind): NormalisedInput {
  const tags: string[] = [];
  const unmatched: string[] = [];
  for (const raw of inputs) {
    if (!raw.trim()) continue;
    const hit = resolveTag(raw, kind);
    if (hit && !tags.includes(hit.id)) tags.push(hit.id);
    else if (!hit) unmatched.push(raw.trim());
  }
  return { tags, unmatched };
}
