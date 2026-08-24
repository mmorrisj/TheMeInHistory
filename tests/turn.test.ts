import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySessionStore, setStore } from "@/engine/store";
import { startSession, takeTurn } from "@/engine/turn";
import { setClient } from "@/llm/client";
import type { Character } from "@/character/schema";
import type { NarratorOutput } from "@/llm/schemas";

/**
 * Turn-loop tests against a stubbed Claude client.
 *
 * The point is the orchestration: that a canon-violating delta is fed back for
 * a retry, that state is applied deterministically, and that the ledger is
 * built from what the narrator declared. No network.
 */

const character: Character = {
  name: "Alice Fenn",
  age: 24,
  background: "",
  social_position: "woman-settler",
  skills: ["skill.medicine"],
  traits: ["trait.stubborn"],
  interests: [],
  pronouns: "she/her",
};

const emptyDelta = {
  add_flags: [],
  remove_flags: [],
  add_inventory: [],
  remove_inventory: [],
  health_change: 0,
  standing_change: 0,
  relationships: [],
  witnessed: [],
};

function scene(overrides: Partial<NarratorOutput> = {}): NarratorOutput {
  return {
    prose: "The bell rang for evening prayer, and you went.",
    choices: [
      { id: "a", text: "Go to the storehouse.", requires_flags: [] },
      { id: "b", text: "Find Master Percy.", requires_flags: [] },
    ],
    state_delta: { ...emptyDelta },
    history_refs: [],
    invented: [],
    new_terms: [],
    ...overrides,
  };
}

/** Minimal stub standing in for the Anthropic client's `messages.parse`. */
function stubClient(outputs: NarratorOutput[]) {
  const calls: unknown[] = [];
  let i = 0;
  const parse = vi.fn(async (req: unknown) => {
    calls.push(req);
    const out = outputs[Math.min(i, outputs.length - 1)];
    i++;
    return { stop_reason: "end_turn", parsed_output: out, content: [] };
  });
  // Only `messages.parse` is exercised by the turn loop.
  setClient({ messages: { parse } } as never);
  return { parse, calls };
}

describe("turn loop", () => {
  beforeEach(() => {
    setStore(new MemorySessionStore());
  });

  it("starts a session at the hook's date and place", async () => {
    stubClient([scene()]);
    const state = await startSession({
      packId: "virginia-colony-1607",
      hookId: "the-glasshouse",
      character,
    });
    expect(state.date).toBe("1608-10-20");
    expect(state.place_id).toBe("glasshouse");
    expect(state.chapter).toBe(1);
    // Affordance flags are seeded at creation.
    expect(state.flags).toContain("treat-wounds");
  });

  it("refuses a hook the character's social position cannot play", async () => {
    await expect(
      startSession({
        packId: "virginia-colony-1607",
        hookId: "the-summer-of-1619",
        character, // woman-settler; that hook is gentleman/artisan/labourer
      }),
    ).rejects.toThrow(/does not support the social position/);
  });

  it("records a turn and applies the narrator's delta", async () => {
    stubClient([
      scene({
        state_delta: {
          ...emptyDelta,
          date: "1608-10-21",
          add_flags: ["spoke-to-percy"],
          health_change: -5,
        },
      }),
    ]);
    const started = await startSession({
      packId: "virginia-colony-1607",
      hookId: "the-glasshouse",
      character,
    });
    const result = await takeTurn({
      sessionId: started.session_id,
      choice: null,
      skipAudit: true,
    });

    expect(result.turn.index).toBe(0);
    expect(result.state.date).toBe("1608-10-21");
    expect(result.state.flags).toContain("spoke-to-percy");
    expect(result.state.health).toBe(75);
    expect(result.state.turns).toHaveLength(1);
  });

  it("retries when the narrator proposes a canon violation, and feeds back why", async () => {
    const { parse, calls } = stubClient([
      // First attempt walks the story clock backwards.
      scene({ state_delta: { ...emptyDelta, date: "1608-01-01" } }),
      // Second attempt is legal.
      scene({ state_delta: { ...emptyDelta, date: "1608-10-21" } }),
    ]);
    const started = await startSession({
      packId: "virginia-colony-1607",
      hookId: "the-glasshouse",
      character,
    });
    const result = await takeTurn({
      sessionId: started.session_id,
      choice: null,
      skipAudit: true,
    });

    expect(parse).toHaveBeenCalledTimes(2);
    const retry = JSON.stringify(calls[1]);
    expect(retry).toContain("YOUR PREVIOUS ATTEMPT WAS REJECTED");
    expect(retry).toContain("backwards");
    expect(result.state.date).toBe("1608-10-21");
  });

  it("keeps the scene but drops the illegal movement when retries are exhausted", async () => {
    stubClient([
      scene({ state_delta: { ...emptyDelta, date: "1500-01-01", add_flags: ["kept"] } }),
    ]);
    const started = await startSession({
      packId: "virginia-colony-1607",
      hookId: "the-glasshouse",
      character,
    });
    const result = await takeTurn({
      sessionId: started.session_id,
      choice: null,
      skipAudit: true,
    });

    // The prose survives; the out-of-range date does not.
    expect(result.turn.prose).toBeTruthy();
    expect(result.state.date).toBe("1608-10-20");
    expect(result.state.flags).toContain("kept");
  });

  it("builds ledger entries from refs and declared inventions", async () => {
    stubClient([
      scene({
        history_refs: [
          { ref_id: "second-supply", phrase: "the ship that brought you", kind: "event" },
          { ref_id: "pocahontas-rescue", phrase: "the story Smith told", kind: "event" },
        ],
        invented: [
          { what: "Goodwife Marbury, a laundress", basis: "Ordinary servants are undocumented individually." },
        ],
      }),
    ]);
    const started = await startSession({
      packId: "virginia-colony-1607",
      hookId: "the-glasshouse",
      character,
    });
    const result = await takeTurn({
      sessionId: started.session_id,
      choice: null,
      skipAudit: true,
    });

    const kinds = result.state.ledger.map((l) => l.kind);
    expect(kinds).toContain("fact");
    expect(kinds).toContain("contested"); // pocahontas-rescue is contested in the pack
    expect(kinds).toContain("invention");

    const contested = result.state.ledger.find((l) => l.kind === "contested");
    expect(contested?.source_ids.length).toBeGreaterThan(0);
    expect(contested?.note).toBeTruthy();
  });

  it("surfaces anachronisms found in the generated prose", async () => {
    stubClient([scene({ prose: "Okay, said the sentry, and lit his rifle." })]);
    const started = await startSession({
      packId: "virginia-colony-1607",
      hookId: "the-glasshouse",
      character,
    });
    const result = await takeTurn({
      sessionId: started.session_id,
      choice: null,
      skipAudit: true,
    });

    const matched = result.blocklistHits.map((h) => h.matched.toLowerCase());
    expect(matched).toContain("okay");
    expect(matched).toContain("rifle");
  });

  it("persists across turns", async () => {
    stubClient([
      scene({ state_delta: { ...emptyDelta, add_flags: ["one"] } }),
      scene({ state_delta: { ...emptyDelta, add_flags: ["two"] } }),
    ]);
    const started = await startSession({
      packId: "virginia-colony-1607",
      hookId: "the-glasshouse",
      character,
    });
    await takeTurn({ sessionId: started.session_id, choice: null, skipAudit: true });
    const second = await takeTurn({
      sessionId: started.session_id,
      choice: "Go to the storehouse.",
      skipAudit: true,
    });

    expect(second.state.flags).toEqual(expect.arrayContaining(["one", "two"]));
    expect(second.state.turns).toHaveLength(2);
    expect(second.state.turns[1]?.chose).toBe("Go to the storehouse.");
  });

  it("caches the era rules on the system prompt", async () => {
    const { calls } = stubClient([scene()]);
    const started = await startSession({
      packId: "virginia-colony-1607",
      hookId: "the-glasshouse",
      character,
    });
    await takeTurn({ sessionId: started.session_id, choice: null, skipAudit: true });

    const req = calls[0] as { system: { cache_control?: unknown; text: string }[] };
    expect(req.system[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // The stable half carries the era rules, not the per-turn facts.
    expect(req.system[0]?.text).toContain("CONTENT POSTURE");
    expect(req.system[0]?.text).not.toContain("CURRENT STATE");
  });
});
