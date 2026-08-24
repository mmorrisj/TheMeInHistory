# The Me In History — Design & Build Recommendation

## 1. What this product actually is

Two things are being built at once, and conflating them is the main risk:

1. **A branching narrative engine** driven by an LLM.
2. **A history-teaching instrument** that has to be *right*.

The engine is a solved-ish problem. The teaching instrument is where the product
lives or dies, because a generative model asked to "write a story set in 1487
Lisbon" will confidently invent streets, prices, titles, ships, and people. If
the reader can't trust the history, the learning value is zero and the product
is just fan fiction with a costume.

**The central architectural commitment:** history is *content*, versioned in the
repository and human-reviewable — not something the model recalls at generation
time. The model narrates; a curated corpus constrains what it may narrate about.

---

## 2. The three layers

```
┌─────────────────────────────────────────────────────────────┐
│  STORY LAYER    scene prose, choices, pacing, voice         │
│                 (generated per turn, ephemeral)             │
├─────────────────────────────────────────────────────────────┤
│  STATE LAYER    character sheet, world flags, relationships,│
│                 timeline position, inventory, reputation    │
│                 (structured, deterministic, in Postgres)    │
├─────────────────────────────────────────────────────────────┤
│  HISTORY LAYER  Era Packs: dated events, people, places,    │
│                 material culture, language register,        │
│                 anachronism blocklist                       │
│                 (authored content, git-versioned, retrieved)│
└─────────────────────────────────────────────────────────────┘
```

Rules that follow from this:

- The LLM **never** owns state. It *proposes* a state delta; server code
  validates and applies it. If the model says "you now have the letter," the
  letter exists only after a Zod-validated `state_delta` is applied.
- The LLM **never** sources history from its weights alone. Every scene is
  generated with retrieved Era Pack facts in context, and every historical
  claim it makes is tagged with a reference id or flagged as invented.
- Prose is disposable; state and the fact ledger are durable.

---

## 3. Era Packs — the core asset

An Era Pack is a versioned bundle describing one setting (place + time window +
social stratum). It is the moat. Everything else is plumbing.

```
content/eras/1943-eastern-front/
  pack.yaml            # metadata, date window, geography, content posture
  timeline.yaml        # dated events, with certainty levels
  people.yaml          # real figures: lifespan, location windows, role, notes
  places.yaml          # settlements, buildings, routes, travel times
  material.yaml        # clothing, food, tools, weapons, prices, wages
  language.yaml        # register guide, do/don't word list, forms of address
  daily-life.yaml      # a day in the life by social role
  blocklist.yaml       # anachronisms specific to this era
  sources.yaml         # citations backing every claim above
  hooks.yaml           # story seeds: tensions, dilemmas, natural plot engines
```

Properties that matter:

- **Diffable.** YAML/MDX in git means a historian collaborator can review a pull
  request. A vector database blob cannot be peer-reviewed.
- **Certainty-tagged.** Every fact carries `certainty: established | contested |
  reconstructed | speculative`. The narrative treats contested facts differently
  and the debrief can say "historians disagree about this."
- **Sourced.** `source_ids` on each entry, resolving to `sources.yaml`. This is
  what lets you show a reader *why* something is true.
- **LLM-drafted, human-approved.** Use a strong model to draft a pack, then a
  review pass. Drafting is cheap; the review gate is non-negotiable and should
  be enforced by a `status: draft | reviewed` field that the runtime respects.

Indexing: load packs into Postgres with `pgvector` at build/deploy time, keyed
by era + entity type + tags. Retrieval at turn time is a hybrid filter (era,
date window, geography, scene tags) + vector similarity — never pure similarity,
because "which facts are legal right now" is a hard constraint, not a soft one.

---

## 4. The character → era bridge

This is the feature the product is named after, and it needs real machinery.

A user enters free-form traits, skills, hobbies, interests. Normalize those into
a **tag ontology** (`skill.metalworking`, `trait.impulsive`,
`interest.astronomy`). Then each Era Pack supplies an **affordance mapping**:

```yaml
# content/eras/<era>/affordances.yaml
skill.chemistry:
  era_name: "natural philosophy / alchemy"
  plausibility:
    noble: common
    merchant: uncommon
    peasant: implausible
  enables: [poison_identification, dye_production, apothecary_access]
  social_reading: "viewed with suspicion by the parish; useful to the guild"
```

Three things fall out of this for free:

- **Plausibility gate.** A 12th-century serf who is a "software engineer" gets
  translated ("you have a mind that sees patterns in systems — the reeve's
  tally sticks make sense to you in a way they don't to others") rather than
  rejected or naively imported. That translation *is* the teaching moment.
- **Mechanical consequence.** Affordances become state flags that unlock choices,
  so skills matter to outcomes instead of being flavor text.
- **The friction is educational.** "Your literacy is unusual for a woman of your
  station in 1580 Antwerp — here's why" teaches more social history than a
  paragraph of exposition.

Also capture **social position** explicitly at character creation (class, gender,
faith, region, legal status). In most eras this constrains the story far more
than personality does, and being honest about that is the point.

---

## 5. The turn loop

```
player choice
   ↓
load GameState (structured, from DB)
   ↓
retrieve Era Pack slice  ← date window + location + scene tags + vector
   ↓
NARRATOR call → structured output:
   { prose, choices[2..4], state_delta, history_refs[], new_terms[], invented[] }
   ↓
validate (Zod) → retry on schema failure → apply state_delta deterministically
   ↓
persist turn + append history_refs to the session's Fact Ledger
   ↓
stream prose to client
   ↓
[async, non-blocking] AUDITOR call → flag claims not grounded in the pack
```

Notes:

- **Structured output, always.** Prose as one field among several. Never parse
  choices out of free text.
- **The auditor is asynchronous.** Don't make the reader wait on a fact check.
  Findings land in the ledger and the chapter debrief; a severe finding can
  quietly rewrite a footnote rather than block the turn.
- **`invented[]` is required.** The narrator must declare what it made up
  (a fictional innkeeper, an unrecorded conversation). Anything historical not
  in `history_refs` and not declared in `invented` is a bug — the auditor
  catches it. This single field is what makes the Fact & Fiction ledger honest.
- **Model tiering.** Narration on a mid-tier model for latency and cost;
  auditing and tagging on a cheap fast model; Era Pack drafting and chapter
  synthesis on the strongest model. Cache the era context aggressively — it's
  large, stable, and re-sent every turn.

### Drift control

LLM CYOA degrades over long sessions. Counter it with:

- A **scene budget** — chapters of 8–15 turns, each ending in a synthesis step
  that compresses the chapter into durable state + a short "story so far."
- The prompt reconstructed from *state*, not from the raw turn transcript.
- A **canon check** before each turn: does state contradict the timeline? (Is
  the player in a city that has already fallen? Talking to someone dead?)
  This is cheap deterministic code and catches most immersion-breaking errors.

---

## 6. The learning layer

Investment in characters is the hook; these are the mechanisms that convert it
into retention:

- **Inline footnote markers.** Real people, places, events, and terms are marked
  in the prose (the narrator emits them in `history_refs` with character offsets)
  and open a sourced card in a sidebar. Zero-friction depth.
- **Fact & Fiction ledger.** At each chapter end, an auto-built list: *this
  happened, this is reconstructed, this is invented, this is contested*. This is
  the single most valuable screen in the app and it is nearly free given the
  turn-loop design above.
- **"Meanwhile" / zoom-out.** A button that shows what was happening elsewhere
  in the world at the current story date. Cheap to build from the timeline;
  excellent for building chronological intuition.
- **Counterfactual boundary.** When a player's choice would alter a documented
  outcome, the engine doesn't silently allow it. It bends: the player witnesses
  or is swept up in the real outcome, and the debrief says why it couldn't go
  otherwise. Constraint taught as narrative, not as an error message.
- **Recall prompts (optional).** Light spaced questions between sessions.

---

## 7. Content posture

Any serious historical setting reaches atrocity, slavery, war, and persecution.
Decide the posture in a document before writing the prompt, not after a bad
generation:

- Per-era `content_posture` in `pack.yaml`: what the era unavoidably contains,
  what the narrator depicts vs. reports, what it will not render.
- Age modes (family / general / mature) that change depiction depth, never
  historical honesty. Sanitizing that slavery existed is worse than declining to
  depict a scene.
- Documented atrocities are not player-editable and not gamified.
- Real named people get constrained treatment: they may appear and speak within
  documented character, but the pack marks the line between attested statements
  and plausible invention, and the ledger reflects it.

---

## 8. Recommended stack

**Next.js (App Router) + TypeScript, one app.** Streaming narration is native,
one language across UI and engine, and the whole thing deploys as a unit. Prefer
this over a split Python API unless there's an existing Python investment.

| Concern | Choice | Why |
|---|---|---|
| App | Next.js 15+, TypeScript | streaming, server actions, one deploy |
| DB | Postgres (Neon/Supabase) + `pgvector` | relational state *and* retrieval, one system |
| ORM | Drizzle | typed, SQL-honest, good migrations |
| Model API | Anthropic API | tiered models, prompt caching, strong structured output |
| Schemas | Zod | one definition for LLM output validation and TS types |
| Content | YAML + MDX in-repo, Zod-validated at build | reviewable, diffable history |
| Auth | Clerk or Supabase Auth | not the interesting problem |
| Eval | Vitest + a golden-transcript harness | see §10 |

Cost control: prompt-cache the Era Pack context (large, stable, per-turn),
tier models by task, and cap chapter length. A turn should be a few cents.

---

## 9. Repository structure

```
/app                      Next.js routes (play, character builder, ledger, library)
/src
  /engine
    turn.ts               the turn loop
    state.ts              GameState schema + deterministic reducers
    canon.ts              contradiction checks against the timeline
    retrieval.ts          hybrid Era Pack retrieval
    schemas.ts            Zod: narrator output, state delta, character
  /prompts
    narrator.ts           scene generation
    auditor.ts            grounding check
    synthesist.ts         chapter compression + ledger build
    packwright.ts         Era Pack drafting
  /character
    ontology.ts           trait/skill/interest tag vocabulary
    affordance.ts         character × era → capability resolution
  /db                     drizzle schema + migrations
  /ui
/content
  /eras/<era-id>/         the Era Packs (see §3)
  /ontology/              shared tag vocabulary
/tools
  pack-lint.ts            schema + internal consistency + source coverage
  pack-draft.ts           LLM-assisted pack authoring CLI
  eval/                   golden transcripts, anachronism suite
/docs
  DESIGN.md               this document
  CONTENT_POSTURE.md      §7, expanded
  ERA_AUTHORING.md        how to write and review a pack
```

---

## 10. Evaluation — build this early

Without it you cannot tell whether a prompt change made the history better or
worse. Three suites, all runnable in CI:

1. **Anachronism suite.** Per era, a list of things that must never appear
   (potatoes in pre-Columbian Europe, "okay" before the 1840s, minute-precise
   clock time in the 13th century). Generate N scenes, grep, fail the build.
2. **Grounding rate.** Fraction of historical claims carrying a valid
   `history_refs` id or an honest `invented` declaration. Track it as a number
   over time; it is the product's core quality metric.
3. **Golden transcripts.** Fixed seeds + fixed choice sequences, snapshotted.
   Diffs get human review. Catches drift when prompts or models change.

Add a fourth once there are readers: does the ledger match what actually
appeared in the prose? Sample and check by hand.

---

## 11. Build order

**Phase 0 — vertical slice (weeks 1–3).** *One* era, hand-authored pack, one
pre-made character, no auth, no persistence beyond a session. Prove the turn
loop produces prose that is both engaging and grounded. If it doesn't, nothing
downstream matters. Ship this before writing a character builder.

**Phase 1 — state and character (weeks 3–6).** Postgres, real GameState,
reducers, canon checks, character builder with the tag ontology and the
affordance mapping. Save/resume. Chapter synthesis.

**Phase 2 — the history machine (weeks 6–10).** Pack schema + linter, retrieval,
auditor, Fact & Fiction ledger, inline footnotes. The eval suites. This is where
it becomes an educational product rather than a toy.

**Phase 3 — scale content (weeks 10+).** Pack authoring CLI, 5–10 eras, "meanwhile"
view, sharing/export of a finished story, classroom mode if that's a market.

Deliberately deferred: multiplayer, illustration generation, voice, mobile apps.
All of them are more attractive than they are valuable at this stage.

---

## 12. The three risks worth naming

1. **Hallucinated history that reads plausible.** Mitigated by Era Packs +
   `invented[]` + auditor + anachronism evals. Never fully solved — which is why
   the ledger, which teaches readers to ask "how do we know this?", is a feature
   and not an apology.
2. **Narrative drift over long sessions.** Mitigated by state-not-transcript
   prompting, chapter compression, and canon checks.
3. **Content cost.** A good Era Pack is real work. Resist launching with twenty
   shallow eras; three deep ones will demo far better and teach far more.
