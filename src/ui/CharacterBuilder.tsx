"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BuilderData, TranslationPreview } from "./types";

/**
 * Character builder.
 *
 * Social position is asked first and framed as the most consequential choice,
 * because in most historical settings it constrains the story far more than
 * personality does. The hook list then filters to what that position could
 * actually have been present for — a woman cannot play Jamestown's first
 * summer, because there were no Englishwomen in the colony until October 1608.
 */
export function CharacterBuilder({ data }: { data: BuilderData }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [age, setAge] = useState(24);
  const [pronouns, setPronouns] = useState<"she/her" | "he/him" | "they/them">("they/them");
  const [background, setBackground] = useState("");
  const [position, setPosition] = useState(data.positions[0]?.id ?? "");
  const [skills, setSkills] = useState<string[]>([]);
  const [traits, setTraits] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [extraSkills, setExtraSkills] = useState("");
  const [hookId, setHookId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TranslationPreview[] | null>(null);

  const availableHooks = useMemo(
    () => data.hooks.filter((h) => h.socialPositions.includes(position)),
    [data.hooks, position],
  );

  const chosenHook = availableHooks.find((h) => h.id === hookId) ?? availableHooks[0];

  const toggle = (
    list: string[],
    setList: (v: string[]) => void,
    id: string,
    max: number,
  ) => {
    setList(
      list.includes(id)
        ? list.filter((x) => x !== id)
        : list.length >= max
          ? list
          : [...list, id],
    );
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Give your character a name.");
    if (!chosenHook) return setError("Choose a story to begin.");

    setBusy(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pack_id: data.packId,
          hook_id: chosenHook.id,
          character: {
            name: name.trim(),
            age,
            pronouns,
            background: background.trim(),
            social_position: position,
            // Selected chips are already ontology ids; the free-text box is
            // normalised server-side and anything unmatched is reported back.
            skills_text: [
              ...skills.map((s) => labelFor(data.skills, s)),
              ...extraSkills.split(",").map((s) => s.trim()).filter(Boolean),
            ],
            traits_text: traits.map((t) => labelFor(data.traits, t)),
            interests_text: interests.map((i) => labelFor(data.interests, i)),
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start the story.");
      setPreview(json.translations);
      // Give the reader a beat to see how their character was translated.
      setTimeout(() => router.push(`/play/${json.session_id}`), 2600);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (preview) {
    return (
      <main>
        <h1>Translated into 1607</h1>
        <p className="lede">
          Here is what {name} brings, as this era would understand it. Opening
          the story…
        </p>
        {preview.map((t) => (
          <div className="card" key={t.tag}>
            <h3>
              {t.label} → &ldquo;{t.eraName}&rdquo;
            </h3>
            <p className="meta">
              {t.plausibility} for a{" "}
              {data.positions.find((p) => p.id === position)?.label}
            </p>
            <p style={{ marginBottom: 0 }}>{t.translation}</p>
          </div>
        ))}
      </main>
    );
  }

  return (
    <main>
      <h1>Make your character</h1>
      <p className="lede">{data.packTitle}</p>

      <div className="row">
        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name, or one you invent"
          />
        </div>
        <div className="field" style={{ flex: "0 0 6rem" }}>
          <label htmlFor="age">Age</label>
          <input
            id="age"
            type="number"
            min={12}
            max={80}
            value={age}
            onChange={(e) => setAge(Number(e.target.value))}
          />
        </div>
        <div className="field" style={{ flex: "0 0 9rem" }}>
          <label htmlFor="pronouns">Pronouns</label>
          <select
            id="pronouns"
            value={pronouns}
            onChange={(e) => setPronouns(e.target.value as typeof pronouns)}
          >
            <option value="they/them">they/them</option>
            <option value="she/her">she/her</option>
            <option value="he/him">he/him</option>
          </select>
        </div>
      </div>

      <h2>Where you stand</h2>
      <p className="hint" style={{ marginTop: "-0.5rem", marginBottom: "1rem" }}>
        This matters more than anything else you choose. In this period your
        station decides what you may do, who must listen to you, and what the
        law can do to you.
      </p>
      {data.positions.map((p) => (
        <div
          key={p.id}
          className={`card selectable ${position === p.id ? "selected" : ""}`}
          onClick={() => {
            setPosition(p.id);
            setHookId("");
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              setPosition(p.id);
              setHookId("");
            }
          }}
        >
          <h3>{p.label}</h3>
          <p>{p.description}</p>
          {p.constraints.length > 0 && (
            <ul className="meta" style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {p.constraints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <h2>What you can do</h2>
      <p className="hint" style={{ marginTop: "-0.5rem" }}>
        Pick up to five. Modern skills are translated into the era rather than
        rejected — the translation is usually the interesting part.
      </p>
      <div className="chips">
        {data.skills.map((s) => (
          <button
            type="button"
            key={s.id}
            className="chip"
            aria-pressed={skills.includes(s.id)}
            onClick={() => toggle(skills, setSkills, s.id, 5)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: "0.9rem" }}>
        <label htmlFor="extra">Anything else, in your own words</label>
        <input
          id="extra"
          type="text"
          value={extraSkills}
          onChange={(e) => setExtraSkills(e.target.value)}
          placeholder="comma separated — e.g. beekeeping, accountancy"
        />
        <p className="hint">
          Anything the era has no equivalent for will be said so plainly rather
          than quietly given one.
        </p>
      </div>

      <h2>What you are like</h2>
      <div className="chips">
        {data.traits.map((t) => (
          <button
            type="button"
            key={t.id}
            className="chip"
            aria-pressed={traits.includes(t.id)}
            onClick={() => toggle(traits, setTraits, t.id, 4)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <h2>What interests you</h2>
      <div className="chips">
        {data.interests.map((t) => (
          <button
            type="button"
            key={t.id}
            className="chip"
            aria-pressed={interests.includes(t.id)}
            onClick={() => toggle(interests, setInterests, t.id, 4)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="field" style={{ marginTop: "1.5rem" }}>
        <label htmlFor="background">Anything else about you (optional)</label>
        <textarea
          id="background"
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          placeholder="A sentence or two. The narrator will use it."
        />
      </div>

      <h2>Where your story starts</h2>
      {availableHooks.length === 0 ? (
        <div className="notice">
          No opening in this pack is playable as{" "}
          {data.positions.find((p) => p.id === position)?.label}. Choose another
          station.
        </div>
      ) : (
        availableHooks.map((h) => (
          <div
            key={h.id}
            className={`card selectable ${chosenHook?.id === h.id ? "selected" : ""}`}
            onClick={() => setHookId(h.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setHookId(h.id);
            }}
          >
            <h3>{h.title}</h3>
            <p className="meta">Opens {h.opensDate}</p>
            <p>{h.premise}</p>
            <p className="meta" style={{ marginBottom: 0 }}>
              You will come away understanding: {h.teaches.join("; ")}.
            </p>
          </div>
        ))
      )}

      {error && <div className="notice error">{error}</div>}

      <button onClick={submit} disabled={busy || !chosenHook}>
        {busy ? "Opening the story…" : "Begin"}
      </button>
    </main>
  );
}

function labelFor(options: { id: string; label: string }[], id: string): string {
  return options.find((o) => o.id === id)?.label ?? id;
}
