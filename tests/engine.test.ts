import { describe, expect, it } from "vitest";
import { loadPack } from "@/content/loader";
import {
  applyDelta,
  chapterComplete,
  CHAPTER_LENGTH,
  type GameState,
  type StateDelta,
} from "@/engine/state";
import { checkCanon, daysBetween, dateKey, nextFixedEvent, routeHours } from "@/engine/canon";
import { retrieve } from "@/engine/retrieval";
import { resolveAffordances } from "@/character/affordance";
import { normaliseAll, resolveTag } from "@/character/ontology";
import { MemorySessionStore } from "@/engine/store";
import type { Character } from "@/character/schema";

const pack = loadPack("virginia-colony-1607");

const character: Character = {
  name: "Alice Fenn",
  age: 24,
  background: "A Lincolnshire apothecary's daughter.",
  social_position: "woman-settler",
  skills: ["skill.medicine", "skill.cooking", "skill.programming"],
  traits: ["trait.stubborn", "trait.curious"],
  interests: ["interest.gardening"],
  pronouns: "she/her",
};

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    session_id: "test",
    pack_id: "virginia-colony-1607",
    hook_id: "first-summer",
    character,
    date: "1607-07-15",
    place_id: "james-fort",
    flags: [],
    inventory: [],
    relationships: [],
    health: 80,
    standing: 50,
    chapter: 1,
    turns: [],
    story_so_far: "",
    ledger: [],
    witnessed: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const emptyDelta: StateDelta = {
  add_flags: [],
  remove_flags: [],
  add_inventory: [],
  remove_inventory: [],
  health_change: 0,
  standing_change: 0,
  relationships: [],
  witnessed: [],
};

describe("date helpers", () => {
  it("orders partial and full dates consistently", () => {
    expect(dateKey("1607") < dateKey("1607-05")).toBe(true);
    expect(dateKey("1607-05-13") < dateKey("1607-05-14")).toBe(true);
    expect(dateKey("1609-11") < dateKey("1610-05")).toBe(true);
  });

  it("measures elapsed days across months", () => {
    expect(daysBetween("1607-07-15", "1607-07-20")).toBe(5);
    expect(daysBetween("1607-07-15", "1607-08-15")).toBe(30);
  });
});

describe("state reducers", () => {
  it("applies flags and inventory as sets", () => {
    const next = applyDelta(baseState({ flags: ["a"] }), {
      ...emptyDelta,
      add_flags: ["b", "a"],
      add_inventory: ["a letter"],
    });
    expect(next.flags).toEqual(["a", "b"]);
    expect(next.inventory).toEqual(["a letter"]);
  });

  it("removes flags and inventory", () => {
    const next = applyDelta(baseState({ flags: ["a", "b"], inventory: ["knife"] }), {
      ...emptyDelta,
      remove_flags: ["a"],
      remove_inventory: ["knife"],
    });
    expect(next.flags).toEqual(["b"]);
    expect(next.inventory).toEqual([]);
  });

  it("clamps health and standing to 0-100", () => {
    expect(applyDelta(baseState({ health: 10 }), { ...emptyDelta, health_change: -50 }).health).toBe(0);
    expect(applyDelta(baseState({ health: 90 }), { ...emptyDelta, health_change: 50 }).health).toBe(100);
  });

  it("creates and then adjusts a relationship", () => {
    const first = applyDelta(baseState(), {
      ...emptyDelta,
      relationships: [{ person_id: "john-smith", regard_change: 20, standing: "wary" }],
    });
    expect(first.relationships).toEqual([
      { person_id: "john-smith", regard: 20, standing: "wary" },
    ]);
    const second = applyDelta(first, {
      ...emptyDelta,
      relationships: [{ person_id: "john-smith", regard_change: -50 }],
    });
    expect(second.relationships[0]).toEqual({
      person_id: "john-smith",
      regard: -30,
      standing: "wary",
    });
  });

  it("does not mutate the input state", () => {
    const state = baseState();
    applyDelta(state, { ...emptyDelta, add_flags: ["x"], health_change: -10 });
    expect(state.flags).toEqual([]);
    expect(state.health).toBe(80);
  });

  it("closes a chapter once the turn budget is spent", () => {
    const turns = Array.from({ length: CHAPTER_LENGTH }, (_, i) => ({
      index: i,
      chose: null,
      prose: "x",
      choices: [],
      at: "2026-01-01T00:00:00.000Z",
    }));
    expect(chapterComplete(baseState({ turns: turns.slice(0, -1) }))).toBe(false);
    expect(chapterComplete(baseState({ turns }))).toBe(true);
  });
});

describe("canon checks", () => {
  it("refuses a story clock that runs backwards", () => {
    const v = checkCanon(pack, baseState(), { ...emptyDelta, date: "1607-06-01" });
    expect(v.some((x) => x.code === "date-backwards" && x.blocking)).toBe(true);
  });

  it("refuses a date outside the pack's range", () => {
    const v = checkCanon(pack, baseState(), { ...emptyDelta, date: "1630-01-01" });
    expect(v.some((x) => x.code === "date-out-of-range")).toBe(true);
  });

  it("refuses a place that does not exist yet", () => {
    const v = checkCanon(pack, baseState(), {
      ...emptyDelta,
      date: "1607-08-01",
      place_id: "henrico",
    });
    expect(v.some((x) => x.code === "place-not-yet" && x.blocking)).toBe(true);
  });

  it("refuses a place that has been destroyed", () => {
    const v = checkCanon(pack, baseState({ date: "1611-01-01" }), {
      ...emptyDelta,
      date: "1611-06-01",
      place_id: "paspahegh",
    });
    expect(v.some((x) => x.code === "place-gone")).toBe(true);
  });

  it("refuses a conversation with someone already dead", () => {
    const v = checkCanon(pack, baseState({ date: "1608-01-01" }), {
      ...emptyDelta,
      date: "1608-02-01",
      relationships: [{ person_id: "bartholomew-gosnold", regard_change: 5 }],
    });
    expect(v.some((x) => x.code === "person-dead" && x.blocking)).toBe(true);
  });

  it("allows a conversation with someone alive and present", () => {
    const v = checkCanon(pack, baseState(), {
      ...emptyDelta,
      relationships: [{ person_id: "john-smith", regard_change: 5 }],
    });
    expect(v.filter((x) => x.blocking)).toEqual([]);
  });

  it("ignores invented characters entirely", () => {
    const v = checkCanon(pack, baseState(), {
      ...emptyDelta,
      relationships: [{ person_id: "fictional:the-cooper", regard_change: 10 }],
    });
    expect(v.filter((x) => x.blocking)).toEqual([]);
  });

  it("flags travel that outruns the pack's own route times", () => {
    const v = checkCanon(pack, baseState(), {
      ...emptyDelta,
      place_id: "werowocomoco",
      date: "1607-07-15",
    });
    const hit = v.find((x) => x.code === "travel-too-fast");
    expect(hit).toBeDefined();
    expect(hit!.blocking).toBe(true); // 30h route, no time passed
  });

  it("accepts travel once enough time has passed", () => {
    const v = checkCanon(pack, baseState(), {
      ...emptyDelta,
      place_id: "werowocomoco",
      date: "1607-07-18",
    });
    expect(v.some((x) => x.code === "travel-too-fast")).toBe(false);
  });

  it("knows the route both ways", () => {
    expect(routeHours(pack, "james-fort", "glasshouse")).toBe(1);
    expect(routeHours(pack, "glasshouse", "james-fort")).toBe(1);
    expect(routeHours(pack, "james-fort", "london")).toBeNull();
  });

  it("finds the next fixed event the story is heading toward", () => {
    const e = nextFixedEvent(pack, "1609-11-01");
    expect(e?.id).toBe("starving-time");
  });
});

describe("retrieval", () => {
  it("never returns a person who is already dead", () => {
    const ctx = retrieve(pack, { date: "1610-01-01", placeId: "james-fort", tags: [] });
    expect(ctx.people.some((p) => p.id === "bartholomew-gosnold")).toBe(false);
  });

  it("never returns a place that no longer exists", () => {
    const ctx = retrieve(pack, { date: "1612-01-01", placeId: "james-fort", tags: [] });
    expect(ctx.places.some((p) => p.id === "paspahegh")).toBe(false);
  });

  it("does not leak events from years in the future", () => {
    const ctx = retrieve(pack, { date: "1607-07-15", placeId: "james-fort", tags: [] });
    expect(ctx.events.some((e) => e.id === "powhatan-uprising-1622")).toBe(false);
    expect(ctx.events.some((e) => e.id === "first-africans-arrive")).toBe(false);
  });

  it("surfaces what is actually happening now", () => {
    const ctx = retrieve(pack, {
      date: "1607-07-15",
      placeId: "james-fort",
      tags: ["disease"],
    });
    expect(ctx.events.map((e) => e.id)).toContain("summer-sickness-1607");
  });

  it("always includes the place the story is standing in", () => {
    const ctx = retrieve(pack, { date: "1607-07-15", placeId: "james-fort", tags: [] });
    expect(ctx.places[0]?.id).toBe("james-fort");
  });

  it("prefers people who are present at the current place", () => {
    const ctx = retrieve(pack, { date: "1607-07-15", placeId: "james-fort", tags: [] });
    expect(ctx.people.map((p) => p.id)).toContain("john-smith");
  });

  it("cites only sources the retrieved entries actually use", () => {
    const ctx = retrieve(pack, { date: "1607-07-15", placeId: "james-fort", tags: [] });
    const known = new Set(pack.sources.map((s) => s.id));
    expect(ctx.sourceIds.every((s) => known.has(s))).toBe(true);
    expect(ctx.sourceIds.length).toBeGreaterThan(0);
  });
});

describe("character to era translation", () => {
  it("translates a modern skill into its era equivalent", () => {
    const r = resolveAffordances(character, pack);
    const medicine = r.resolved.find((x) => x.tag === "skill.medicine");
    expect(medicine?.eraName).toContain("physic");
    expect(medicine?.plausibility).toBe("common"); // for a woman settler
  });

  it("grants no mechanical flags for an implausible capability", () => {
    const r = resolveAffordances(character, pack);
    const prog = r.resolved.find((x) => x.tag === "skill.programming");
    expect(prog?.plausibility).toBe("implausible");
    expect(prog?.enables).toEqual([]);
  });

  it("still explains an implausible skill rather than dropping it", () => {
    const r = resolveAffordances(character, pack);
    const prog = r.resolved.find((x) => x.tag === "skill.programming");
    expect(prog?.translation).toContain("Nothing you do for a living exists here");
  });

  it("marks capabilities that are unusual for the character's station", () => {
    const gentleman: Character = { ...character, social_position: "gentleman" };
    const r = resolveAffordances(gentleman, pack);
    expect(r.remarkable.map((x) => x.tag)).toContain("skill.cooking");
  });

  it("reports tags the era has no equivalent for instead of inventing one", () => {
    const withLaw: Character = { ...character, skills: ["skill.law"] };
    const r = resolveAffordances(withLaw, pack);
    expect(r.untranslated.map((u) => u.tag)).toEqual(["skill.law"]);
  });

  it("collects unlockable flags from plausible affordances only", () => {
    const r = resolveAffordances(character, pack);
    expect(r.flags).toContain("treat-wounds");
    expect(r.flags).not.toContain("systematic-thinking");
  });
});

describe("ontology normalisation", () => {
  it("matches an exact alias", () => {
    expect(resolveTag("blacksmith", "skills")?.id).toBe("skill.metalworking");
  });

  it("matches a label case-insensitively", () => {
    expect(resolveTag("  Carpentry and Woodwork ", "skills")?.id).toBe("skill.carpentry");
  });

  it("matches a phrase containing an alias", () => {
    expect(resolveTag("I work as a nurse", "skills")?.id).toBe("skill.medicine");
  });

  it("returns null rather than guessing", () => {
    expect(resolveTag("competitive dog grooming", "skills")).toBeNull();
  });

  it("reports what it could not match", () => {
    const r = normaliseAll(["carpentry", "quantum bassoon"], "skills");
    expect(r.tags).toEqual(["skill.carpentry"]);
    expect(r.unmatched).toEqual(["quantum bassoon"]);
  });

  it("does not produce duplicate tags", () => {
    const r = normaliseAll(["doctor", "nurse", "first aid"], "skills");
    expect(r.tags).toEqual(["skill.medicine"]);
  });
});

describe("session store", () => {
  it("round-trips a session", async () => {
    const store = new MemorySessionStore();
    const state = baseState();
    await store.save(state);
    expect(await store.load("test")).toEqual(state);
    expect(await store.load("missing")).toBeNull();
  });
});
