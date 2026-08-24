import { getPack, loadPlayablePacks } from "@/content/loader";
import { getOntology } from "@/character/ontology";
import { CharacterBuilder } from "@/ui/CharacterBuilder";
import type { BuilderData } from "@/ui/types";

export const dynamic = "force-dynamic";

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ pack?: string }>;
}) {
  const { pack: requested } = await searchParams;
  const packId = requested ?? loadPlayablePacks()[0]?.meta.id;
  if (!packId) {
    return (
      <main>
        <h1>No settings installed</h1>
        <p>No reviewed Era Pack was found under <code>content/eras/</code>.</p>
      </main>
    );
  }

  const pack = getPack(packId);
  const ontology = getOntology();

  const data: BuilderData = {
    packId,
    packTitle: pack.meta.title,
    positions: pack.meta.social_positions.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      constraints: p.constraints,
    })),
    hooks: pack.hooks.hooks.map((h) => ({
      id: h.id,
      title: h.title,
      premise: h.premise,
      opensDate: h.opens.date,
      socialPositions: h.social_positions,
      teaches: h.teaches,
    })),
    skills: ontology.skills.map((t) => ({ id: t.id, label: t.label })),
    traits: ontology.traits.map((t) => ({ id: t.id, label: t.label })),
    interests: ontology.interests.map((t) => ({ id: t.id, label: t.label })),
  };

  return <CharacterBuilder data={data} />;
}
