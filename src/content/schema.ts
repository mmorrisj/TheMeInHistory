import { z } from "zod";

/**
 * Era Pack schemas.
 *
 * These are the contract between authored history and the runtime. Everything
 * the narrator is allowed to assert about the past comes through here, so the
 * schemas are deliberately strict: no loose passthrough, and every historical
 * claim must carry both a certainty level and at least one source id.
 */

/** How confident the historical record is about a claim. */
export const Certainty = z.enum([
  /** Attested by multiple independent sources; uncontroversial. */
  "established",
  /** Sources disagree, or historians actively dispute it. */
  "contested",
  /** Inferred from archaeology, comparable cases, or indirect evidence. */
  "reconstructed",
  /** Plausible but unevidenced; included to furnish the world, not to teach. */
  "speculative",
]);
export type Certainty = z.infer<typeof Certainty>;

/** Slug used to cross-reference entities between pack files. */
const Id = z
  .string()
  .regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/, "ids are lowercase dot/dash slugs");

/** ISO date, or a partial date when the record is only that precise. */
const HistoricalDate = z
  .string()
  .regex(
    /^\d{4}(-\d{2}(-\d{2})?)?$/,
    "dates are YYYY, YYYY-MM, or YYYY-MM-DD",
  );

const SourceRefs = z
  .array(Id)
  .min(1, "every historical claim needs at least one source id");

/** Fields shared by every sourced, certainty-tagged pack entry. */
const Sourced = {
  certainty: Certainty,
  source_ids: SourceRefs,
  /** Free-text caveat surfaced in the ledger when certainty is not `established`. */
  note: z.string().optional(),
};

/** Tags drive retrieval. Scenes request tags; entries are matched on them. */
const Tags = z.array(z.string()).default([]);

// ---------------------------------------------------------------------------
// pack.yaml
// ---------------------------------------------------------------------------

export const ContentPosture = z.object({
  /** What this era unavoidably contains. Stated plainly so nothing is a surprise. */
  unavoidable: z.array(z.string()).min(1),
  /** Depicted on the page. */
  depicts: z.array(z.string()).default([]),
  /** Reported as having happened, but not rendered as a scene. */
  reports: z.array(z.string()).default([]),
  /** Never rendered, at any age setting. */
  refuses: z.array(z.string()).default([]),
  /** Outcomes the player may witness or suffer but never avert or alter. */
  fixed_outcomes: z.array(z.string()).default([]),
});

export const PackMeta = z.object({
  id: Id,
  title: z.string(),
  blurb: z.string(),
  /** `draft` packs are refused by the runtime; only `reviewed` packs can be played. */
  status: z.enum(["draft", "reviewed"]),
  reviewed_by: z.string().optional(),
  date_range: z.object({ start: HistoricalDate, end: HistoricalDate }),
  /** Where the story can go. Retrieval filters on these. */
  regions: z.array(z.string()).min(1),
  /** Social strata a player character may occupy in this setting. */
  social_positions: z.array(
    z.object({
      id: Id,
      label: z.string(),
      description: z.string(),
      /** Constraints the era imposes on someone in this position. */
      constraints: z.array(z.string()).default([]),
    }),
  ).min(1),
  content_posture: ContentPosture,
});
export type PackMeta = z.infer<typeof PackMeta>;

// ---------------------------------------------------------------------------
// timeline.yaml
// ---------------------------------------------------------------------------

export const TimelineEvent = z.object({
  id: Id,
  date: HistoricalDate,
  /** Set when the event spans time; `date` is then the start. */
  end_date: HistoricalDate.optional(),
  title: z.string(),
  summary: z.string(),
  region: z.string(),
  /** Ids from people.yaml who took part. Validated by the linter. */
  people: z.array(Id).default([]),
  /** Ids from places.yaml where it happened. Validated by the linter. */
  places: z.array(Id).default([]),
  /**
   * Documented outcomes the player cannot change. The engine refuses state
   * deltas that contradict these, and the narrator is told to bend the story
   * around them rather than let a choice avert them.
   */
  fixed: z.boolean().default(false),
  significance: z.enum(["pivotal", "major", "minor", "texture"]),
  tags: Tags,
  ...Sourced,
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const Timeline = z.object({ events: z.array(TimelineEvent).min(1) });

// ---------------------------------------------------------------------------
// people.yaml
// ---------------------------------------------------------------------------

export const Person = z.object({
  id: Id,
  name: z.string(),
  /** What people in the era actually called them, if different. */
  also_known_as: z.array(z.string()).default([]),
  role: z.string(),
  affiliation: z.string(),
  born: HistoricalDate.optional(),
  died: HistoricalDate.optional(),
  /** Where they can plausibly be encountered, and when. Canon checks use this. */
  presence: z.array(
    z.object({
      place_id: Id,
      from: HistoricalDate,
      until: HistoricalDate.optional(),
    }),
  ).default([]),
  /** Documented temperament and manner, to keep portrayal inside the record. */
  character: z.string(),
  /**
   * The line between what this person is attested to have said or done and what
   * a story may plausibly invent for them. Written into the narrator prompt.
   */
  portrayal_limits: z.string(),
  tags: Tags,
  ...Sourced,
});
export type Person = z.infer<typeof Person>;

export const People = z.object({ people: z.array(Person).min(1) });

// ---------------------------------------------------------------------------
// places.yaml
// ---------------------------------------------------------------------------

export const Place = z.object({
  id: Id,
  name: z.string(),
  also_known_as: z.array(z.string()).default([]),
  region: z.string(),
  kind: z.enum([
    "settlement",
    "fortification",
    "building",
    "waterway",
    "landmark",
    "territory",
  ]),
  description: z.string(),
  /** Sensory detail the narrator can draw on without inventing. */
  sensory: z.array(z.string()).default([]),
  /** Travel times to other places, in hours, by the means available. */
  routes: z.array(
    z.object({ to: Id, hours: z.number().positive(), means: z.string() }),
  ).default([]),
  /** When the place existed in the form described. */
  exists_from: HistoricalDate.optional(),
  exists_until: HistoricalDate.optional(),
  tags: Tags,
  ...Sourced,
});
export type Place = z.infer<typeof Place>;

export const Places = z.object({ places: z.array(Place).min(1) });

// ---------------------------------------------------------------------------
// material.yaml
// ---------------------------------------------------------------------------

export const MaterialItem = z.object({
  id: Id,
  name: z.string(),
  category: z.enum([
    "clothing",
    "food",
    "tool",
    "weapon",
    "trade-good",
    "building",
    "medicine",
    "currency",
  ]),
  description: z.string(),
  /** Who would actually have this. Keeps gentlemen's goods off a labourer. */
  available_to: z.array(Id).default([]),
  /** Period price, verbatim in period units, when the record gives one. */
  price: z.string().optional(),
  tags: Tags,
  ...Sourced,
});

export const Material = z.object({
  items: z.array(MaterialItem).min(1),
  /** Wages and prices in period units, for grounding any mention of money. */
  economy: z.array(
    z.object({
      id: Id,
      label: z.string(),
      value: z.string(),
      ...Sourced,
    }),
  ).default([]),
});
export type MaterialItem = z.infer<typeof MaterialItem>;

// ---------------------------------------------------------------------------
// language.yaml
// ---------------------------------------------------------------------------

export const Language = z.object({
  /** How the period's English sounds, in instructions the narrator can follow. */
  register: z.string(),
  /** Period words worth using, with meaning, so prose can carry texture. */
  vocabulary: z.array(
    z.object({
      term: z.string(),
      meaning: z.string(),
      usage: z.string().optional(),
      ...Sourced,
    }),
  ).default([]),
  /** How people addressed each other across ranks. */
  forms_of_address: z.array(
    z.object({ speaker: z.string(), addressee: z.string(), form: z.string() }),
  ).default([]),
  /** Modern phrasings to avoid, with the period alternative. */
  avoid: z.array(
    z.object({ modern: z.string(), instead: z.string(), why: z.string() }),
  ).default([]),
  /**
   * Terms the period used for groups that modern usage names differently.
   * Carries explicit guidance so the narrator neither sanitizes the past nor
   * adopts period slurs as its own voice.
   */
  contested_terms: z.array(
    z.object({
      period_term: z.string(),
      modern_term: z.string(),
      guidance: z.string(),
    }),
  ).default([]),
});
export type Language = z.infer<typeof Language>;

// ---------------------------------------------------------------------------
// daily-life.yaml
// ---------------------------------------------------------------------------

export const DailyLife = z.object({
  routines: z.array(
    z.object({
      id: Id,
      /** Which social position from pack.yaml this describes. */
      social_position: Id,
      season: z.string().optional(),
      /** Ordered beats of an ordinary day. */
      day: z.array(z.object({ when: z.string(), what: z.string() })).min(1),
      concerns: z.array(z.string()).default([]),
      ...Sourced,
    }),
  ).min(1),
});

// ---------------------------------------------------------------------------
// affordances.yaml
// ---------------------------------------------------------------------------

export const Affordance = z.object({
  /** Tag from the shared ontology, e.g. `skill.chemistry`. */
  tag: z.string(),
  /** What the era calls this capability, if it has a name at all. */
  era_name: z.string(),
  /**
   * How likely someone of each social position is to have it. Drives the
   * translation shown at character creation.
   */
  plausibility: z.record(
    Id,
    z.enum(["common", "uncommon", "rare", "implausible"]),
  ),
  /** State flags this unlocks, which choices can gate on. */
  enables: z.array(Id).default([]),
  /** How the era reads a person who has this. Often the teaching moment. */
  social_reading: z.string(),
  /** Shown to the player when their modern trait is translated into the era. */
  translation: z.string(),
  ...Sourced,
});
export type Affordance = z.infer<typeof Affordance>;

export const Affordances = z.object({
  affordances: z.array(Affordance).min(1),
});

// ---------------------------------------------------------------------------
// blocklist.yaml
// ---------------------------------------------------------------------------

export const Blocklist = z.object({
  entries: z.array(
    z.object({
      /** Case-insensitive regex matched against generated prose. */
      pattern: z.string(),
      why: z.string(),
      /** `error` fails the eval suite; `warn` is reported but tolerated. */
      severity: z.enum(["error", "warn"]).default("error"),
      /** The period-correct thing to say instead. */
      instead: z.string().optional(),
    }),
  ).min(1),
});
export type Blocklist = z.infer<typeof Blocklist>;

// ---------------------------------------------------------------------------
// sources.yaml
// ---------------------------------------------------------------------------

export const Source = z.object({
  id: Id,
  kind: z.enum(["primary", "secondary", "archaeological", "scientific"]),
  title: z.string(),
  author: z.string().optional(),
  year: z.string().optional(),
  /** Why this source is trustworthy, and where it is known to be biased. */
  reliability: z.string(),
  url: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

export const Sources = z.object({ sources: z.array(Source).min(1) });

// ---------------------------------------------------------------------------
// hooks.yaml
// ---------------------------------------------------------------------------

export const Hooks = z.object({
  hooks: z.array(
    z.object({
      id: Id,
      title: z.string(),
      /** The tension the story can run on. */
      premise: z.string(),
      /** Story opens at this date and place. */
      opens: z.object({ date: HistoricalDate, place_id: Id }),
      /** Social positions this opening works for. */
      social_positions: z.array(Id).min(1),
      /** Timeline events this hook is heading toward. */
      leads_to: z.array(Id).default([]),
      /** What the player is meant to come away understanding. */
      teaches: z.array(z.string()).min(1),
      tags: Tags,
    }),
  ).min(1),
});
export type Hooks = z.infer<typeof Hooks>;

// ---------------------------------------------------------------------------
// Assembled pack
// ---------------------------------------------------------------------------

export const EraPack = z.object({
  meta: PackMeta,
  timeline: z.array(TimelineEvent),
  people: z.array(Person),
  places: z.array(Place),
  material: Material,
  language: Language,
  dailyLife: DailyLife,
  affordances: z.array(Affordance),
  blocklist: Blocklist,
  sources: z.array(Source),
  hooks: Hooks,
});
export type EraPack = z.infer<typeof EraPack>;
