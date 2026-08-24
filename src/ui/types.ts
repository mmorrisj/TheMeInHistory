/** Shapes shared between the API routes and the client components. */

export interface PositionOption {
  id: string;
  label: string;
  description: string;
  constraints: string[];
}

export interface HookOption {
  id: string;
  title: string;
  premise: string;
  opensDate: string;
  socialPositions: string[];
  teaches: string[];
}

export interface TagOption {
  id: string;
  label: string;
}

export interface BuilderData {
  packId: string;
  packTitle: string;
  positions: PositionOption[];
  hooks: HookOption[];
  skills: TagOption[];
  traits: TagOption[];
  interests: TagOption[];
}

export interface TranslationPreview {
  tag: string;
  label: string;
  eraName: string;
  plausibility: string;
  translation: string;
}

export interface TurnPayload {
  prose: string;
  choices: { id: string; text: string }[];
  date: string;
  placeId: string;
  chapter: number;
  health: number;
  standing: number;
  terms: { term: string; meaning: string }[];
  refs: { ref_id: string; phrase: string; kind: string }[];
  warnings: string[];
  chapterClosed?: { title: string; ledger: LedgerRow[] };
}

export interface LedgerRow {
  kind: "fact" | "reconstruction" | "invention" | "contested";
  claim: string;
  refs: string[];
  source_ids: string[];
  note?: string;
}
