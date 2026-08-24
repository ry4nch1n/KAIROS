// Brief → loop-family demand tracker (#12, part (a)). The News Brief was prose disconnected from
// the tables; this tags each item-shaped signal through the curated map (data/loopFamilyMap.ts)
// and folds them into per-family counts. Discipline inherited from that map: an item it cannot
// place stays UNCLASSIFIED, never force-fit. Same for magnitude — only same-unit COUNT figures
// ("12k wishlists") add up, and a family with no parseable figure carries none, not a placeholder.
import type { BriefDemandTracker, BriefFamilyRow, BriefNotable, BriefPayload } from "shared";
import { loopFamilyFor, loopFamilyFromLabels } from "../data/loopFamilyMap.ts";
import type { Querier } from "../db/db.ts";
import { canonSql } from "./shared.ts";

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

// ── appid tier (#163) ─────────────────────────────────────────────────────────────────────────
// String matching has a ceiling no vocabulary can raise: a patch note never names its genre
// ("Beta patch v0.110.0 reverts the Silent/Poison rework" is Slay the Spire 2, the canonical
// deckbuilder). The item carries `steam_appid` and KAIROS already crawls genre + tags for every
// appid, so the third tier is a LOOKUP against data we own. → docs/decisions/2026-08-24-…
/** One appid's crawled taxonomy: its canonical genre plus every tag we hold for it. */
export type SteamTaxonomy = { genre: string | null; tags: string[] };
export type SteamTaxonomyMap = ReadonlyMap<string, SteamTaxonomy>;

// An appid is the crawler's `source_game_id` on the steam source — digits. This is also the
// parameter-sanitising step: anything else never reaches the query.
const appidOf = (it: BriefNotable): string | null => {
  const s = String(it.steam_appid ?? "").trim();
  return /^\d+$/.test(s) ? s : null;
};

// A game has ONE genre but MANY tags while `loopFamilyFor` takes one tag: run every tag under the
// map's own ambiguity guard — exactly one family wins, disagreement is null, never a coin-flip.
// Then a second read over the TAGS ALONE, which carries the headline case: the crawler stores
// Steam's FIRST store genre, and for most indies that is "Indie"/"Strategy"/"Action", which the
// map omits as too broad to imply a loop. Slay the Spire 2 is exactly that shape (Strategy +
// Deckbuilding), so a genre-only read would ship a tier that fixes nothing. Crawled tags ARE the
// game's own labels, so they run through the labels tier's own vocabulary and guard.
const familyOfTaxonomy = (t?: SteamTaxonomy): string | null => {
  if (!t) return null;
  if (t.genre) {
    if (!t.tags.length) return loopFamilyFor(t.genre);
    const hits = new Set<string>();
    for (const tag of t.tags) {
      const f = loopFamilyFor(t.genre, tag);
      if (f) hits.add(f);
    }
    if (hits.size === 1) return [...hits][0];
    if (hits.size > 1) return null; // a curated genre whose tags disagree makes NO claim
  }
  return t.tags.length ? loopFamilyFromLabels(t.tags) : null;
};

// Item-shaped lists naming a concrete game; tooling/market aren't.
const itemsOf = (p?: BriefPayload | null): BriefNotable[] => [
  ...(p?.new_notable ?? []),
  ...(p?.browser ?? []),
];

const MAX_APPIDS = 200; // bounds the generated placeholder list; editions run ~12 items

/** One query per edition read: every appid across the editions being folded → its crawled genre
 *  and tags. Batched — a per-item lookup would turn one tracker into N round trips. Pass the
 *  current AND previous payloads: fold them by different rules and the direction is a fiction. */
export async function fetchSteamTaxonomy(
  db: Querier,
  payloads: (BriefPayload | null | undefined)[],
): Promise<SteamTaxonomyMap> {
  const ids = [
    ...new Set(payloads.flatMap((p) => itemsOf(p).map(appidOf).filter(Boolean) as string[])),
  ].slice(0, MAX_APPIDS);
  const out = new Map<string, SteamTaxonomy>();
  if (!ids.length) return out;
  const ph = ids.map((_, i) => `$${i + 1}`).join(",");
  // Canonicalised by the same SQL the market read uses, so "Simulation Games" and "Simulation"
  // resolve identically here and there. LEFT JOINs: a game with no tags or no snapshot yet still
  // returns its row. No `is_live` filter — this asks what a title IS, not whether it is listed.
  const rows = await db.query(
    `SELECT g.source_game_id AS appid, ${canonSql("l.genre")} AS genre, ${canonSql("t.name")} AS tag
     FROM games g
     JOIN sources src ON src.id = g.source_id
     LEFT JOIN v_latest l ON l.game_id = g.id
     LEFT JOIN game_tags gt ON gt.game_id = g.id
     LEFT JOIN tags t ON t.id = gt.tag_id
     WHERE src.name = 'steam' AND g.source_game_id IN (${ph})
     ORDER BY g.source_game_id, tag`,
    ids,
  );
  for (const r of rows) {
    const e = out.get(r.appid) ?? { genre: null, tags: [] };
    if (r.genre) e.genre = r.genre;
    if (r.tag) e.tags.push(r.tag);
    out.set(r.appid, e);
  }
  return out;
}

// Family of one item: LABEL fields first, then the blurb, then the crawled taxonomy behind its
// steam_appid. Labels keep precedence, but in this payload they are an editorial role ("Loop
// reference", "Browser platform"), not a genre — so a label-only read placed 0 of 12 signals on
// 2026-08-04 while every genre sat in the blurb. `relevance` stays out: it argues why an item
// matters to the plan, which is commentary.
// The appid tier runs LAST (#163): it is the most structural of the three, but it only differs
// from prose where the two DISAGREE, so last adds cases without silently re-deciding any.
// The platform-note guard stays prose-only — it stops a chart summary's PROSE being mined for a
// genre, and an appid is the item's own identity, not mined text.
export const familyOfItem = (it: BriefNotable, taxonomy?: SteamTaxonomyMap): string | null => {
  const fromText = loopFamilyFromLabels(
    [it.name, it.category, it.kind],
    isPlatformNote(it) ? undefined : [it.blurb],
  );
  if (fromText) return fromText;
  const id = appidOf(it);
  return id && taxonomy ? familyOfTaxonomy(taxonomy.get(id)) : null;
};

const dir = (n: number, p: number) => (n > p ? "up" : n < p ? "down" : "flat");
type Acc = { n: number; titles: string[]; units: Map<string, number[]> };
/** Coverage of the appid tier for one edition: it only pays where the crawl reaches (#163). */
export type AppidCoverage = { items: number; withAppid: number; crawled: number; placed: number };
function fold(
  payload?: BriefPayload | null,
  taxonomy?: SteamTaxonomyMap,
): { rows: Map<string | null, Acc>; coverage: AppidCoverage } {
  const m = new Map<string | null, Acc>();
  const coverage: AppidCoverage = { items: 0, withAppid: 0, crawled: 0, placed: 0 };
  for (const it of itemsOf(payload)) {
    const f = familyOfItem(it, taxonomy);
    coverage.items++;
    const id = appidOf(it);
    if (id) {
      coverage.withAppid++;
      const t = taxonomy?.get(id);
      if (t) coverage.crawled++;
      // "placed" counts only what the tier ADDED: an item the earlier tiers left unclassified.
      if (t && f && !familyOfItem(it)) coverage.placed++;
    }
    const a = m.get(f) ?? { n: 0, titles: [], units: new Map() };
    a.n++;
    if (it.name && a.titles.length < 3) a.titles.push(it.name);
    const fig = parseFigure(it.figure);
    if (fig) a.units.set(fig.unit, [...(a.units.get(fig.unit) ?? []), fig.value]);
    m.set(f, a);
  }
  return { rows: m, coverage };
}

/** Roll an edition up by loop family. `prev` (the preceding edition) is optional: with it each
 *  row gains an honest direction; without it none is shown, rather than a fabricated "flat".
 *  `taxonomy` (from `fetchSteamTaxonomy`) enables the appid tier; without it the fold degrades
 *  to labels → prose exactly as before, which is what keeps this callable from a pure test. */
export function buildDemandTracker(
  payload?: BriefPayload | null,
  prev?: { payload?: BriefPayload | null; editionDate: string } | null,
  taxonomy?: SteamTaxonomyMap,
): BriefDemandTracker {
  const before = prev ? fold(prev.payload, taxonomy).rows : null;
  const current = fold(payload, taxonomy);
  if (taxonomy && current.coverage.withAppid) {
    const c = current.coverage;
    // Measured every run rather than assumed: the tier is only as good as crawl coverage.
    console.log(
      `[brief-family] appid tier: ${c.withAppid}/${c.items} items carried a steam_appid, ` +
        `${c.crawled} matched a crawled game, ${c.placed} newly placed`,
    );
  }
  const rows: BriefFamilyRow[] = [...current.rows.entries()].map(([family, a]) => {
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
