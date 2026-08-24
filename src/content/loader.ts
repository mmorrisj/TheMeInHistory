import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  Affordances,
  Blocklist,
  DailyLife,
  EraPack,
  Material,
  Language,
  PackMeta,
  People,
  Places,
  Sources,
  Timeline,
  Hooks,
} from "./schema";

/** Root of the authored content tree. Server-side only. */
export const CONTENT_ROOT = join(process.cwd(), "content");
const ERAS_ROOT = join(CONTENT_ROOT, "eras");

export class PackLoadError extends Error {
  constructor(
    readonly packId: string,
    readonly file: string,
    readonly issues: string[],
  ) {
    super(
      `Era Pack "${packId}" failed validation in ${file}:\n` +
        issues.map((i) => `  - ${i}`).join("\n"),
    );
    this.name = "PackLoadError";
  }
}

function readPackFile<T extends z.ZodType>(
  packDir: string,
  packId: string,
  file: string,
  schema: T,
): z.infer<T> {
  const path = join(packDir, file);
  if (!existsSync(path)) {
    throw new PackLoadError(packId, file, ["file is missing from the pack"]);
  }
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (err) {
    throw new PackLoadError(packId, file, [
      `YAML did not parse: ${(err as Error).message}`,
    ]);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new PackLoadError(
      packId,
      file,
      result.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    );
  }
  return result.data;
}

/**
 * Load and validate one Era Pack from disk.
 *
 * Schema validation happens here; cross-file referential integrity is the
 * linter's job (tools/pack-lint.ts), because a dangling id should fail the
 * build loudly rather than a request quietly.
 */
export function loadPack(packId: string): EraPack {
  const dir = join(ERAS_ROOT, packId);
  if (!existsSync(dir)) {
    throw new Error(`No Era Pack found at content/eras/${packId}`);
  }

  const pack: EraPack = {
    meta: readPackFile(dir, packId, "pack.yaml", PackMeta),
    timeline: readPackFile(dir, packId, "timeline.yaml", Timeline).events,
    people: readPackFile(dir, packId, "people.yaml", People).people,
    places: readPackFile(dir, packId, "places.yaml", Places).places,
    material: readPackFile(dir, packId, "material.yaml", Material),
    language: readPackFile(dir, packId, "language.yaml", Language),
    dailyLife: readPackFile(dir, packId, "daily-life.yaml", DailyLife),
    affordances: readPackFile(dir, packId, "affordances.yaml", Affordances)
      .affordances,
    blocklist: readPackFile(dir, packId, "blocklist.yaml", Blocklist),
    sources: readPackFile(dir, packId, "sources.yaml", Sources).sources,
    hooks: readPackFile(dir, packId, "hooks.yaml", Hooks),
  };

  return EraPack.parse(pack);
}

/** Ids of every pack directory on disk, reviewed or not. */
export function listPackIds(): string[] {
  if (!existsSync(ERAS_ROOT)) return [];
  return readdirSync(ERAS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Packs the runtime will actually play. A `draft` pack is unreviewed history
 * and must never reach a reader — that gate is the whole point of the status
 * field, so it is enforced here rather than left to callers.
 */
export function loadPlayablePacks(): EraPack[] {
  return listPackIds()
    .map(loadPack)
    .filter((p) => p.meta.status === "reviewed");
}

let cache: Map<string, EraPack> | null = null;

/** Cached load, since packs are static per deploy and re-parsing YAML is waste. */
export function getPack(packId: string): EraPack {
  cache ??= new Map();
  const hit = cache.get(packId);
  if (hit) return hit;
  const pack = loadPack(packId);
  if (pack.meta.status !== "reviewed") {
    throw new Error(
      `Era Pack "${packId}" is status=${pack.meta.status}. Only reviewed packs can be played.`,
    );
  }
  cache.set(packId, pack);
  return pack;
}

/** Test hook — drops the memoized packs. */
export function clearPackCache(): void {
  cache = null;
}
