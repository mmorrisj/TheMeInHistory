import Link from "next/link";
import { loadPlayablePacks } from "@/content/loader";

export const dynamic = "force-dynamic";

export default function Home() {
  const packs = loadPlayablePacks();

  return (
    <main>
      <h1>The Me In History</h1>
      <p className="lede">
        Build a character — or bring yourself — and be planted into a real
        historical setting. The narrator can only assert what a reviewed,
        sourced Era Pack says is true, and every chapter ends with a ledger
        separating what happened from what was invented on your behalf.
      </p>

      <h2>Choose a setting</h2>
      {packs.length === 0 && (
        <div className="notice">
          No reviewed Era Packs are installed. A pack must be marked{" "}
          <code>status: reviewed</code> before the runtime will serve it.
        </div>
      )}

      {packs.map((pack) => (
        <div className="card" key={pack.meta.id}>
          <h3>{pack.meta.title}</h3>
          <p>{pack.meta.blurb}</p>
          <p className="meta">
            {pack.timeline.length} dated events · {pack.people.length} real
            people · {pack.sources.length} sources ·{" "}
            {pack.meta.date_range.start} to {pack.meta.date_range.end}
          </p>
          <p style={{ marginBottom: 0 }}>
            <Link href={`/create?pack=${pack.meta.id}`}>
              Make a character for this era →
            </Link>
          </p>
        </div>
      ))}

      <hr className="rule" />
      <p className="meta">
        History here is content, not model memory. Era Packs live in{" "}
        <code>content/eras/</code> as sourced, certainty-tagged YAML, reviewable
        in a pull request. See <code>docs/DESIGN.md</code>.
      </p>
    </main>
  );
}
