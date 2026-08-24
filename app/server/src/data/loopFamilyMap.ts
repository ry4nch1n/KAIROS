// Curated genre × tag → loop-family map (in-rails slice of #12, decomposed as #108). The missing
// join between the market side (crawled genres/tags) and the plan's loop FAMILIES
// (CONTRACT.pitch.loopFamilies). Same discipline as the sibling data files (genreConversion.ts,
// teamSize.ts): an unmapped key returns null (no claim, never force-fit), git history is the audit
// trail, and a test asserts every value is a live contract family. Initial REPRESENTATIVE set —
// widening coverage is just more keys, no shape change. A genre × tag entry overrides the
// genre-level one; the fold runs in JS (getLoopFamilyMarket).
import type { CONTRACT } from "../../../shared/src/contract.ts";

export type LoopFamily = (typeof CONTRACT.pitch.loopFamilies)[number];
/** Normalize a genre/tag for lookup: lowercase, trim, collapse internal whitespace. */
export function normalizeKey(name: string | null | undefined): string {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
// Genre-level fallback (canonical genre, lowercased). Broad genres with no single loop (Shooter,
// Action, Strategy) are absent → null; routed via genre × tag below.
const GENRE: Record<string, LoopFamily> = {
  survivor: "minimal-input-survivors",
  idle: "idle-tycoon",
  incremental: "idle-tycoon",
  clicker: "idle-tycoon",
  cooking: "cozy-craft",
  farming: "cozy-craft",
  puzzle: "route-planning",
  driving: "route-planning",
  automation: "automation-under-pressure",
  "tower defense": "wave-defense-prep",
};

// Genre × tag overrides — a sub-genre reading differently than its bare genre; [genre][tag],
// consulted before the genre-level table. Where the tag axis earns its keep.
const GENRE_TAG: Record<string, Record<string, LoopFamily>> = {
  strategy: { "tower-defense": "wave-defense-prep" },
  shooter: { extraction: "extraction-lite", "looter-shooter": "extraction-lite" },
  action: { "survivor-like": "minimal-input-survivors", deckbuilding: "synergy-builder" },
  simulation: { automation: "automation-under-pressure", sandbox: "contained-systemic" },
};

// Surface-form variants of the keys above. The tables are keyed canonically ("deckbuilding"),
// but prose writes the same genre several ways — "deckbuilder", "deck-building", "deck builder".
// This matters mechanically, not just stylistically: `words()` collapses punctuation to spaces,
// so a hyphenated "Deck-building" arrives as TWO tokens and can never match a single-token key.
// Verified against the 2026-08-04 edition, where four deckbuilder signals went unclassified for
// exactly this reason. Same discipline as the tables above — explicit and auditable, never
// stemmed or guessed; every value must already be a family the tables can emit.
const SYNONYMS: [string, LoopFamily][] = [
  ["deckbuilder", "synergy-builder"],
  ["deck builder", "synergy-builder"],
  ["deck building", "synergy-builder"],
  ["synergy engine", "synergy-builder"],
  // The contract defines synergy-builder as "SPIN/deck synergy-engine roguelites, the Balatro /
  // Luck-be-a-Landlord lineage", so the slot-machine half of that lineage belongs here too —
  // without these, CloverPit ("Balatro-style slot-machine roguelite") and Slots & Daggers went
  // unplaced. `balatro` earns a key because the market uses it as a genre label, not just a title.
  ["slot machine", "synergy-builder"],
  ["balatro", "synergy-builder"],
  ["tower defence", "wave-defense-prep"], // British spelling of the GENRE key
  ["bullet heaven", "minimal-input-survivors"],
  // The market names this loop by its subject, not by the word "automation": "factory builder",
  // "production chain" (#163). `production` is the looser of the two — a blurb can use it about
  // development ("back in production") rather than the loop; revisit if it ever fires on one.
  ["factory", "automation-under-pressure"],
  ["production", "automation-under-pressure"],
];

// Every distinct family this map can emit — the test asserts each is a live contract family.
const TAG_FAMILIES = Object.values(GENRE_TAG).flatMap((m) => Object.values(m));
export const MAPPED_FAMILIES: readonly LoopFamily[] = [
  ...new Set<LoopFamily>([...Object.values(GENRE), ...TAG_FAMILIES, ...SYNONYMS.map(([, f]) => f)]),
];

// Free-text vocabulary: every genre key plus every genre × tag TAG key standing alone — a
// deliberate widening for callers holding only LABELS (the News Brief's items, #12a). One
// vocabulary, no second table; ambiguity still resolves to null.
const words = (s: string | null | undefined) =>
  normalizeKey(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const TEXT_KEYS: [string, LoopFamily][] = [
  ...Object.entries(GENRE),
  ...Object.values(GENRE_TAG).flatMap((m) => Object.entries(m)),
  ...SYNONYMS,
].map(([k, f]) => [words(k), f as LoopFamily]);

/** One pass over a set of fields. Whole-word match, plural tolerated; exactly one family wins,
 *  while none or several disagreeing → null. That ambiguity guard is what lets the lower-
 *  confidence prose tier below stay honest. */
function matchOne(fields: (string | null | undefined)[]): LoopFamily | null {
  const hay = ` ${fields.map(words).filter(Boolean).join(" ")} `;
  const hits = new Set<LoopFamily>();
  for (const [k, f] of TEXT_KEYS)
    if (hay.includes(` ${k} `) || hay.includes(` ${k}s `)) hits.add(f);
  return hits.size === 1 ? [...hits][0] : null;
}

/** Loop family implied by an item's LABEL fields, falling back to PROSE when the labels are
 *  silent. Labels keep precedence — they are the item's own classification — but they are often
 *  not a genre claim at all: in the News Brief, `category`/`kind` carry EDITORIAL ROLE
 *  ("Loop reference", "Browser platform"), so a label-only read placed 0 of 12 signals on
 *  2026-08-04 while the genre sat in the blurb ("Deck-building roguelite…"). Prose is therefore
 *  consulted second rather than ignored. It is genuinely lower-confidence — a blurb can name a
 *  genre it is not (a chart summary listing "puzzle, word, card" titles) — so it only runs when
 *  labels yield nothing, and the single-family guard still applies. */
export function loopFamilyFromLabels(
  labels: (string | null | undefined)[],
  prose?: (string | null | undefined)[],
): LoopFamily | null {
  return matchOne(labels) ?? (prose?.length ? matchOne(prose) : null);
}

/** Loop family for a genre (and optional tag), or null when nothing is curated. A genre × tag
 *  entry wins over the genre-level fallback; an unmapped key is null, never guessed. */
export function loopFamilyFor(
  genre: string | null | undefined,
  tag?: string | null | undefined,
): LoopFamily | null {
  const g = normalizeKey(genre);
  if (!g) return null;
  const t = normalizeKey(tag);
  if (t) {
    const pair = GENRE_TAG[g]?.[t];
    if (pair) return pair;
  }
  return GENRE[g] ?? null;
}
