import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { EraPack } from "../content/schema";
import type { RetrievedContext } from "../engine/retrieval";
import { getClient, MODELS } from "./client";
import { AuditorOutput, type NarratorOutput } from "./schemas";

/**
 * Grounding audit.
 *
 * Runs AFTER the prose has been sent to the reader, never before. A fact check
 * that makes the reader wait is a fact check nobody ships. Findings land in the
 * ledger and the chapter debrief; a high-severity finding can rewrite a
 * footnote, but it does not block the turn.
 */

const AUDITOR_RULES = `
You are a fact-checker for historical fiction. You are given a passage of
generated prose, the historical facts that were available to its author, and
the author's own declaration of what they made up.

Find claims in the prose that are:
- "unsupported": a historical assertion with no backing id in the available
  facts and not declared as an invention.
- "undeclared-invention": clearly invented material the author failed to
  declare — a named person, a specific document, a dated event.
- "anachronism": a word, object, concept or attitude that does not belong in
  the period.
- "contradiction": conflicts with a fact that WAS provided.

Do not flag: ordinary sensory detail (weather, a smell, the feel of a rope),
interior thought, or anything correctly listed in the author's declared
inventions. Furnishing a scene is not a factual claim.

grounding_rate is the fraction of identifiable HISTORICAL claims that are
either properly referenced or honestly declared. Prose that makes few
historical claims and grounds all of them scores 1.0.

Be strict about the difference between "unsupported" and "invention". An
invented innkeeper is fine if declared. An invented royal proclamation is not
fine even if declared, because it will read to a learner as history.
`.trim();

export interface AuditArgs {
  pack: EraPack;
  context: RetrievedContext;
  output: NarratorOutput;
}

export async function audit(args: AuditArgs): Promise<AuditorOutput> {
  const { pack, context, output } = args;

  const available = [
    ...context.events.map((e) => `[${e.id}] ${e.date} ${e.title}: ${e.summary}`),
    ...context.people.map((p) => `[${p.id}] ${p.name}, ${p.role}`),
    ...context.places.map((p) => `[${p.id}] ${p.name}: ${p.description}`),
    ...context.material.map((m) => `[${m.id}] ${m.name}: ${m.description}`),
  ].join("\n");

  const blocked = pack.blocklist.entries
    .map((b) => `- /${b.pattern}/ — ${b.why}`)
    .join("\n");

  const userContent = [
    `# FACTS AVAILABLE TO THE AUTHOR`,
    available,
    ``,
    `# KNOWN ANACHRONISMS FOR THIS ERA`,
    blocked,
    ``,
    `# THE AUTHOR'S DECLARED INVENTIONS`,
    output.invented.length
      ? output.invented.map((i) => `- ${i.what} (basis: ${i.basis})`).join("\n")
      : "(none declared)",
    ``,
    `# THE AUTHOR'S CLAIMED REFERENCES`,
    output.history_refs.length
      ? output.history_refs.map((r) => `- "${r.phrase}" -> [${r.ref_id}]`).join("\n")
      : "(none claimed)",
    ``,
    `# THE PROSE`,
    output.prose,
  ].join("\n");

  const response = await getClient().messages.parse({
    model: MODELS.auditor,
    max_tokens: 4000,
    output_config: { format: zodOutputFormat(AuditorOutput) },
    system: AUDITOR_RULES,
    messages: [{ role: "user", content: userContent }],
  });

  return (
    response.parsed_output ?? { grounding_rate: 0, findings: [] }
  );
}

/**
 * Deterministic anachronism scan.
 *
 * Runs locally on every turn with no model call, because a regex that catches
 * "okay" in 1607 should never cost a token or a round trip. The model auditor
 * catches what patterns cannot.
 */
export interface BlocklistHit {
  pattern: string;
  matched: string;
  why: string;
  instead?: string;
  severity: "error" | "warn";
}

export function scanBlocklist(pack: EraPack, prose: string): BlocklistHit[] {
  const hits: BlocklistHit[] = [];
  for (const entry of pack.blocklist.entries) {
    let re: RegExp;
    try {
      re = new RegExp(entry.pattern, "gi");
    } catch {
      // A malformed pattern is an authoring bug; pack-lint reports it. Skipping
      // here keeps a bad regex from taking down play.
      continue;
    }
    for (const m of prose.matchAll(re)) {
      hits.push({
        pattern: entry.pattern,
        matched: m[0],
        why: entry.why,
        instead: entry.instead,
        severity: entry.severity,
      });
    }
  }
  return hits;
}
