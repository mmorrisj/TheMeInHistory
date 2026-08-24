# Authoring an Era Pack

An Era Pack is the only thing the narrator is allowed to assert about the past.
Everything else in this repository is plumbing. Write packs accordingly.

## The rule that matters

**Never let a model's recall become a pack entry without checking it.** Drafting
with an LLM is fine and fast. Shipping what it drafted is how you get a colony
with log cabins and potatoes. Every entry needs a source you have actually
looked at, and `status: reviewed` is a claim that someone did.

## Files

Each pack is a directory under `content/eras/<pack-id>/` with eleven files.
`npm run pack:lint` validates all of them and fails on any dangling reference.

| File | What it holds |
|---|---|
| `pack.yaml` | Identity, date range, social positions, content posture |
| `timeline.yaml` | Dated events, `fixed` flags, significance |
| `people.yaml` | Real figures with presence windows and portrayal limits |
| `places.yaml` | Locations, sensory detail, travel times, existence windows |
| `material.yaml` | Clothing, food, tools, weapons, prices, wages |
| `language.yaml` | Register, vocabulary, forms of address, what to avoid |
| `daily-life.yaml` | An ordinary day, per social position |
| `affordances.yaml` | Ontology tag → era capability mapping |
| `blocklist.yaml` | Anachronism regexes with severities |
| `sources.yaml` | Every source, with an honest reliability note |
| `hooks.yaml` | Story openings and what each teaches |

## Certainty

Every historical entry carries one of four levels. Choosing correctly is most of
the authoring work.

- **`established`** — attested by multiple independent sources, uncontroversial.
- **`contested`** — historians actively disagree. Requires a `note` explaining
  who disagrees and why. These are the most valuable entries in a pack: they
  teach the reader that history is argued over, not looked up.
- **`reconstructed`** — inferred from archaeology or comparable cases, not
  directly attested. Requires a `note` saying what the inference rests on.
- **`speculative`** — plausible but unevidenced. Furnishes the world; teaches
  nothing. Use sparingly.

The linter warns when a non-`established` entry has no `note`.

## Sources

`reliability` is not a bibliography formality. Write what the source is good for
and where it lies. The Jamestown pack's entry for Smith's 1624 *Generall
Historie* says plainly that it enlarges his own role and should be treated as
contested where it exceeds his 1608 account — and that judgement is what lets
the runtime refuse to assert the Pocahontas rescue as fact.

## Portrayal limits

For every real person, `portrayal_limits` marks the line between what they are
attested to have said or done and what a story may invent for them. This text is
written verbatim into the narrator's prompt. Be specific:

> Attested: her visits to the fort with provisioning parties, her captivity,
> baptism, marriage, and death. What she thought about any of it is nowhere
> recorded, and the narrator should let that silence stand rather than filling
> it with modern interiority.

## Fixed events

`fixed: true` means no player choice averts it. The engine refuses state deltas
that contradict a fixed event, and the narrator is instructed to bend the story
around it — the character witnesses it, is caught in it, or arrives too late.
Mark documented catastrophes fixed. Never mark a fixed event as something the
player can undo, and never let the prose break frame to explain the constraint.

## Content posture

Decide this before writing a single prompt, not after a bad generation.
`pack.yaml` names what the era unavoidably contains, what is depicted on the
page, what is reported but never staged, and what is refused outright. Age modes
change depiction depth; they never change historical honesty. Sanitising the
fact that something happened is worse than declining to render the scene.

## Affordances

Map ontology tags (`content/ontology/tags.yaml`) to what the era makes of them.
The `translation` field is shown to the player at character creation and is the
place the app earns its name. Three tests of a good translation:

1. It does not reject the modern skill.
2. It does not import it unchanged.
3. It teaches something about the period that exposition would not.

A tag with no mapping is not an error. The player is told the era has no
equivalent, which is more honest and more interesting than inventing one.

## Anachronism blocklist

Regexes run against generated prose by `tests/anachronism.test.ts` and by the
runtime. Two directions matter equally: the pattern must fire on the mistake,
and it must **not** fire on period-correct prose. Add a passing example to the
test suite for every new pattern — a blocklist that flags everything is as
useless as one that flags nothing.

Watch for overlapping patterns. `\bAmericans?\b` originally shadowed the
`Native American` warning with an error; the fix was a negative lookbehind.

## Review checklist

Before flipping `status: draft` to `reviewed`:

- [ ] `npm run pack:lint` is clean, warnings included
- [ ] Every `contested` and `reconstructed` entry has a `note`
- [ ] Every real person has `portrayal_limits` that name attested facts
- [ ] Every documented catastrophe is `fixed: true`
- [ ] Every social position has a daily-life routine and a playable hook
- [ ] Blocklist patterns have both a failing and a passing test case
- [ ] Someone who knows the period has read the timeline end to end
