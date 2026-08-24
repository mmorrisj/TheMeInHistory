#!/usr/bin/env tsx
/**
 * Era Pack linter.
 *
 * Schema validation happens in the loader. This checks the things a schema
 * cannot: that cross-file ids resolve, that every source referenced exists,
 * that regexes compile, that fixed events are ordered sensibly, and that the
 * pack does not quietly claim more certainty than its sources support.
 *
 * Run with `npm run pack:lint`. Exits non-zero on any error.
 */
import { listPackIds, loadPack, PackLoadError } from "../src/content/loader";
import { getOntology } from "../src/character/ontology";
import type { EraPack } from "../src/content/schema";

interface Problem {
  level: "error" | "warn";
  where: string;
  message: string;
}

function lintPack(pack: EraPack): Problem[] {
  const problems: Problem[] = [];
  const err = (where: string, message: string) =>
    problems.push({ level: "error", where, message });
  const warn = (where: string, message: string) =>
    problems.push({ level: "warn", where, message });

  const sourceIds = new Set(pack.sources.map((s) => s.id));
  const personIds = new Set(pack.people.map((p) => p.id));
  const placeIds = new Set(pack.places.map((p) => p.id));
  const eventIds = new Set(pack.timeline.map((e) => e.id));
  const positionIds = new Set(pack.meta.social_positions.map((p) => p.id));

  // --- Sources resolve --------------------------------------------------------
  const checkSources = (where: string, ids: string[]) => {
    for (const id of ids) {
      if (!sourceIds.has(id)) err(where, `unknown source id "${id}"`);
    }
  };

  for (const e of pack.timeline) {
    checkSources(`timeline/${e.id}`, e.source_ids);
    for (const p of e.people) {
      if (!personIds.has(p)) err(`timeline/${e.id}`, `unknown person id "${p}"`);
    }
    for (const p of e.places) {
      if (!placeIds.has(p)) err(`timeline/${e.id}`, `unknown place id "${p}"`);
    }
    if (e.end_date && e.end_date < e.date) {
      err(`timeline/${e.id}`, `end_date ${e.end_date} precedes date ${e.date}`);
    }
    if (e.certainty !== "established" && !e.note) {
      warn(
        `timeline/${e.id}`,
        `certainty is "${e.certainty}" but no note explains the doubt`,
      );
    }
  }

  for (const p of pack.people) {
    checkSources(`people/${p.id}`, p.source_ids);
    for (const w of p.presence) {
      if (!placeIds.has(w.place_id)) {
        err(`people/${p.id}`, `presence names unknown place "${w.place_id}"`);
      }
      if (w.until && w.until < w.from) {
        err(`people/${p.id}`, `presence window ends (${w.until}) before it starts (${w.from})`);
      }
    }
    if (p.born && p.died && p.died < p.born) {
      err(`people/${p.id}`, `died ${p.died} before born ${p.born}`);
    }
  }

  for (const p of pack.places) {
    checkSources(`places/${p.id}`, p.source_ids);
    for (const r of p.routes) {
      if (!placeIds.has(r.to)) err(`places/${p.id}`, `route to unknown place "${r.to}"`);
    }
  }

  for (const m of pack.material.items) {
    checkSources(`material/${m.id}`, m.source_ids);
    for (const pos of m.available_to) {
      if (!positionIds.has(pos)) {
        err(`material/${m.id}`, `available_to names unknown social position "${pos}"`);
      }
    }
  }
  for (const e of pack.material.economy) checkSources(`material/economy/${e.id}`, e.source_ids);
  for (const v of pack.language.vocabulary) checkSources(`language/${v.term}`, v.source_ids);
  for (const r of pack.dailyLife.routines) {
    checkSources(`daily-life/${r.id}`, r.source_ids);
    if (!positionIds.has(r.social_position)) {
      err(`daily-life/${r.id}`, `unknown social position "${r.social_position}"`);
    }
  }

  // --- Affordances -------------------------------------------------------------
  const ontologyTags = new Set([
    ...getOntology().skills.map((t) => t.id),
    ...getOntology().traits.map((t) => t.id),
    ...getOntology().interests.map((t) => t.id),
  ]);
  for (const a of pack.affordances) {
    checkSources(`affordances/${a.tag}`, a.source_ids);
    if (!ontologyTags.has(a.tag)) {
      err(`affordances/${a.tag}`, `tag is not in content/ontology/tags.yaml`);
    }
    for (const pos of Object.keys(a.plausibility)) {
      if (!positionIds.has(pos)) {
        err(`affordances/${a.tag}`, `plausibility names unknown position "${pos}"`);
      }
    }
    for (const pos of positionIds) {
      if (!(pos in a.plausibility)) {
        warn(
          `affordances/${a.tag}`,
          `no plausibility for "${pos}" — the resolver will default to "rare"`,
        );
      }
    }
  }

  // --- Hooks --------------------------------------------------------------------
  for (const h of pack.hooks.hooks) {
    if (!placeIds.has(h.opens.place_id)) {
      err(`hooks/${h.id}`, `opens at unknown place "${h.opens.place_id}"`);
    }
    for (const pos of h.social_positions) {
      if (!positionIds.has(pos)) {
        err(`hooks/${h.id}`, `unknown social position "${pos}"`);
      }
    }
    for (const e of h.leads_to) {
      if (!eventIds.has(e)) err(`hooks/${h.id}`, `leads_to unknown event "${e}"`);
    }
    const place = pack.places.find((p) => p.id === h.opens.place_id);
    if (place?.exists_from && h.opens.date < place.exists_from) {
      err(
        `hooks/${h.id}`,
        `opens ${h.opens.date} but ${place.name} does not exist until ${place.exists_from}`,
      );
    }
    if (h.opens.date < pack.meta.date_range.start || h.opens.date > pack.meta.date_range.end) {
      err(`hooks/${h.id}`, `opening date ${h.opens.date} is outside the pack's range`);
    }
  }

  // --- Blocklist regexes compile -------------------------------------------------
  for (const b of pack.blocklist.entries) {
    try {
      new RegExp(b.pattern, "gi");
    } catch (e) {
      err(`blocklist`, `pattern /${b.pattern}/ does not compile: ${(e as Error).message}`);
    }
  }

  // --- Coverage warnings ----------------------------------------------------------
  const usedSources = new Set([
    ...pack.timeline.flatMap((e) => e.source_ids),
    ...pack.people.flatMap((p) => p.source_ids),
    ...pack.places.flatMap((p) => p.source_ids),
    ...pack.material.items.flatMap((m) => m.source_ids),
    ...pack.affordances.flatMap((a) => a.source_ids),
  ]);
  for (const s of pack.sources) {
    if (!usedSources.has(s.id)) warn(`sources/${s.id}`, `source is never cited`);
  }
  for (const pos of positionIds) {
    if (!pack.dailyLife.routines.some((r) => r.social_position === pos)) {
      warn(`daily-life`, `no routine for social position "${pos}"`);
    }
    if (!pack.hooks.hooks.some((h) => h.social_positions.includes(pos))) {
      warn(`hooks`, `no hook is playable as "${pos}"`);
    }
  }

  return problems;
}

function main(): void {
  const ids = listPackIds();
  if (ids.length === 0) {
    console.error("No Era Packs found under content/eras/");
    process.exit(1);
  }

  let errors = 0;
  let warnings = 0;

  for (const id of ids) {
    let pack: EraPack;
    try {
      pack = loadPack(id);
    } catch (e) {
      if (e instanceof PackLoadError) console.error(`\n${e.message}`);
      else console.error(`\n${id}: ${(e as Error).message}`);
      errors++;
      continue;
    }

    const problems = lintPack(pack);
    const errs = problems.filter((p) => p.level === "error");
    const warns = problems.filter((p) => p.level === "warn");
    errors += errs.length;
    warnings += warns.length;

    const counts =
      `${pack.timeline.length} events, ${pack.people.length} people, ` +
      `${pack.places.length} places, ${pack.affordances.length} affordances, ` +
      `${pack.sources.length} sources`;
    console.log(`\n${id} [${pack.meta.status}] — ${counts}`);

    for (const p of errs) console.log(`  ERROR  ${p.where}: ${p.message}`);
    for (const p of warns) console.log(`  warn   ${p.where}: ${p.message}`);
    if (problems.length === 0) console.log("  clean");
  }

  console.log(
    `\n${ids.length} pack(s): ${errors} error(s), ${warnings} warning(s).`,
  );
  process.exit(errors > 0 ? 1 : 0);
}

main();
