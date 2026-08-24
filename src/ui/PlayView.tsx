"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LedgerRow, TurnPayload } from "./types";

interface RenderedTurn {
  prose: string;
  choices: { id: string; text: string }[];
}

interface Props {
  sessionId: string;
  characterName: string;
  packTitle: string;
  initial: {
    date: string;
    placeName: string;
    chapter: number;
    health: number;
    standing: number;
    turns: RenderedTurn[];
  };
  ledger: LedgerRow[];
}

export function PlayView({ sessionId, characterName, packTitle, initial, ledger }: Props) {
  const [turns, setTurns] = useState<RenderedTurn[]>(initial.turns);
  const [status, setStatus] = useState({
    date: initial.date,
    placeName: initial.placeName,
    chapter: initial.chapter,
    health: initial.health,
    standing: initial.standing,
  });
  const [terms, setTerms] = useState<{ term: string; meaning: string }[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [chapterClosed, setChapterClosed] = useState<TurnPayload["chapterClosed"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  const advance = useCallback(async (choice: string | null) => {
    setBusy(true);
    setError(null);
    setWarnings([]);
    setChapterClosed(undefined);
    try {
      const res = await fetch(`/api/session/${sessionId}/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The story could not continue.");
      const payload = json as TurnPayload;
      setTurns((prev) => [...prev, { prose: payload.prose, choices: payload.choices }]);
      setStatus({
        date: payload.date,
        placeName: payload.placeId,
        chapter: payload.chapter,
        health: payload.health,
        standing: payload.standing,
      });
      setTerms(payload.terms);
      setWarnings(payload.warnings);
      setChapterClosed(payload.chapterClosed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  // Open the story automatically on a session that has no turns yet. The ref
  // guard is what makes this run once; an empty dep array alone would still
  // fire twice under React strict mode.
  useEffect(() => {
    if (turns.length === 0 && !opened.current) {
      opened.current = true;
      void advance(null);
    }
  }, [turns.length, advance]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  const current = turns[turns.length - 1];

  return (
    <main>
      <p className="meta">{packTitle}</p>
      <h1>{characterName}</h1>

      <div className="status">
        <span>
          <b>{status.date}</b>
        </span>
        <span>{status.placeName}</span>
        <span>
          Chapter <b>{status.chapter}</b>
        </span>
        <span>
          Health <b>{status.health}</b>
        </span>
        <span>
          Standing <b>{status.standing}</b>
        </span>
      </div>

      <div className="scene">
        {turns.map((t, i) => (
          <div key={i} className={i < turns.length - 1 ? "past" : undefined}>
            {t.prose.split("\n\n").map((para, j) => (
              <p key={j}>{para}</p>
            ))}
          </div>
        ))}
      </div>

      {busy && <p className="spinner">…</p>}

      {error && (
        <div className="notice error">
          {error}
          <div style={{ marginTop: "0.6rem" }}>
            <button className="secondary" onClick={() => void advance(null)}>
              Try again
            </button>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="notice">
          <b>Anachronisms detected in this passage.</b> These are logged for the
          eval suite and would fail a build:
          <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {!busy && current && current.choices.length > 0 && (
        <div className="choices">
          {current.choices.map((c) => (
            <button
              key={c.id}
              className="choice"
              onClick={() => void advance(c.text)}
              disabled={busy}
            >
              {c.text}
            </button>
          ))}
        </div>
      )}

      {terms.length > 0 && (
        <>
          <h2>Words from this passage</h2>
          {terms.map((t) => (
            <p key={t.term} className="meta">
              <b>{t.term}</b> — {t.meaning}
            </p>
          ))}
        </>
      )}

      {chapterClosed && (
        <>
          <hr className="rule" />
          <h2>{chapterClosed.title}</h2>
          <p className="lede">
            Fact and fiction in the chapter you just finished.
          </p>
          <Ledger rows={chapterClosed.ledger} />
        </>
      )}

      {ledger.length > 0 && !chapterClosed && (
        <>
          <hr className="rule" />
          <h2>Fact &amp; Fiction so far</h2>
          <Ledger rows={ledger} />
        </>
      )}

      <div ref={bottom} />
    </main>
  );
}

const KIND_LABEL: Record<LedgerRow["kind"], string> = {
  fact: "This happened",
  reconstruction: "Reconstructed",
  contested: "Historians disagree",
  invention: "Invented for you",
};

function Ledger({ rows }: { rows: LedgerRow[] }) {
  // Facts first, inventions last: the reader should see the ground before the
  // furniture. Contested entries sit in the middle because they are the ones
  // worth lingering on.
  const order: LedgerRow["kind"][] = ["fact", "contested", "reconstruction", "invention"];
  const sorted = [...rows].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  );

  return (
    <>
      {sorted.map((r, i) => (
        <div className={`ledger-entry ${r.kind}`} key={`${r.claim}-${i}`}>
          <div className={`tag ${r.kind}`}>{KIND_LABEL[r.kind]}</div>
          <p style={{ margin: "0 0 0.3rem" }}>{r.claim}</p>
          {r.note && (
            <p className="meta" style={{ margin: "0 0 0.3rem" }}>
              {r.note}
            </p>
          )}
          {r.source_ids.length > 0 && (
            <p className="meta" style={{ margin: 0 }}>
              Sources: {r.source_ids.join(", ")}
            </p>
          )}
        </div>
      ))}
    </>
  );
}
