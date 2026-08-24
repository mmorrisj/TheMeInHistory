import type {
  Affordance,
  EraPack,
  MaterialItem,
  Person,
  Place,
  TimelineEvent,
} from "../content/schema";
import type { GameState } from "./state";
import { dateKey } from "./canon";

/**
 * Era Pack retrieval.
 *
 * Hybrid by design: a hard filter first (what is legal at this date and place),
 * then lexical scoring within what survives. Similarity alone is the wrong
 * primitive here — "which facts are true right now" is a constraint, not a
 * preference, and a purely semantic search will happily surface an event from
 * 1622 into a scene set in 1607.
 *
 * The scorer is deliberately simple and deterministic so retrieval is testable.
 * Swapping in embeddings later means replacing `score` and nothing else.
 */

export interface RetrievalQuery {
  date: string;
  placeId: string;
  region?: string;
  /** Scene tags, e.g. ["trade", "diplomacy"]. */
  tags: string[];
  /** Free text from the player's last choice, used for lexical matching. */
  text?: string;
}

export interface RetrievedContext {
  events: TimelineEvent[];
  people: Person[];
  places: Place[];
  material: MaterialItem[];
  affordances: Affordance[];
  /** Only the sources actually cited by the above, so the prompt stays tight. */
  sourceIds: string[];
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with",
  "is", "are", "was", "were", "be", "it", "that", "this", "you", "your", "i",
  "he", "she", "they", "them", "his", "her", "their", "from", "by", "as", "but",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Lexical overlap score between a query and an entry's searchable text. */
function score(queryTokens: string[], haystack: string, tags: string[], queryTags: string[]): number {
  if (queryTokens.length === 0 && queryTags.length === 0) return 0;
  const hay = new Set(tokens(haystack));
  let s = 0;
  for (const q of queryTokens) if (hay.has(q)) s += 1;
  // Tag matches are worth more than incidental word overlap: they are the
  // author's explicit statement of what an entry is about.
  for (const t of queryTags) if (tags.includes(t)) s += 3;
  return s;
}

function inWindow(date: string, from: string, until?: string): boolean {
  const k = dateKey(date);
  return k >= dateKey(from) && (!until || k <= dateKey(until));
}

/**
 * How many days on either side of the current date count as "current".
 * Wide enough that a scene knows what is coming, narrow enough that it does
 * not know about things fifteen years out.
 */
const RECENT_DAYS = 120;
const HORIZON_DAYS = 400;

export interface RetrievalLimits {
  events: number;
  people: number;
  places: number;
  material: number;
}

const DEFAULT_LIMITS: RetrievalLimits = {
  events: 8,
  people: 6,
  places: 4,
  material: 8,
};

export function retrieve(
  pack: EraPack,
  query: RetrievalQuery,
  limits: Partial<RetrievalLimits> = {},
): RetrievedContext {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const qTokens = tokens(query.text ?? "");
  const k = dateKey(query.date);

  // --- Events: everything already past, plus what is imminent ---------------
  const eventWindow = pack.timeline.filter((e) => {
    const ek = dateKey(e.date);
    const endK = e.end_date ? dateKey(e.end_date) : ek;
    // In progress right now.
    if (ek <= k && endK >= k) return true;
    // Recently past — the characters would still be talking about it.
    if (endK < k && k - endK < RECENT_DAYS * 1.1) return true;
    // Coming up — the scene should be able to lean toward it.
    if (ek > k && ek - k < HORIZON_DAYS * 1.1) return true;
    return false;
  });

  const events = eventWindow
    .map((e) => {
      let s = score(qTokens, `${e.title} ${e.summary}`, e.tags, query.tags);
      // Weight by how much the era hinges on it, and by proximity in time.
      s += { pivotal: 4, major: 2, minor: 1, texture: 0 }[e.significance];
      if (e.region === (query.region ?? "")) s += 1;
      if (e.places.includes(query.placeId)) s += 2;
      if (e.fixed && dateKey(e.date) >= k) s += 2; // heading toward it
      return { e, s };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, lim.events)
    .map((x) => x.e)
    .sort((a, b) => dateKey(a.date) - dateKey(b.date));

  // --- People: alive, and where the story is ---------------------------------
  const people = pack.people
    .filter((p) => {
      if (p.died && k > dateKey(p.died)) return false;
      if (p.born && k < dateKey(p.born)) return false;
      return true;
    })
    .map((p) => {
      let s = score(qTokens, `${p.name} ${p.role} ${p.character}`, p.tags, query.tags);
      const here = p.presence.some(
        (w) => w.place_id === query.placeId && inWindow(query.date, w.from, w.until),
      );
      if (here) s += 6;
      // Anyone named in a retrieved event is relevant to this scene.
      if (events.some((e) => e.people.includes(p.id))) s += 4;
      return { p, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, lim.people)
    .map((x) => x.p);

  // --- Places: here, plus anywhere reachable or referenced -------------------
  const here = pack.places.find((p) => p.id === query.placeId);
  const reachable = new Set(here?.routes.map((r) => r.to) ?? []);
  const places = pack.places
    .filter((p) => {
      if (p.exists_from && k < dateKey(p.exists_from)) return false;
      if (p.exists_until && k > dateKey(p.exists_until)) return false;
      return true;
    })
    .map((p) => {
      let s = score(qTokens, `${p.name} ${p.description}`, p.tags, query.tags);
      if (p.id === query.placeId) s += 20;
      if (reachable.has(p.id)) s += 3;
      if (events.some((e) => e.places.includes(p.id))) s += 2;
      return { p, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, lim.places)
    .map((x) => x.p);

  // --- Material culture -------------------------------------------------------
  const material = pack.material.items
    .map((m) => ({
      m,
      s: score(qTokens, `${m.name} ${m.description}`, m.tags, query.tags) + 1,
    }))
    .sort((a, b) => b.s - a.s)
    .slice(0, lim.material)
    .map((x) => x.m);

  const sourceIds = [
    ...new Set([
      ...events.flatMap((e) => e.source_ids),
      ...people.flatMap((p) => p.source_ids),
      ...places.flatMap((p) => p.source_ids),
      ...material.flatMap((m) => m.source_ids),
    ]),
  ].sort();

  return { events, people, places, material, affordances: [], sourceIds };
}

/** Build a retrieval query from current game state. */
export function queryFromState(
  state: GameState,
  pack: EraPack,
  lastChoiceText?: string,
): RetrievalQuery {
  const place = pack.places.find((p) => p.id === state.place_id);
  return {
    date: state.date,
    placeId: state.place_id,
    region: place?.region,
    tags: pack.hooks.hooks.find((h) => h.id === state.hook_id)?.tags ?? [],
    text: lastChoiceText,
  };
}
