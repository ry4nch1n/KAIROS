// Brief → loop-family demand tracker (#12, part (a)). The News Brief was prose disconnected from
// the tables; this tags each item-shaped signal through the curated map (data/loopFamilyMap.ts)
// and folds them into per-family counts. Discipline inherited from that map: an item it cannot
// place stays UNCLASSIFIED, never force-fit. Same for magnitude — only same-unit COUNT figures
// ("12k wishlists") add up, and a family with no parseable figure carries none, not a placeholder.
import type { BriefDemandTracker, BriefFamilyRow, BriefNotable, BriefPayload } from "shared";
import { loopFamilyFromLabels } from "../data/loopFamilyMap.ts";

// Count nouns that may legitimately be summed across items → canonical singular.
const UNITS: Record<string, string> = { copy: "copy", copies: "copy" };
for (const u of ["wishlist", "play", "player", "download", "install", "review", "sale", "unit"])
  UNITS[u] = UNITS[`${u}s`] = u;
const MULT: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

// "12k wishlists" → 12000 wishlist. "4.6★ CrazyGames" / "70%" → null: not counts, never summed.
export function parseFigure(figure?: string | null): { value: number; unit: string } | null {
  const m = String(figure ?? "")
    .toLowerCase()
    .match(/(\d[\d.,]*)\s*([kmb])?\s*\+?\s*([a-z]+)/);
  const unit = m && UNITS[m[3]];
  if (!m || !unit) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? { value: n * (MULT[m[2] ?? ""] ?? 1), unit } : null;
}

// A signal about the PORTAL rather than a title has no loop family, so its prose must not be
// mined for one — "the top-ten list is puzzle, word, card titles" is a chart summary, not a
// puzzle game. The brief marks these with a platform-level label, which is the item's own
// classification and so outranks its prose. Deliberately narrow: surveying every local edition,
// `Browser platform` is the ONLY label that reliably means "not a title" — `Market signal`,
// `Design lesson` and `AI + launch playbook` all name real games (Slay the Spire 2, Two Point
// Museum). A game occasionally filed under the platform label just stays unclassified: safe.
const isPlatformNote = (it: BriefNotable): boolean =>
  /platform/i.test(`${it.category ?? ""} ${it.kind ?? ""}`);

// Family of one item: LABEL fields first, then the blurb. Labels keep precedence, but in this
// payload they are an editorial role ("Loop reference", "Browser platform"), not a genre — so a
// label-only read placed 0 of 12 signals on 2026-08-04 while every genre sat in the blurb.
// `relevance` stays out: it argues why an item matters to the plan, which is commentary.
export const familyOfItem = (it: BriefNotable): string | null =>
  loopFamilyFromLabels(
    [it.name, it.category, it.kind],
    isPlatformNote(it) ? undefined : [it.blurb],
  );

const dir = (n: number, p: number) => (n > p ? "up" : n < p ? "down" : "flat");
type Acc = { n: number; titles: string[]; units: Map<string, number[]> };
function fold(payload?: BriefPayload | null): Map<string | null, Acc> {
  const m = new Map<string | null, Acc>();
  // new_notable + browser are the item-shaped lists naming a concrete game; tooling/market aren't.
  for (const it of [...(payload?.new_notable ?? []), ...(payload?.browser ?? [])]) {
    const f = familyOfItem(it);
    const a = m.get(f) ?? { n: 0, titles: [], units: new Map() };
    a.n++;
    if (it.name && a.titles.length < 3) a.titles.push(it.name);
    const fig = parseFigure(it.figure);
    if (fig) a.units.set(fig.unit, [...(a.units.get(fig.unit) ?? []), fig.value]);
    m.set(f, a);
  }
  return m;
}

/** Roll an edition up by loop family. `prev` (the preceding edition) is optional: with it each
 *  row gains an honest direction; without it none is shown, rather than a fabricated "flat". */
export function buildDemandTracker(
  payload?: BriefPayload | null,
  prev?: { payload?: BriefPayload | null; editionDate: string } | null,
): BriefDemandTracker {
  const before = prev ? fold(prev.payload) : null;
  const rows: BriefFamilyRow[] = [...fold(payload).entries()].map(([family, a]) => {
    const row: BriefFamilyRow = { family, signals: a.n, titles: a.titles };
    // Dominant count unit wins; mixed units never merge into one bogus total.
    const best = [...a.units.entries()].sort(
      (x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]),
    )[0];
    if (best)
      row.magnitude = {
        value: best[1].reduce((s, v) => s + v, 0),
        unit: best[0],
        sampled: best[1].length,
      };
    if (before) row.direction = dir(a.n, before.get(family)?.n ?? 0);
    return row;
  });
  // Classified families first (busiest first); the unclassified bucket sorts last but stays.
  const unplaced = (r: BriefFamilyRow) => (r.family === null ? 1 : 0);
  rows.sort(
    (a, b) =>
      unplaced(a) - unplaced(b) ||
      b.signals - a.signals ||
      String(a.family).localeCompare(String(b.family)),
  );
  const t: BriefDemandTracker = {
    rows,
    tagged: rows.filter((r) => r.family !== null).reduce((s, r) => s + r.signals, 0),
    total: rows.reduce((s, r) => s + r.signals, 0),
  };
  if (prev) t.comparedTo = prev.editionDate;
  return t;
}
