import { describe, expect, it } from "vitest";
import { listPackIds, loadPack } from "@/content/loader";
import { getOntology } from "@/character/ontology";

const PACK_ID = "virginia-colony-1607";

describe("Era Pack integrity", () => {
  const pack = loadPack(PACK_ID);

  it("ships at least one pack", () => {
    expect(listPackIds()).toContain(PACK_ID);
  });

  it("is marked reviewed, so the runtime will serve it", () => {
    expect(pack.meta.status).toBe("reviewed");
  });

  it("gives every historical entry a source", () => {
    const unsourced = [
      ...pack.timeline.map((e) => ({ id: `timeline/${e.id}`, s: e.source_ids })),
      ...pack.people.map((p) => ({ id: `people/${p.id}`, s: p.source_ids })),
      ...pack.places.map((p) => ({ id: `places/${p.id}`, s: p.source_ids })),
    ].filter((x) => x.s.length === 0);
    expect(unsourced).toEqual([]);
  });

  it("resolves every source id that any entry cites", () => {
    const known = new Set(pack.sources.map((s) => s.id));
    const cited = new Set([
      ...pack.timeline.flatMap((e) => e.source_ids),
      ...pack.people.flatMap((p) => p.source_ids),
      ...pack.places.flatMap((p) => p.source_ids),
      ...pack.affordances.flatMap((a) => a.source_ids),
    ]);
    expect([...cited].filter((c) => !known.has(c))).toEqual([]);
  });

  it("uses ontology tags for every affordance", () => {
    const o = getOntology();
    const tags = new Set([
      ...o.skills.map((t) => t.id),
      ...o.traits.map((t) => t.id),
      ...o.interests.map((t) => t.id),
    ]);
    expect(pack.affordances.filter((a) => !tags.has(a.tag)).map((a) => a.tag)).toEqual([]);
  });

  it("keeps every hook inside the pack's date range and at a real place", () => {
    const placeIds = new Set(pack.places.map((p) => p.id));
    for (const h of pack.hooks.hooks) {
      expect(placeIds.has(h.opens.place_id)).toBe(true);
      expect(h.opens.date >= pack.meta.date_range.start).toBe(true);
      expect(h.opens.date <= pack.meta.date_range.end).toBe(true);
    }
  });

  it("explains the doubt whenever certainty is not established", () => {
    const unexplained = pack.timeline
      .filter((e) => e.certainty !== "established" && !e.note)
      .map((e) => e.id);
    expect(unexplained).toEqual([]);
  });

  it("marks the documented catastrophes as fixed so no choice averts them", () => {
    const mustBeFixed = [
      "starving-time",
      "first-africans-arrive",
      "powhatan-uprising-1622",
      "paspahegh-massacre",
    ];
    for (const id of mustBeFixed) {
      const e = pack.timeline.find((x) => x.id === id);
      expect(e, `${id} missing from timeline`).toBeDefined();
      expect(e!.fixed, `${id} should be fixed`).toBe(true);
    }
  });

  it("treats the Pocahontas rescue as contested rather than fact", () => {
    const e = pack.timeline.find((x) => x.id === "pocahontas-rescue");
    expect(e?.certainty).toBe("contested");
    expect(e?.fixed).toBe(false);
  });

  it("compiles every blocklist pattern", () => {
    for (const b of pack.blocklist.entries) {
      expect(() => new RegExp(b.pattern, "gi"), b.pattern).not.toThrow();
    }
  });

  it("gives every social position a playable hook", () => {
    for (const pos of pack.meta.social_positions) {
      const playable = pack.hooks.hooks.some((h) =>
        h.social_positions.includes(pos.id),
      );
      expect(playable, `no hook for ${pos.id}`).toBe(true);
    }
  });
});
