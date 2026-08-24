import { describe, expect, it } from "vitest";
import { loadPack } from "@/content/loader";
import { scanBlocklist } from "@/llm/auditor";

/**
 * The anachronism suite.
 *
 * Two directions: the blocklist must fire on prose that contains the mistakes
 * it exists to catch, and it must NOT fire on period-correct prose. The second
 * half is the one that keeps the suite honest — a blocklist that flags
 * everything is as useless as one that flags nothing.
 */

const pack = loadPack("virginia-colony-1607");
const errorsIn = (prose: string) =>
  scanBlocklist(pack, prose).filter((h) => h.severity === "error");

describe("anachronism blocklist catches period errors", () => {
  const shouldFail: [string, string][] = [
    ["modern assent", "Okay, said Master Wingfield, we shall build the palisade."],
    ["modern greeting", "Hello, called the sentry from the bulwark."],
    ["log cabin", "They raised a log cabin within the palisade before winter."],
    ["rifle", "He cleaned his rifle by the fire."],
    ["germ theory", "The bad water was full of bacteria, and infection spread."],
    ["therapy-speak", "He was clearly depressed, and the trauma of the crossing showed."],
    ["Plymouth confusion", "The Pilgrims of the Mayflower had landed only weeks before."],
    ["national identity", "The Americans of the United States would remember this day."],
    ["Plains imagery", "Smoke rose from the teepee, and a war bonnet hung by the door."],
    ["princess framing", "The princess Pocahontas crossed the marketplace."],
    ["empty land", "It was virgin wilderness, an empty country awaiting them."],
    ["nineteenth-century west", "The frontiersman spoke of the Wild West."],
    ["coffee", "He drank his coffee and watched the river."],
    ["potatoes", "They boiled potatoes with the salt pork."],
    ["scientist", "The scientist assayed the ore and pronounced it worthless."],
    ["teenager", "The teenager carried water from the river."],
  ];

  for (const [label, prose] of shouldFail) {
    it(`flags ${label}`, () => {
      const hits = errorsIn(prose);
      expect(hits.length, `expected a hit in: ${prose}`).toBeGreaterThan(0);
    });
  }
});

describe("anachronism blocklist leaves period-correct prose alone", () => {
  const shouldPass: [string, string][] = [
    [
      "the fort in summer",
      `The bell rang for evening prayer and you went, because a man who does not
       is whipped for it. Master Percy stood at the front with his hat in his
       hands, thinner than he was in May. Afterwards you carried water up from
       the river in a leather bucket, and it tasted of salt, as it has since the
       tide began running high in July.`,
    ],
    [
      "trade upriver",
      `The shallop grounded on the mud below Weyanoke and you went up through the
       maize with a hatchet in your belt and three yards of copper in a roll
       under your arm. The weroance kept you waiting, which Master Smith says is
       their custom and means nothing, though you are not certain he knows.`,
    ],
    [
      "the sickening season",
      `Three more in the night. Goodman Laydon says it is the ill air off the
       marsh; the minister says it is God's hand upon a company that will not
       work. You have your own opinion and keep it. The ration this morning was
       a pint of barley boiled in water, and there were weevils in it.`,
    ],
    [
      "a yehakin",
      `Inside the yehakin the fire was low and the mats were rolled up along one
       wall for the heat. A woman pounded maize in a mortar without looking up
       at you. There was tobacco burning somewhere, and it smelled nothing like
       what the sailors carry.`,
    ],
    [
      "the winter",
      `The gates have been shut for six weeks. The horses went in November and
       the dogs a fortnight after. Master Percy has stopped writing the names
       down, which frightens you more than the hunger does.`,
    ],
  ];

  for (const [label, prose] of shouldPass) {
    it(`passes ${label}`, () => {
      const hits = errorsIn(prose);
      expect(
        hits.map((h) => `${h.matched} (${h.pattern})`),
        `false positives in "${label}"`,
      ).toEqual([]);
    });
  }
});

describe("blocklist severities", () => {
  it("treats 'Native American' as a warning, since it is right in the ledger", () => {
    const hits = scanBlocklist(pack, "The Native American peoples of the region.");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.severity === "warn")).toBe(true);
  });

  it("offers a period alternative for most errors", () => {
    const withoutAlternative = pack.blocklist.entries.filter(
      (e) => e.severity === "error" && !e.instead,
    );
    expect(withoutAlternative).toEqual([]);
  });
});
