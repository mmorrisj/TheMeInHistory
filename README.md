# The Me In History

A choose-your-own-adventure engine for historical fiction. You build a character
— traits, skills, hobbies, interests — or bring yourself, and get planted into a
real historical setting. A narrator weaves you into the period, and you learn
history by being invested in what happens to you inside it.

**The design premise: history is content, not model memory.** A generative model
asked to write a scene in 1607 Virginia will confidently invent streets, prices,
titles and people. So the history lives in the repository as curated, sourced,
certainty-tagged YAML — reviewable in a pull request — and the narrator may
assert nothing that the pack does not contain.

## Running it

```bash
npm install
cp .env.example .env.local     # add your ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

```bash
npm run check                  # typecheck + pack lint + tests
npm run pack:lint              # validate Era Packs on their own
```

Play sessions persist to `.sessions/` as JSON. No database is needed to run the
vertical slice.

## What's here

**The Jamestown Era Pack** (`content/eras/virginia-colony-1607/`) — Virginia
1607–1624. 42 dated events, 26 real people with presence windows and portrayal
limits, 20 places with travel times, 20 character-to-era affordance mappings,
and 24 sources from Smith's 1608 *True Relation* through the 2013 forensic
analysis of the Starving Time remains. Six story openings, from the sickening
season of 1607 to the summer of 1619.

**The engine** (`src/engine/`) — deterministic state and reducers, canon checks
against the timeline, hybrid retrieval, and the turn loop.

**The LLM layer** (`src/llm/`) — narrator, grounding auditor, and chapter
synthesist, all with structured outputs.

## How a turn works

```
player choice
   ↓  load GameState (structured, never owned by the model)
   ↓  retrieve Era Pack slice   ← date + place + tags, hard-filtered
   ↓  NARRATOR → { prose, choices, state_delta, history_refs, invented }
   ↓  canon check → retry with the violations fed back
   ↓  apply delta deterministically, persist, append to the ledger
   ↓  stream prose to the reader
   ↓  [async] AUDITOR flags ungrounded claims — never blocks the turn
```

Three things make this different from a model writing historical fiction on its
own:

**The model does not own state.** It proposes a `state_delta`; `applyDelta` is
ordinary code. If the narrator says you have the letter, you have it only after
a validated delta lands.

**`invented[]` is required output.** The narrator must declare what it made up —
a fictional innkeeper, an unrecorded conversation. Anything historical that
appears in neither `history_refs` nor `invented` is a grounding failure, and the
auditor exists to find exactly that gap. This one field is what makes the Fact &
Fiction ledger honest.

**Canon checks are cheap and deterministic.** Talking to someone who died last
August, standing in a town burned two years ago, or crossing thirty hours of
river in an afternoon are all caught by code, with the violation fed back to the
narrator for a retry.

## The character-to-era bridge

Free-text traits normalise into a shared ontology, and each pack maps those tags
to what the era makes of them. Modern skills are neither rejected nor imported
unchanged — they are translated, and the translation is the teaching moment:

> **Chemistry → "alchemy, or the assayer's art"** *(uncommon for a gentleman)*
> Your chemistry becomes the assayer's art. You are the person who can tell the
> Council that the glittering ore they have loaded aboard Newport's ship is not
> gold. Being right about this will not make you popular; the entire venture is
> staked on it being gold.

A capability the era has no equivalent for is reported as such rather than given
a false one. A capability implausible for your station grants no mechanical
flags — but the story still discusses it, because that friction is the point.

Social position is asked first and framed as the most consequential choice,
because in this period it decides far more than personality does. It also gates
the openings honestly: a woman cannot play Jamestown's first summer, because
there were no Englishwomen in the colony until October 1608.

## Evaluation

```
tests/pack.test.ts          pack integrity, sourcing, certainty discipline
tests/anachronism.test.ts   the blocklist fires on errors AND leaves good prose alone
tests/engine.test.ts        reducers, canon, retrieval, affordance resolution
tests/turn.test.ts          orchestration against a stubbed client
tests/errors.test.ts        failure reporting
```

86 tests, no network. The anachronism suite runs both directions on purpose: a
blocklist that flags everything is as useless as one that flags nothing.

## Documentation

- [`docs/DESIGN.md`](docs/DESIGN.md) — architecture and build plan
- [`docs/ERA_AUTHORING.md`](docs/ERA_AUTHORING.md) — how to write and review a pack
- [`docs/CONTENT_POSTURE.md`](docs/CONTENT_POSTURE.md) — how this project handles atrocity

## Status

Phases 0–2 of the plan in `docs/DESIGN.md`: the turn loop, state, the character
bridge, the pack machinery, retrieval, the auditor, the ledger, and the eval
suites. Deferred: the Postgres/Drizzle adapter behind `SessionStore` (the file
store keeps the slice runnable with no infrastructure), inline footnote markers,
the "meanwhile elsewhere" view, and age modes.
