import { notFound } from "next/navigation";
import { getStore } from "@/engine/store";
import { getPack } from "@/content/loader";
import { PlayView } from "@/ui/PlayView";

export const dynamic = "force-dynamic";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const state = await getStore().load(sessionId);
  if (!state) notFound();

  const pack = getPack(state.pack_id);
  const place = pack.places.find((p) => p.id === state.place_id);

  return (
    <PlayView
      sessionId={sessionId}
      characterName={state.character.name}
      packTitle={pack.meta.title}
      initial={{
        date: state.date,
        placeName: place?.name ?? state.place_id,
        chapter: state.chapter,
        health: state.health,
        standing: state.standing,
        turns: state.turns.map((t) => ({
          prose: t.prose,
          choices: t.choices,
        })),
      }}
      ledger={state.ledger}
    />
  );
}
