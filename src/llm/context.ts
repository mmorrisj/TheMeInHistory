import type { EraPack } from "../content/schema";
import type { RetrievedContext } from "../engine/retrieval";
import type { GameState } from "../engine/state";
import type { AffordanceResolution } from "../character/affordance";
import { socialPosition } from "../character/affordance";
import { nextFixedEvent } from "../engine/canon";

/**
 * Prompt assembly.
 *
 * Split deliberately into a STABLE half and a VOLATILE half. The stable half —
 * the era's rules, language register, content posture and blocklist — is
 * identical on every turn of a session and carries the cache breakpoint. The
 * volatile half (retrieved facts, current state) changes per turn and must come
 * after it, or the cache is invalidated on every request.
 */

/** Era rules that never change within a session. Cache this. */
export function stableEraContext(pack: EraPack): string {
  const lang = pack.language;
  return [
    `# SETTING: ${pack.meta.title}`,
    pack.meta.blurb,
    ``,
    `Date range: ${pack.meta.date_range.start} to ${pack.meta.date_range.end}.`,
    ``,
    `# HOW THE PROSE MUST SOUND`,
    lang.register,
    ``,
    `## Period vocabulary available to you`,
    ...lang.vocabulary.map((v) => `- ${v.term}: ${v.meaning}${v.usage ? ` (${v.usage})` : ""}`),
    ``,
    `## Forms of address`,
    ...lang.forms_of_address.map((f) => `- ${f.speaker} to ${f.addressee}: ${f.form}`),
    ``,
    `## Never write these`,
    ...lang.avoid.map((a) => `- "${a.modern}" -> use ${a.instead}. ${a.why}`),
    ``,
    `## Terms that need care`,
    ...lang.contested_terms.map(
      (t) => `- "${t.period_term}" (modern: ${t.modern_term}): ${t.guidance}`,
    ),
    ``,
    `# CONTENT POSTURE`,
    `This era unavoidably contains:`,
    ...pack.meta.content_posture.unavoidable.map((s) => `- ${s}`),
    ``,
    `Depict on the page:`,
    ...pack.meta.content_posture.depicts.map((s) => `- ${s}`),
    ``,
    `Report but never stage as a scene:`,
    ...pack.meta.content_posture.reports.map((s) => `- ${s}`),
    ``,
    `Never write at all:`,
    ...pack.meta.content_posture.refuses.map((s) => `- ${s}`),
    ``,
    `## Outcomes no player choice can change`,
    ...pack.meta.content_posture.fixed_outcomes.map((s) => `- ${s}`),
    ``,
    `When a player's choice would avert one of these, do not silently allow it.`,
    `Bend the story: the character witnesses the outcome, is swept up in it, or`,
    `arrives too late. Never issue an error message in the prose; make the`,
    `constraint part of the narrative.`,
  ].join("\n");
}

/** The facts retrieved for THIS turn. Volatile — must follow the cached prefix. */
export function retrievedContext(ctx: RetrievedContext): string {
  const lines: string[] = [`# WHAT IS TRUE RIGHT NOW`, ``];

  if (ctx.events.length) {
    lines.push(`## Events in play`);
    for (const e of ctx.events) {
      lines.push(
        `- [${e.id}] ${e.date} — ${e.title} (${e.certainty}${e.fixed ? ", FIXED" : ""})`,
        `  ${e.summary}`,
      );
      if (e.note) lines.push(`  NOTE: ${e.note}`);
    }
    lines.push(``);
  }

  if (ctx.people.length) {
    lines.push(`## People available`);
    for (const p of ctx.people) {
      lines.push(
        `- [${p.id}] ${p.name}${p.also_known_as.length ? ` (also: ${p.also_known_as.join(", ")})` : ""} — ${p.role}`,
        `  Character: ${p.character}`,
        `  LIMITS: ${p.portrayal_limits}`,
      );
    }
    lines.push(``);
  }

  if (ctx.places.length) {
    lines.push(`## Places`);
    for (const p of ctx.places) {
      lines.push(`- [${p.id}] ${p.name} — ${p.description}`);
      if (p.sensory.length) {
        lines.push(`  Sensory detail you may use: ${p.sensory.join(" | ")}`);
      }
      if (p.routes.length) {
        lines.push(
          `  Travel: ${p.routes.map((r) => `${r.to} ${r.hours}h by ${r.means}`).join("; ")}`,
        );
      }
    }
    lines.push(``);
  }

  if (ctx.material.length) {
    lines.push(`## Material culture`);
    for (const m of ctx.material) {
      lines.push(`- [${m.id}] ${m.name} (${m.category}): ${m.description}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

/** Current game state, rendered for the prompt. */
export function stateContext(
  state: GameState,
  pack: EraPack,
  affordances: AffordanceResolution,
): string {
  const c = state.character;
  const pos = socialPosition(pack, c.social_position);
  const upcoming = nextFixedEvent(pack, state.date);
  const hook = pack.hooks.hooks.find((h) => h.id === state.hook_id);

  const lines = [
    `# THE CHARACTER`,
    `${c.name}, aged ${c.age}. Pronouns: ${c.pronouns}.`,
    `Social position: ${pos?.label ?? c.social_position}. ${pos?.description ?? ""}`,
  ];
  if (pos?.constraints.length) {
    lines.push(`Constraints of that position:`);
    lines.push(...pos.constraints.map((s) => `- ${s}`));
  }
  if (c.background) lines.push(``, `Background the player wrote: ${c.background}`);

  if (affordances.resolved.length) {
    lines.push(``, `## What they can do, translated into this era`);
    for (const a of affordances.resolved) {
      lines.push(
        `- ${a.tag} -> "${a.eraName}" (${a.plausibility} for their station)`,
        `  ${a.translation}`,
        `  How the era reads it: ${a.socialReading}`,
      );
    }
  }
  if (affordances.remarkable.length) {
    lines.push(
      ``,
      `## Unusual for their station — make this friction visible in the story`,
      ...affordances.remarkable.map(
        (a) => `- "${a.eraName}" is ${a.plausibility} for a ${pos?.label ?? c.social_position}.`,
      ),
    );
  }
  if (affordances.untranslated.length) {
    lines.push(
      ``,
      `## No equivalent in this era`,
      ...affordances.untranslated.map(
        (u) => `- ${u.tag}: this era has nothing corresponding. Do not invent one.`,
      ),
    );
  }

  lines.push(
    ``,
    `# CURRENT STATE`,
    `Date: ${state.date}`,
    `Place: ${state.place_id}`,
    `Health: ${state.health}/100. Standing: ${state.standing}/100.`,
    `Flags: ${state.flags.length ? state.flags.join(", ") : "(none)"}`,
    `Carrying: ${state.inventory.length ? state.inventory.join(", ") : "(nothing of note)"}`,
  );

  if (state.relationships.length) {
    lines.push(
      `Relationships:`,
      ...state.relationships.map(
        (r) => `- ${r.person_id}: regard ${r.regard}, ${r.standing}`,
      ),
    );
  }

  if (hook) {
    lines.push(``, `# THE STORY'S PREMISE`, hook.premise);
    lines.push(`This chapter should help the reader understand:`);
    lines.push(...hook.teaches.map((t) => `- ${t}`));
  }

  if (upcoming) {
    lines.push(
      ``,
      `# HEADING TOWARD`,
      `[${upcoming.id}] ${upcoming.date} — ${upcoming.title}`,
      upcoming.summary,
      `This is fixed. The story moves toward it; the player cannot avert it.`,
    );
  }

  if (state.story_so_far) {
    lines.push(``, `# THE STORY SO FAR`, state.story_so_far);
  }

  if (state.turns.length) {
    lines.push(``, `# THIS CHAPTER SO FAR`);
    // Recent turns verbatim; earlier ones are already compressed into
    // story_so_far, so the prompt is rebuilt from state rather than transcript.
    for (const t of state.turns.slice(-3)) {
      lines.push(`--- turn ${t.index}`, t.prose);
      if (t.chose) lines.push(`(the player then chose: ${t.chose})`);
    }
  }

  return lines.join("\n");
}
