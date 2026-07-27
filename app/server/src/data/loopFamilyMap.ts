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

// Every distinct family this map can emit — the test asserts each is a live contract family.
const TAG_FAMILIES = Object.values(GENRE_TAG).flatMap((m) => Object.values(m));
export const MAPPED_FAMILIES: readonly LoopFamily[] = [
  ...new Set<LoopFamily>([...Object.values(GENRE), ...TAG_FAMILIES]),
];

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
