// Cross-cutting analytics helpers + constants shared by more than one query domain
// (browser.ts + steam.ts). Split out of the former monolithic index.ts (issue #33,
// pure code movement) so browser and steam can share these without importing each
// other (which would be a circular import).
import type { Querier } from "../db/db.ts";
import type {
  Platform,
  ScoreComponents,
  SteeringLens,
  SteeringMatch,
  SupplyTrend,
  Trajectory,
} from "shared";
import { loopFamilyFor, loopFamilyFromLabels } from "../data/loopFamilyMap.ts";

export const num = (v: any) => (v === null || v === undefined ? 0 : Number(v));

export function pf(platform: Platform): string {
  if (platform === "poki") return "AND src.name = 'poki'";
  if (platform === "crazygames") return "AND src.name = 'crazygames'";
  if (platform === "steam") return "AND src.name = 'steam'";
  // "all" = all BROWSER platforms only. Steam is an asymmetric surface (its own view,
  // different metric semantics + crawl cadence) and must never feed browser analytics —
  // mixing it corrupts vote-velocity/momentum via cross-source date misalignment.
  return "AND src.name IN ('poki','crazygames')";
}

// Canonical genre / tag name (#7, #15). Portals list one category under both a bare name
// and a "… Games" variant — "Simulation" vs "Simulation Games", "Puzzle" vs "Puzzle
// Games", "Mouse" vs "Mouse Games" — which fragments a single market into several thin,
// duplicate gaps and recommends the same viral outliers under many labels. A trailing
// " Game"/" Games" is catalog packaging, not a distinct category, so collapse it (and any
// doubled internal whitespace). It is deliberately IDENTITY on already-clean names, so it
// never alters correct data. It MUST run in SQL before GROUP BY — medians/percentiles
// can't be merged after aggregation — which is exactly what canonSql() is for; the JS twin
// backs display + tests, and a parity test pins the two implementations together.
const CANON_SUFFIX = /^(.+\S)\s+games?$/i;
export function canonicalName(name: string): string {
  return String(name).replace(CANON_SUFFIX, "$1").replace(/\s+/g, " ").trim();
}
/** SQL expression form of canonicalName(col) — mirror of the JS twin (parity-tested). */
export function canonSql(col: string): string {
  return `trim(regexp_replace(regexp_replace(${col}, '^(.+\\S)\\s+games?$', '\\1', 'i'), '\\s+', ' ', 'g'))`;
}

// Platform curation / brand / device labels — how a portal merchandises its catalog
// (Popular, New, Trending) or brands itself (CrazyGames, Poki), or a device bucket
// (Mobile) — NOT gameplay genres. A Market Gap built on one is an artifact of the tag
// taxonomy, not a real market opening (#14), so these are denied before gaps are scored.
const CURATION_TAGS = new Set([
  "popular",
  "new",
  "trending",
  "hot",
  "featured",
  "crazygames",
  "crazy",
  "poki",
  "mobile",
  "fun",
]);
/** True if a tag is a platform-curation / brand / non-gameplay label rather than a genre. */
export function isCurationTag(name: string): boolean {
  const n = String(name).toLowerCase().trim().replace(/\s+/g, " ");
  return CURATION_TAGS.has(n) || CURATION_TAGS.has(n.replace(/\s*games?$/, "").trim());
}

/**
 * The reported rate, at two decimals with a 0.01 floor under any real gain (#192).
 * Integer rounding erased this axis for the whole Hidden Gems cohort: low votes is that
 * panel's SELECTION criterion, so its members gain fractions of a vote per day, and 28 of
 * 30 live rows read `0` — four of them beside a `rising` chip. The floor is what makes that
 * contradiction unrepresentable rather than merely unlikely: a series that gained anything
 * reports something, so a positive trajectory can never sit next to a zero rate. High-traffic
 * callers are untouched in practice — New Releases moves thousands of votes/day, and the
 * renderer prints anything >= 100 as a whole number.
 */
function voteRate(raw: number): number {
  if (!(raw > 0)) return 0;
  return Math.max(0.01, Math.round(raw * 100) / 100);
}

/**
 * Age-adjusted momentum for one title from its vote time-series. Raw cumulative votes
 * can't tell a fresh rocket (167K votes in two weeks, still climbing) from a dead
 * evergreen (167K votes years ago, flat) — velocity can, and without a launch date:
 * a corpse gains ~0 votes/day now, a rocket gains thousands. Trajectory compares the
 * later half of the window to the earlier half so a title that spiked then stalled
 * reads "decaying", not "rising".
 */
export function classifyTrajectory(
  series: number[],
  daySpan: number,
): { votesPerDay: number; trajectory: Trajectory } {
  const pts = series.filter((v) => Number.isFinite(v));
  if (pts.length < 2 || daySpan <= 0) return { votesPerDay: 0, trajectory: "new" };
  const votesPerDay = voteRate((pts[pts.length - 1] - pts[0]) / daySpan);
  if (pts.length < 3) return { votesPerDay, trajectory: "plateau" };
  const mid = Math.floor(pts.length / 2);
  const early = (pts[mid] - pts[0]) / Math.max(1, mid);
  const late = (pts[pts.length - 1] - pts[mid]) / Math.max(1, pts.length - 1 - mid);
  let trajectory: Trajectory = "plateau";
  // "rising" needs the reported rate to agree with the half-over-half read (#192): a portal
  // recount can drop cumulative votes mid-window, which left `late > early` sitting beside a
  // net gain of zero — the chip and the number contradicting each other, by construction.
  if (late > early * 1.25 && late > 0 && votesPerDay > 0) trajectory = "rising";
  else if (late < early * 0.5) trajectory = "decaying";
  return { votesPerDay, trajectory };
}

// ── Supply velocity (B2 / R1.1 + R1.3) ──
// "Is this genre being flooded right now?" — the question the static supply count can't
// answer. We compare new entrants in two adjacent trailing windows (recent vs prior),
// anchored to the DATA's newest date rather than the wall clock so it's deterministic
// (same anchor pattern as getNewReleases). Browser uses first_seen_at (when we first saw
// a title); Steam uses release_date. A genre needs a real recent count to read "rising",
// so one straggler can't cry crowding.
const SUPPLY_MIN_RISING = 2;
export function classifySupply(recent: number, prior: number): SupplyTrend {
  if (recent + prior === 0) return "quiet";
  if (recent >= SUPPLY_MIN_RISING && recent > prior * 1.5) return "rising";
  if (recent < prior * 0.5) return "cooling";
  return "steady";
}

export interface SupplyInfo {
  recent: number;
  prior: number;
  trend: SupplyTrend;
}
/** Per-canonical-genre new-entrant counts over the trailing window + the prior window. */
export async function genreSupplyTrend(
  db: Querier,
  platform: Platform,
  windowDays = 30,
): Promise<Map<string, SupplyInfo>> {
  // Steam dates releases; browser portals don't, so first_seen_at is the best entrant proxy.
  const col = platform === "steam" ? "release_date" : "first_seen_at";
  const w = `($1::int::text || ' days')::interval`; // trailing window
  const w2 = `(($1::int * 2)::text || ' days')::interval`; // window + the prior window
  const rows = await db.query(
    `WITH anchor AS (SELECT max(g2.${col}) AS mx FROM games g2 JOIN sources src ON src.id = g2.source_id WHERE g2.is_live ${pf(platform)})
     SELECT ${canonSql("l.genre")} AS genre,
            count(*) FILTER (WHERE g.${col} > (SELECT mx FROM anchor) - ${w})::int AS recent,
            count(*) FILTER (WHERE g.${col} <= (SELECT mx FROM anchor) - ${w}
                              AND g.${col} >  (SELECT mx FROM anchor) - ${w2})::int AS prior
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL AND g.${col} IS NOT NULL ${pf(platform)}
     GROUP BY ${canonSql("l.genre")}`,
    [windowDays],
  );
  const m = new Map<string, SupplyInfo>();
  for (const r of rows) {
    const recent = num(r.recent),
      prior = num(r.prior);
    m.set(r.genre, { recent, prior, trend: classifySupply(recent, prior) });
  }
  return m;
}

// ── Steering (#12, part (b)) ────────────────────────────────────────────────────────────
// The "Standing Flags" were a caption: the brief said what you were looking for and the
// rankings ignored it. Here they become a term in the opportunity score — matched through the
// curated loop-family map (so "survivors" reaches Action × Survivor-Like without naming it) or
// as a whole word in the market's labels. Discipline from data/loopFamilyMap.ts: a flag that
// fits nothing matches nothing; with no flags set the ranking is unchanged.
/** Fallback score per matching flag — used only when a ranking gives nothing to scale against
 *  (fewer than two candidates, or every candidate tied). The pre-#200 absolute constant. */
export const STEERING_WEIGHT = 0.5;

// ── Relative weight (#200) ──
// 0.5 was one absolute constant over two rankings with different natural scales: browser gap
// scores run 7.5–10.5, Steam's 3.8–5.8. Measured live 2026-09-04 with 11 flags ticked it lifted
// 99 markets across the two panels and moved NONE into view — the six shown browser rows span
// 3.08 points by themselves, so +0.5 could not cross one rank gap inside the visible band, let
// alone the ten ranks its best match needed. The lift is now a fraction of each ranking's OWN
// visible band (topScore − cutoffScore), so one setting means the same thing on both surfaces.
/** Per matching flag: half the visible band — enough to reorder comparable markets. */
export const STEERING_SPREAD_K = 0.5;
/** Ceiling on one row's total lift: one whole visible band, so a third matching flag adds nothing.
 *  Load-bearing invariant — a row below the cut scores at most `cutoff`, and `cutoff + spread =
 *  topScore`, so steering can reorder the shown band but never crown a leader over the one the
 *  market data itself put first. */
export const STEERING_MAX_LIFT_K = 1;
// ── The candidate band is a SCORE band, not a rank one ──
// Measured on the #209 draft: the ranks #200 quoted were POST-lift ranks. Unsteered, the best
// browser match sits at rank 20 of 200+ and the best Steam one at rank 61 of 100+ — and ranks 22
// to 61 on Steam span barely 1.0 point. Below the cut both rankings are almost FLAT, so rank
// distance stops measuring comparability and score distance is the only thing that does: a
// top-3×N rank rail excluded exactly the two markets the issue was filed about while admitting
// nothing. So the cap IS the band — a row is eligible when its own score is within one maximum
// lift of the cut. Everything below could not have reached the list anyway, and the bound states
// itself: the weakest admissible market can at best TIE the last shown row, so a lift promotes a
// market only as far as the seat it was already within reach of. Rows outside the band still
// RECORD their match at `delta: 0`, so `applied`/`steered`/`unlisted` stay the honest evidence
// that the lens ran.

export interface SteeringScale {
  weight: number; // score per matching flag, for this ranking
  maxLift: number; // ceiling on one row's total lift
  floor: number; // lowest unsteered score a lift can still reach the cut from
}

/** The scale for ONE ranking, from its own UNSTEERED scores (descending) and its displayed cut. */
export function steeringScale(baseDesc: number[], shownCount: number): SteeringScale {
  const cut = Math.min(Math.max(shownCount, 2), baseDesc.length);
  const spread = cut >= 2 ? baseDesc[0] - baseDesc[cut - 1] : 0;
  const cutoff = baseDesc[cut - 1] ?? Number.NEGATIVE_INFINITY;
  const maxLift = spread > 0 ? +(STEERING_MAX_LIFT_K * spread).toFixed(2) : STEERING_WEIGHT * 2;
  return {
    weight: spread > 0 ? +(STEERING_SPREAD_K * spread).toFixed(2) : STEERING_WEIGHT,
    maxLift,
    floor: +(cutoff - maxLift).toFixed(2),
  };
}

export interface Steerable {
  genre: string;
  tag: string;
  score: number;
  components: ScoreComponents;
  steering?: SteeringMatch;
}

// Too generic to carry an interest; a flag with no significant word matches by family only.
// `like`/`lite` are here as SUFFIXES, not interests: standing alone they are the tail of a
// compound genre ("Survivor-Like", "Rogue-lite"), so left in the vocabulary they would let any
// "-like" flag claim any "-like" market. The compound forms below still see them.
const STOP = new Set([
  "game",
  "games",
  "the",
  "and",
  "for",
  "with",
  "new",
  "more",
  "very",
  "like",
  "likes",
  "lite",
  "lites",
  // Every game has players; "Player" in a Steam tag is a player-count/mode label ("4 Player
  // Local", "Single-player"), never the interest a flag is expressing (#173). Stopped for the
  // same reason as "game" — and, like the tails above, the compound forms below still see it,
  // so a "Single-player" flag still reaches a "Singleplayer" market.
  "player",
  "players",
  // #195's four entries — "playing", "building", "running", "going" — are GONE (#212). They were
  // one token each of a family the head-noun rule below now covers structurally: `Can't stop
  // playing` narrows `playing` with `stop`, exactly as `City Builder` narrows `builder` with
  // `city`. Stopping the token was also the wrong shape of fix — it had to be dropped from the
  // flag too, and the very next over-reach arrived on `builder`, the neighbour of the `building`
  // that had just been stopped. What stays here is only what NO qualifier rule can reach: words
  // that are noise wherever they stand, in any position, on either side.
]);
const rawWords = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
/** A token that can carry an interest at all: long enough to mean something, not stoplisted. */
const significant = (w: string) => w.length >= 4 && !STOP.has(w);
const wordsOf = (s: string) => rawWords(s).filter(significant);
/** Tokens a label states PLAINLY — every token of a field except one standing immediately behind
 *  a significant token, which is a narrowed head, not a plain statement (#212). Unfiltered by
 *  length, because this is the market's side of a whole-word test: a flag word "RPGs" must still
 *  reach a three-letter `RPG`. */
const freeTokensOf = (s: string) => {
  const raw = rawWords(s);
  return new Set(raw.filter((_, i) => i === 0 || !significant(raw[i - 1])));
};

// ── Collapsed vocabulary (#157) ──
// The word matcher below splits on every non-alphanumeric, so a standing flag reaches the market
// as separate tokens — "Luck/deck builder synergy games" → [luck, deck, builder, synergy]. Steam
// writes those same genres CLOSED, as one token with no internal separator ("Deckbuilding",
// "Roguelike"), which no whole-word test can ever reach. That is why all ten live flags read
// `unmatched` on 2026-08-14 while `Deckbuilding` (4 games), `Card Battler` (3) and `Roguelike`
// (16, supply rising) sat in the data. So each side also offers its CLOSED forms: adjacent words
// joined, then stemmed to one comparison form. Matching stays whole-token EQUALITY, never a
// substring — a collapsed `includes` would force-fit "card" into "Cardboard", and the no-claim
// contract in steerRow is exactly what must survive this widening.

/** Drop a suffix only when a real word is left. Without the floor, "sing" stems to "s" and
 *  collides with everything; both sides run the same function, so only cross-word collisions
 *  matter and short stems are where they live. */
const strip = (t: string, re: RegExp) => {
  const s = t.replace(re, "");
  return s.length >= 4 ? s : t;
};
/** Plural off, then the builder/building suffix pair — how "deck builder" reaches "Deckbuilding". */
const stem = (t: string) => strip(strip(t, /s$/), /(?:ing|er)$/);
/** Surface-form folds for the spellings the two sides genuinely differ on. Explicit and auditable,
 *  in the discipline of data/loopFamilyMap.ts's SYNONYMS — never a guessed stem. Safe because both
 *  sides fold identically, and the bare tails ("like", "lite") are stopped out above, so the fold
 *  only ever meets a compound. */
const VARIANTS: [RegExp, string][] = [
  // Steam's tag is "Roguelike"; the flag says "Rogue-lites". `?tag=Roguelite` returns zero rows,
  // so without this fold the largest matching market (16 games) stays unmatched forever.
  [/lite$/, "like"],
];
const fold = (t: string) => VARIANTS.reduce((s, [re, to]) => s.replace(re, to), t);
// ── Qualifier discipline (#173) ──
// A stem is only trustworthy when the token it came from carried its own qualifier. "deck
// builder" → `deckbuild` does; a bare "builder" → `build` does not, and `build` is common enough
// in Steam's tag vocabulary that the flag then claimed every Base-Building market — as `players`
// → `play` claimed Free to Play. That is a force-fit, exactly what steerRow promises not to do.
// So the three kinds of form are kept apart rather than poured into one set: a word as written
// and a joined pair each carry their qualifier and may meet anything, while a root left by
// stemming a SINGLE word may only meet a joined pair — the closed compound it was invented to
// reach. `deckbuild` (pair) still finds `Deckbuilding` (word, stemmed); `build` no longer finds
// `Building`. Structural, so there is no list of generic roots for anyone to maintain.
// ── Head-noun discipline (#212) ──
// The rule above splits a token's FORMS apart; this one splits its POSITION apart, and it is the
// general form of #173, #195 and #212 — three over-reaches where flag and market shared a token
// that denoted different things on each side. `builder` is significant in both "deck builder" and
// "City Builder" by any frequency measure, so no stoplist can separate them: the entry that
// catches "City Builder" also breaks the match the flag exists to make. What separates them is
// position. A market that writes "City Builder" is telling you it is a CITY-building market; the
// bare head it shares with a deck-builder flag is the generic tail of its own compound, not a
// statement about itself. So: THE MARKET'S OWN QUALIFIER IS AUTHORITATIVE. A flag may claim a
// market through a token the market states plainly (nothing significant in front of it) or
// through a closed compound both sides write — never through a head the market has already
// narrowed with a qualifier of its own.
//
// It is deliberately one-sided. A flag's head may still carry a claim: "playing card mechanics"
// reaches a market whose tag is simply `Card`, because THAT market states `card` plainly. Making
// the rule symmetric would kill that live, correctly-steered market — and applying it to the
// market alone is what lets #195's whole stoplist family retire, since "Can't stop playing"
// narrows `playing` with `stop` in exactly the way "City Builder" narrows `builder`.
interface Forms {
  /** Significant words the label states PLAINLY (folded): first in their field, or behind a token
   *  too generic to narrow them. Either side may claim through these. */
  free: Set<string>;
  /** Significant words a qualifier already narrowed — the head of a compound. Offered from the
   *  FLAG's side only; a market's own head never carries a claim (#212). */
  head: Set<string>;
  /** Adjacent words joined then stemmed: the closed compound the other side may write as one. */
  compound: Set<string>;
  /** What stemming left of a single word, when it changed it. Generic by construction. */
  root: Set<string>;
}
const keep = (into: Set<string>, f: string) => {
  if (f.length >= 4) into.add(f);
};
/** Comparison forms of ONE label. Called per field, because the genre and the tag are separate
 *  claims: "Action" × "Deckbuilding" must never yield "actiondeck" — and, since #212, because a
 *  genre never qualifies the first word of its tag. */
const formsOf = (s: string): Forms => {
  const forms: Forms = { free: new Set(), head: new Set(), compound: new Set(), root: new Set() };
  const raw = rawWords(s);
  raw.forEach((w, i) => {
    if (!significant(w)) return;
    const plain = fold(w);
    keep(i > 0 && significant(raw[i - 1]) ? forms.head : forms.free, plain);
    const root = fold(stem(w));
    if (root !== plain) keep(forms.root, root);
  });
  for (let i = 0; i + 1 < raw.length; i++) keep(forms.compound, fold(stem(raw[i] + raw[i + 1])));
  return forms;
};
const mergeForms = (a: Forms, b: Forms): Forms => ({
  free: new Set([...a.free, ...b.free]),
  head: new Set([...a.head, ...b.head]),
  compound: new Set([...a.compound, ...b.compound]),
  root: new Set([...a.root, ...b.root]),
});
const shares = (a: Set<string>, b: Set<string>) => [...a].some((f) => b.has(f));
/** Whole-token EQUALITY on a shared comparison form, never a substring — with a stemmed root
 *  admitted only against the other side's compounds (#173), and the MARKET side offering only
 *  what it states plainly, never a head it has qualified itself (#212). */
const formsMatch = (flag: Forms, market: Forms) =>
  shares(
    new Set([...flag.free, ...flag.head, ...flag.compound]),
    new Set([...market.free, ...market.compound]),
  ) ||
  shares(flag.root, market.compound) ||
  shares(flag.compound, market.root);

export const activeFlags = (flags: string[]) =>
  (flags ?? []).filter((f) => typeof f === "string" && f.trim());

/** Flags (verbatim) that match this market. Whole-word, plural-tolerant on the market's own
 *  genre/tag labels, the same match on both sides' CLOSED compound forms, plus the loop-family
 *  route when BOTH sides resolve to the same family. The closed route is not a nicety: the family
 *  route only fires when the market resolves to exactly one family, so `Puzzle × Deckbuilding`
 *  matched nothing (the genre-level family outvoted the tag) even though the vocabulary was there. */
export function matchSteering(flags: string[], m: { genre: string; tag: string }): string[] {
  // The whole-word route reads the market's PLAIN tokens, not a flat haystack of its label: a
  // head the market has qualified itself is not something the market says about itself (#212).
  const plain = new Set([...freeTokensOf(m.genre), ...freeTokensOf(m.tag)]);
  const marketForms = mergeForms(formsOf(m.genre), formsOf(m.tag));
  const family = loopFamilyFor(m.genre, m.tag) ?? loopFamilyFromLabels([m.genre, m.tag]);
  const out: string[] = [];
  for (const flag of flags) {
    if (typeof flag !== "string" || !flag.trim()) continue;
    const byWord = wordsOf(flag).some(
      (w) => plain.has(w) || plain.has(`${w}s`) || plain.has(w.replace(/s$/, "")),
    );
    const byForm = formsMatch(formsOf(flag), marketForms);
    const byFamily = family != null && loopFamilyFromLabels([flag]) === family;
    if ((byWord || byForm || byFamily) && !out.includes(flag)) out.push(flag);
  }
  return out;
}

/** Re-score ONE ranked market. A no-op when nothing matches (or nothing is set): score,
 *  components and keys stay exactly as the market data computed them. Slots into the ranking
 *  chain before its `.sort`, so a lift can push a market above the top-N cut. */
export function steerRow<T extends Steerable>(
  row: T,
  flags: string[],
  scale?: SteeringScale,
  eligible = true,
): T {
  const matched = matchSteering(activeFlags(flags), row);
  if (!matched.length) return row; // no claim, never force-fit
  // Outside the candidate band the match is still RECORDED, at delta 0 — the lens must keep
  // reporting it, and reporting it as a lift that did not happen is the honest reading (#200).
  const weight = scale?.weight ?? STEERING_WEIGHT;
  const cap = scale?.maxLift ?? Number.POSITIVE_INFINITY;
  const delta = eligible ? +Math.min(weight * matched.length, cap).toFixed(2) : 0;
  row.score = +(row.score + delta).toFixed(2);
  row.components = { ...row.components, steering: delta };
  row.steering = { flags: matched, delta };
  return row;
}

/** Steer a WHOLE ranking: sort on the market data, scale the weight to that ranking's own visible
 *  band, lift only the candidates inside the band, re-sort. Replaces the per-row `.map(steerRow)`
 *  both surfaces used — which could not see the spread it now scales against (#200). */
export function steerRanking<T extends Steerable>(
  rows: T[],
  flags: string[],
  shownCount: number,
): T[] {
  const base = [...rows].sort((a, b) => b.score - a.score);
  if (!activeFlags(flags).length) return base; // nothing steering → the market data's own order
  const scale = steeringScale(
    base.map((r) => r.score),
    shownCount,
  );
  base.forEach((r) => {
    steerRow(r, flags, scale, r.score >= scale.floor);
  });
  return base.sort((a, b) => b.score - a.score);
}

/** How many matched-but-below-the-cut markets the lens names. Enough to see the shape of what
 *  steering found off-list, bounded so the payload and the banner sentence stay small. */
export const STEERING_UNLISTED_CAP = 5;

/** What steering did to a ranking, for display. Undefined when no flags are set — the honest
 *  reading of "nothing is steering", not an empty lens implying an inert filter ran.
 *
 *  Read over the FULL ranked set, not the displayed cut (#167). `steerRow` lifts every candidate
 *  before the sort, so a market can match a flag, receive its lift, and still land below the
 *  top-N cut. Handed only the cut, the lens called that flag `unmatched` and reported
 *  `steered: 0` — the banner then told the reader "none of your standing flags matched", which
 *  is a market verdict ("your lane is empty") rather than the truth ("your lane matched, none
 *  of it cleared the cut"). Opposite decisions. So `applied` now means "this flag found a
 *  market", `steeredShown` carries the narrower "…and it reached the list", and `unlisted`
 *  names the near misses with their rank so the reader can go look.
 *
 *  `shownCount` defaults to the whole list: a caller that displays everything it ranks gets the
 *  same lens it always did. */
export function steeringLens(
  flags: string[],
  ranked: Steerable[],
  shownCount: number = ranked.length,
): SteeringLens | undefined {
  const active = activeFlags(flags);
  if (!active.length) return undefined;
  const steeredRows = ranked.filter((r) => r.steering);
  const hit = new Set(steeredRows.flatMap((r) => r.steering?.flags ?? []));
  const unlisted = ranked
    .map((r, i) => ({ r, rank: i + 1 }))
    .filter(({ r, rank }) => r.steering && rank > shownCount)
    .slice(0, STEERING_UNLISTED_CAP)
    .map(({ r, rank }) => ({
      label: `${r.genre} × ${r.tag}`,
      genre: r.genre,
      tag: r.tag,
      rank,
      delta: r.steering?.delta ?? 0,
      flags: r.steering?.flags ?? [],
    }));
  return {
    flags: active,
    applied: active.filter((f) => hit.has(f)),
    unmatched: active.filter((f) => !hit.has(f)),
    steered: steeredRows.length,
    steeredShown: ranked.slice(0, shownCount).filter((r) => r.steering).length,
    unlisted,
    // The per-flag weight this ranking actually used (#200). Recovered from the rows rather than
    // passed in: subtracting each row's own steering term gives back the unsteered scores the
    // scale was computed from, so the reported number can never drift from the applied one.
    weight: steeringScale(
      ranked.map((r) => +(r.score - (r.components.steering ?? 0)).toFixed(2)).sort((a, b) => b - a),
      shownCount,
    ).weight,
  };
}
