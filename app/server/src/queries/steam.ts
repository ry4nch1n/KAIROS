// Steam / PC analytics. Split out of the former monolithic index.ts (issue #33, pure
// code movement). Cross-cutting helpers live in ./shared.ts.
import type { Querier } from "../db/db.ts";
import type {
  Platform,
  Trajectory,
  QuadrantPoint,
  ScaleTierRow,
  SteamGenreEconomics,
  SteamTagEconomics,
  SteamTagLookup,
  SteamCohort,
  SteamComparable,
  SteamOverview,
  SteamGap,
  SteamPriceBand,
  SteamOwnershipRow,
  SteamDeveloperRow,
  SteamNewRelease,
} from "shared";
import { teamSizeFor } from "../data/teamSize.ts";
import { conversionFor } from "../data/genreConversion.ts";
import {
  num,
  pf,
  canonSql,
  isCurationTag,
  classifyTrajectory,
  classifySupply,
  genreSupplyTrend,
  steerRow,
  steeringLens,
  type SupplyInfo,
} from "./shared.ts";
import { getBriefSteering } from "./library.ts";

// ── Unreleased titles (#54 part 2) ──────────────────────────────────────────────────────
// The crawl now seeds Steam's "Popular Upcoming" shelf, because followers — a PRE-purchase
// signal — only carry information a review count doesn't for a game that has no reviews yet.
// Every analytic below describes RELEASED titles: medians of price/rating/owners, revenue
// proxies, supply trends, comparables. An unshipped title has no reviews, no owners and no
// release date, so mixing it in would drag every median toward zero and inflate every supply
// count with games that haven't competed for a customer yet.
//
// So: unreleased is EXCLUDED from all of them, at ingestion-honest cost — release_date stays
// NULL (never a faked or announced date), which already excludes it from the date-filtered
// queries (comparables, new releases, supply trends, the 90-day quiet-launch/AI-share KPIs);
// this predicate covers the ones that aggregate without a date filter. `IS NOT TRUE` is
// null-safe, so browser rows (which never measure it) are unaffected.
//
// Upcoming titles are therefore not yet SHOWN anywhere — deliberately. Excluding them is the
// honest half; a dedicated, clearly-labelled Upcoming surface (with follower velocity, which
// needs >=2 snapshots carrying `followers` before it can render anything but "—") is the
// follow-up. Absence is never a claim: no table implies "released" while holding one of these.
export const RELEASED_ONLY = "AND l.coming_soon IS NOT TRUE";

/** Pure composition — exported for tests. Steam flavor of the read. */
export function composeSteamRead(args: {
  opportunity: SteamGap[];
  indie: SteamGenreEconomics[];
}): string[] {
  const lines: string[] = [];
  const usdK = (d: number) =>
    d >= 1e6 ? "$" + (d / 1e6).toFixed(1) + "M" : "$" + Math.round(d / 1e3) + "K";
  const top = args.opportunity[0];
  if (top) {
    lines.push(
      `<b>${top.label}</b> is the top Steam opportunity — ${top.medianOwners.toLocaleString("en-US")} median owners across ${top.supplyN} games at $${(top.medianPriceCents / 100).toFixed(2)} median. → Premium-shaped demand: a Route 1 (demo-funnel) candidate.`,
    );
  }
  const econ = args.indie.filter((r) => r.games >= 3 && r.medianRevenuePerGame > 0);
  const best = [...econ].sort((a, b) => b.medianRevenuePerGame - a.medianRevenuePerGame)[0];
  if (best) {
    lines.push(
      `A typical <b>${best.genre}</b> indie shows the strongest per-game revenue proxy (median ${usdK(best.medianRevenuePerGame)}). → Benchmark against the median, not category totals.`,
    );
  }
  const topHeavy = [...econ]
    .filter((r) => r.medianRevenuePerGame > 0 && r.meanRevenuePerGame / r.medianRevenuePerGame >= 3)
    .sort(
      (a, b) =>
        b.meanRevenuePerGame / b.medianRevenuePerGame -
        a.meanRevenuePerGame / a.medianRevenuePerGame,
    )[0];
  lines.push(
    topHeavy
      ? `<b>${topHeavy.genre}</b> is top-heavy: mean rev/game ${usdK(topHeavy.meanRevenuePerGame)} vs median ${usdK(topHeavy.medianRevenuePerGame)}. → A few hits hold the pool — don't read the mean as your expected outcome.`
      : `No genre shows extreme hit-concentration in the indie cohort this window. → Medians here are a fair read of the typical outcome.`,
  );
  return lines;
}

// Steam flavor: appetite = median reviews, weight = revenue proxy (Σ owners × price, $).
// Demand is measured in reviews, not owners: owners_est is a SteamSpy owners-BUCKET midpoint
// (parseOwners), and the lowest bucket 0..20,000 collapses to a single value, 10,000. The median
// indie title in nearly every genre sits in that bucket, so a median-owners axis pinned every
// genre to 10,000 and the quadrant lost all discrimination. Reviews (l.votes) are continuous —
// the same signal the browser quadrant uses. Owners still drive the revenue-proxy bubble weight,
// where summing across a genre averages the bucket coarseness out.
export async function getSteamGenreQuadrant(db: Querier): Promise<QuadrantPoint[]> {
  const supply = await genreSupplyTrend(db, "steam");
  const rows = await db.query(
    `SELECT ${canonSql("l.genre")} AS genre, count(*)::int AS supply,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.votes)::float AS appetite,
            coalesce(sum(l.owners_est * l.price_cents), 0)::float AS weight_cents
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND l.genre IS NOT NULL AND l.owners_est IS NOT NULL
       AND l.votes IS NOT NULL
       AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa') ${RELEASED_ONLY}
     GROUP BY ${canonSql("l.genre")} HAVING count(*) >= 2`,
  );
  return rows.map((r) => ({
    genre: r.genre,
    supply: num(r.supply),
    appetite: Math.round(num(r.appetite)),
    weight: Math.round(num(r.weight_cents) / 100),
    supplyTrend: supply.get(r.genre)?.trend ?? "quiet",
  }));
}

// ── Phase 2: Steam / PC analytics ──

// Distribution of games across inferred market-scale tiers (hobby → aaa).
export async function getScaleTierBreakdown(
  db: Querier,
  platform: Platform,
): Promise<ScaleTierRow[]> {
  const rows = await db.query(
    `SELECT l.scale_tier AS tier, count(*)::int AS games
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.scale_tier IS NOT NULL ${pf(platform)} ${RELEASED_ONLY}
     GROUP BY l.scale_tier ORDER BY games DESC`,
  );
  return rows.map((r) => ({ tier: r.tier, games: num(r.games) }));
}

// ── Cross-estimate revenue band (#53) ──
// Every revenue figure here used to rest on ONE estimator: SteamSpy owners-bucket midpoint ×
// price. Those buckets are wide (the lowest collapses to 10,000) and degrading, so a single
// bad bucket silently skews genre medians with no visible uncertainty. The second estimator is
// the Boxleiter method: units ≈ review count × a multiplier. One documented constant, not
// per-genre magic numbers — the public review-to-sales ratio has drifted from ~50-60x in the
// early 2010s to roughly 30-50x in the modern era (Boxleiter/Galyonkin lineage; VG Insights'
// 2023-24 recalibrations sit in the low-to-mid 30s). 35 is the defensible middle of that range.
export const BOXLEITER_MULTIPLIER = 35;
// Past this ratio the two estimators are telling different stories; show the band, not a point.
export const ESTIMATOR_DISAGREE_RATIO = 3;

/** Sorted band + disagreement read over the two independent per-game revenue estimators. */
export function revenueBand(
  ownersBased: number,
  boxleiter: number,
): {
  revenueBandLowPerGame: number;
  revenueBandHighPerGame: number;
  estimatorRatio: number;
  estimatorsDisagree: boolean;
} {
  const low = Math.min(ownersBased, boxleiter);
  const high = Math.max(ownersBased, boxleiter);
  // A zero low means one estimator says "no revenue" — a ratio is undefined, not infinite.
  // Report ratio 0 and only call it a disagreement when the other side is non-zero.
  const ratio = low > 0 ? +(high / low).toFixed(2) : 0;
  return {
    revenueBandLowPerGame: low,
    revenueBandHighPerGame: high,
    estimatorRatio: ratio,
    estimatorsDisagree: low > 0 ? ratio > ESTIMATOR_DISAGREE_RATIO : high > 0,
  };
}

// SQL for the Boxleiter per-game revenue median, in cents (free/unrated games count as 0,
// matching the owners-based median's treatment — see #24).
const BOXLEITER_MED_SQL = `percentile_cont(0.5) WITHIN GROUP (
              ORDER BY coalesce(l.votes, 0)::float8 * ${BOXLEITER_MULTIPLIER} * coalesce(l.price_cents, 0)::float8)::float`;
// (float8 casts, not integers: a heavily reviewed AAA title × 35 × price in cents overflows int4.)

// Band fields shared by the store-genre and sub-genre (tag) economics rows — both lenses
// aggregate the same way, so the cross-estimate must be identical in both.
function econBandFields(medRevDollars: number, medRevBlCents: unknown) {
  const boxleiter = Math.round(num(medRevBlCents) / 100);
  return { medianRevenueBoxleiter: boxleiter, ...revenueBand(medRevDollars, boxleiter) };
}

// Per-genre economics for Steam, defaulting to the indie-addressable cohort
// (AAA excluded so its outliers don't distort the benchmark medians — see Phase 2 design).
export async function getSteamGenreEconomics(
  db: Querier,
  opts?: { cohort?: SteamCohort },
): Promise<SteamGenreEconomics[]> {
  const cohort = opts?.cohort ?? "indie";
  const tierFilter =
    cohort === "indie" ? "AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')" : "";
  const rows = await db.query(
    `SELECT ${canonSql("l.genre")} AS genre, count(*)::int AS games,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price_cents)::float AS med_price,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.rating)::float AS med_rating,
            coalesce(sum(l.owners_est), 0)::float AS total_owners,
            coalesce(sum(l.owners_est * l.price_cents), 0)::float AS rev_cents,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY coalesce(l.owners_est, 0) * coalesce(l.price_cents, 0))::float AS med_rev_cents,
            ${BOXLEITER_MED_SQL} AS med_rev_bl_cents
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND l.genre IS NOT NULL ${tierFilter} ${RELEASED_ONLY}
     GROUP BY ${canonSql("l.genre")} ORDER BY total_owners DESC`,
  );
  // Per-game reads (#24): free/unpriced games count as $0 in the median (coalesce above)
  // rather than being skipped — a genre of mostly-free games honestly medians near $0.
  return rows.map((r) => {
    const medRev = Math.round(num(r.med_rev_cents) / 100);
    return {
      genre: r.genre,
      games: num(r.games),
      medianPriceCents: Math.round(num(r.med_price)),
      medianRating: r.med_rating == null ? null : +Number(r.med_rating).toFixed(2),
      totalOwners: num(r.total_owners),
      revenueProxy: Math.round(num(r.rev_cents) / 100),
      medianRevenuePerGame: medRev,
      meanRevenuePerGame: num(r.games) ? Math.round(num(r.rev_cents) / 100 / num(r.games)) : 0,
      conversion: conversionFor(r.genre),
      ...econBandFields(medRev, r.med_rev_bl_cents),
    };
  });
}

// Sub-genre (tag) economics for Steam (#90). Store genres are coarse — Action / Indie /
// Strategy — so a real market like "Deckbuilding" or "Roguelike Deckbuilder" is scattered
// across several store buckets and can't be read as its own market. SteamSpy weighted tags
// are already crawled into tags/game_tags, so the same economics aggregate keyed on tag name
// gives a sub-genre lens for free. Tags overlap by design (a game carries many), so counts
// across rows deliberately do NOT sum to the catalog — each row is "the market of games
// carrying this tag". Demand is median REVIEWS, not median owners (#89): owners_est is a
// SteamSpy bucket midpoint whose lowest bucket collapses to 10,000 and flattens the axis.
const TAG_ECON_MIN_SUPPLY = 3; // below this a "market" is noise, not a market
const TAG_ECON_LIMIT = 30;
// Lookup guardrails (#113). The ranked list is a top-30 BY TOTAL revenue, so generic
// high-volume tags (Action, Singleplayer, 2D) own it and a niche-but-real market is
// structurally unreachable. `parseTagQuery` turns free user text into bounded, safe LIKE
// terms: length-capped, term-capped, wildcard-stripped (so `%` can't widen the match), and
// >= 2 chars so a one-letter query can't sweep the whole tag table.
const TAG_QUERY_MAX_LEN = 60;
const TAG_QUERY_MAX_TERMS = 5;
const TAG_QUERY_MIN_TERM = 2;
export function parseTagQuery(raw: unknown): string[] {
  if (raw == null) return [];
  const terms = String(raw)
    .slice(0, TAG_QUERY_MAX_LEN)
    .split(",")
    .map((t) =>
      t
        .replace(/[%_\\]/g, "") // LIKE metacharacters are not user syntax here
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase(),
    )
    .filter((t) => t.length >= TAG_QUERY_MIN_TERM);
  return [...new Set(terms)].slice(0, TAG_QUERY_MAX_TERMS);
}

export async function getSteamTagEconomics(
  db: Querier,
  opts?: { cohort?: SteamCohort; minSupply?: number; limit?: number; match?: string[] },
): Promise<SteamTagEconomics[]> {
  const cohort = opts?.cohort ?? "indie";
  const minSupply = opts?.minSupply ?? TAG_ECON_MIN_SUPPLY;
  const tierFilter =
    cohort === "indie" ? "AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')" : "";
  // Named-tag path: match the canonical tag name case-insensitively, as a substring, so a
  // user typing "deckbuild" reaches "Deckbuilding". Values are PARAMETERS ($1…$n) — never
  // interpolated — and the placeholder count comes from code, not from the input.
  const match = opts?.match ?? [];
  const params = match.map((t) => `%${t}%`);
  const matchFilter = match.length
    ? `AND (${match.map((_, i) => `lower(${canonSql("t.name")}) LIKE $${i + 1}`).join(" OR ")})`
    : "";
  const rows = await db.query(
    `SELECT ${canonSql("t.name")} AS tag, count(*)::int AS games,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price_cents)::float AS med_price,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.rating)::float AS med_rating,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(l.votes, 0))::float AS med_votes,
            coalesce(sum(l.owners_est), 0)::float AS total_owners,
            coalesce(sum(l.owners_est * l.price_cents), 0)::float AS rev_cents,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY coalesce(l.owners_est, 0) * coalesce(l.price_cents, 0))::float AS med_rev_cents,
            ${BOXLEITER_MED_SQL} AS med_rev_bl_cents
     FROM v_latest l
     JOIN games g ON g.id = l.game_id
     JOIN sources src ON src.id = g.source_id
     JOIN game_tags gt ON gt.game_id = g.id
     JOIN tags t ON t.id = gt.tag_id
     WHERE g.is_live AND src.name = 'steam' ${tierFilter} ${matchFilter} ${RELEASED_ONLY}
     GROUP BY ${canonSql("t.name")} HAVING count(*) >= ${Number(minSupply) | 0}
     ORDER BY rev_cents DESC`,
    params.length ? params : undefined,
  );
  // Momentum signals at tag grain (#114) — the same two the store-genre quadrant exposes, so a
  // sub-genre row reads identically to a store-genre row. Both are single set-based queries
  // scoped by the SAME cohort + name filters as the rows above, so the lookup path stays cheap
  // (only the matched tags are computed) and the ranked path computes over the indie cohort.
  const [supply, demand] = await Promise.all([
    tagSupplyTrend(db, tierFilter, matchFilter, params),
    tagDemandTrajectory(db, tierFilter, matchFilter, params),
  ]);
  return rows
    .filter((r) => !isCurationTag(r.tag))
    .slice(0, opts?.limit ?? TAG_ECON_LIMIT)
    .map((r) => {
      const medRev = Math.round(num(r.med_rev_cents) / 100);
      const sup = supply.get(r.tag);
      return {
        genre: r.tag, // same row shape as the store-genre table, keyed on the tag
        games: num(r.games),
        medianPriceCents: Math.round(num(r.med_price)),
        medianRating: r.med_rating == null ? null : +Number(r.med_rating).toFixed(2),
        medianVotes: Math.round(num(r.med_votes)),
        totalOwners: num(r.total_owners),
        revenueProxy: Math.round(num(r.rev_cents) / 100),
        medianRevenuePerGame: medRev,
        meanRevenuePerGame: num(r.games) ? Math.round(num(r.rev_cents) / 100 / num(r.games)) : 0,
        conversion: conversionFor(r.tag),
        // Supply is the load-bearing signal — it derives from release_date, present on every
        // crawled Steam title, so it reads immediately. Demand trajectory depends on snapshot
        // history accumulating; it stays "new" (honest, not a fake trend) until the series
        // deepens — the identical treatment the store-genre lens uses for thin history.
        supplyTrend: sup?.trend ?? "quiet",
        supplyRising: sup?.trend === "rising",
        demandTrajectory: demand.get(r.tag) ?? "new",
        ...econBandFields(medRev, r.med_rev_bl_cents),
      };
    });
}

// Per-tag new-entrant counts over the trailing window vs. the prior window (#114) — the same
// crowding signal `genreSupplyTrend` computes for store genres, re-keyed on SteamSpy tags via
// the game_tags join. One set-based query, window-bucketed by date arithmetic anchored to the
// data's newest release_date (clock-independent), NOT per-tag round-trips. Scoped by the caller's
// cohort (tierFilter) + name (matchFilter) so it stays aligned with the rows it annotates.
async function tagSupplyTrend(
  db: Querier,
  tierFilter: string,
  matchFilter: string,
  params: string[],
  windowDays = 30,
): Promise<Map<string, SupplyInfo>> {
  const p = params.length + 1; // window param sits after the match params ($1…$n)
  const w = `($${p}::int::text || ' days')::interval`;
  const w2 = `(($${p}::int * 2)::text || ' days')::interval`;
  const rows = await db.query(
    `WITH anchor AS (
        SELECT max(g2.release_date) AS mx FROM games g2
        JOIN sources s2 ON s2.id = g2.source_id
        WHERE g2.is_live AND s2.name = 'steam')
     SELECT ${canonSql("t.name")} AS tag,
            count(*) FILTER (WHERE g.release_date > (SELECT mx FROM anchor) - ${w})::int AS recent,
            count(*) FILTER (WHERE g.release_date <= (SELECT mx FROM anchor) - ${w}
                              AND g.release_date >  (SELECT mx FROM anchor) - ${w2})::int AS prior
     FROM v_latest l
     JOIN games g ON g.id = l.game_id
     JOIN sources src ON src.id = g.source_id
     JOIN game_tags gt ON gt.game_id = g.id
     JOIN tags t ON t.id = gt.tag_id
     WHERE g.is_live AND src.name = 'steam' AND g.release_date IS NOT NULL ${tierFilter} ${matchFilter}
     GROUP BY ${canonSql("t.name")}`,
    [...params, windowDays],
  );
  const m = new Map<string, SupplyInfo>();
  for (const r of rows) {
    const recent = num(r.recent),
      prior = num(r.prior);
    m.set(r.tag, { recent, prior, trend: classifySupply(recent, prior) });
  }
  return m;
}

// Per-tag demand trajectory (#114) — median REVIEWS across snapshot capture windows, reusing
// `classifyTrajectory` exactly as the genre lens does. Mirrors `genreVotesByDate` but keyed on
// tag (game_snapshots carries no tag, so it joins game_tags). Returns "new" for any tag whose
// series is too short to read (<2 captures) — the same honest insufficient-data state the genre
// lens surfaces, never a confident line drawn through two points.
async function tagDemandTrajectory(
  db: Querier,
  tierFilter: string,
  matchFilter: string,
  params: string[],
): Promise<Map<string, Trajectory>> {
  const rows = await db.query(
    `SELECT ${canonSql("t.name")} AS tag, s.captured_at AS d,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY s.votes) AS med
     FROM game_snapshots s
     JOIN games g ON g.id = s.game_id
     JOIN sources src ON src.id = g.source_id
     JOIN v_latest l ON l.game_id = g.id
     JOIN game_tags gt ON gt.game_id = g.id
     JOIN tags t ON t.id = gt.tag_id
     WHERE g.is_live AND src.name = 'steam' AND s.votes IS NOT NULL ${tierFilter} ${matchFilter} ${RELEASED_ONLY}
     GROUP BY ${canonSql("t.name")}, s.captured_at`,
    params.length ? params : undefined,
  );
  const times = [...new Set(rows.map((r) => new Date(r.d).getTime()))].sort((a, b) => a - b);
  const idx = new Map(times.map((t, i) => [t, i]));
  const daySpan = times.length > 1 ? (times[times.length - 1] - times[0]) / 86400000 : 0;
  const byTag: Record<string, number[]> = {};
  for (const r of rows) {
    const tag = r.tag as string;
    if (!byTag[tag]) byTag[tag] = new Array(times.length).fill(0);
    byTag[tag][idx.get(new Date(r.d).getTime())!] = num(r.med);
  }
  const m = new Map<string, Trajectory>();
  for (const tag of Object.keys(byTag)) {
    m.set(tag, classifyTrajectory(byTag[tag], daySpan).trajectory);
  }
  return m;
}

// Named sub-genre lookup (#113). The ranked lens can only ever show the 30 biggest tags by
// TOTAL revenue, which generic labels win by construction — so a specific market was not
// merely hard to find, it was unreachable. This path asks for tags BY NAME and bypasses the
// rank cut, while keeping the two quality floors identical to the ranked path: curation tags
// are still dropped, and the supply floor still applies. A match that exists but is too thin
// is reported as `thin` rather than silently missing — "2 titles, below the floor" is a real
// answer about a market; an empty list looks like a bug.
export async function getSteamTagLookup(
  db: Querier,
  rawQuery: unknown,
  opts?: { cohort?: SteamCohort; minSupply?: number; limit?: number },
): Promise<SteamTagLookup> {
  const terms = parseTagQuery(rawQuery);
  const minSupply = opts?.minSupply ?? TAG_ECON_MIN_SUPPLY;
  const limit = opts?.limit ?? TAG_ECON_LIMIT;
  const base = { query: terms.join(", "), minSupply, rows: [], thin: [] } as SteamTagLookup;
  if (!terms.length) return base;
  // One pass with the floor lowered to 1, then partition in JS — the floor still governs what
  // counts as a market, it just also lets us NAME the too-thin matches. Bounded by the term
  // cap and the fetch limit, so a broad query can't return the whole tag table.
  const all = await getSteamTagEconomics(db, {
    cohort: opts?.cohort,
    minSupply: 1,
    limit: limit * 2,
    match: terms,
  });
  return {
    ...base,
    rows: all.filter((r) => r.games >= minSupply).slice(0, limit),
    thin: all
      .filter((r) => r.games < minSupply)
      .slice(0, limit)
      .map((r) => ({ tag: r.genre, games: r.games })),
  };
}

// Indie-tier rated games — the realistic "comparables" peer set, focused on RECENT releases:
// a rolling ~2-year window (start of the current year minus 2 → 2024-01-01 today, keeping all
// of 2024 incl. Balatro; rolls forward automatically each year). Ordered newest first, with an
// owners floor so games shown still have real traction. Older classics are intentionally
// dropped here — the crawl seeds from indie TOP SELLERS so the recent set stays well populated.
const COMPARABLE_OWNERS_FLOOR = 20_000;
const COMPARABLE_RECENCY_YEARS = 2;

// Trailing window for the review-velocity leading indicator (#11). Owners/review totals
// lag a launch by months; reviews-per-day over recent snapshots is the standard public
// proxy for wishlist velocity (wishlist counts aren't publicly acquirable).
const REVIEW_VELOCITY_WINDOW_DAYS = 30;

/**
 * Δreviews/Δdays over the trailing window of one game's review-count series
 * (times ascending, votes aligned). null — never a misleading 0 — when the history
 * can't support a rate: <2 snapshots inside the window, or zero time span.
 * Review purges (negative deltas) clamp to 0.
 */
export function computeReviewVelocity(
  times: number[],
  votes: number[],
  windowDays = REVIEW_VELOCITY_WINDOW_DAYS,
): number | null {
  if (times.length < 2 || times.length !== votes.length) return null;
  const end = times[times.length - 1];
  const windowStart = end - windowDays * 86400000;
  let i = 0;
  while (i < times.length && times[i] < windowStart) i++;
  if (times.length - i < 2) return null;
  const spanDays = (end - times[i]) / 86400000;
  if (spanDays <= 0) return null;
  return +Math.max(0, (votes[votes.length - 1] - votes[i]) / spanDays).toFixed(1);
}

// Per-game review time-series for the given ids → reviewVelocity map (#11).
async function reviewVelocities(db: Querier, ids: number[]): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  if (!ids.length) return out;
  const ph = ids.map((_, i) => `$${i + 1}`).join(",");
  const series = await db.query(
    `SELECT game_id AS id, captured_at AS d, max(votes) AS votes
     FROM game_snapshots
     WHERE game_id IN (${ph}) AND votes IS NOT NULL
     GROUP BY game_id, captured_at
     ORDER BY game_id, captured_at`,
    ids,
  );
  const byId = new Map<number, { t: number[]; v: number[] }>();
  for (const r of series) {
    const id = num(r.id);
    let g = byId.get(id);
    if (!g) {
      g = { t: [], v: [] };
      byId.set(id, g);
    }
    g.t.push(new Date(r.d).getTime());
    g.v.push(num(r.votes));
  }
  for (const [id, g] of byId) out.set(id, computeReviewVelocity(g.t, g.v));
  return out;
}

// Team-size tie-break (#9). The comparables window is only the ~12–14 newest qualifying titles, so
// as the set rotates daily toward brand-new unknown studios, team-size coverage collapses to ~0 —
// not because the data is missing, but because the researched studios fell out of the window.
// Fix WITHOUT abandoning recency: bucket candidates into coarse recency BANDS (calendar quarters)
// and re-order only WITHIN a band. Bands sort newest-first, so a stale title can never leapfrog a
// fresher one from a newer band; a resolved team size only breaks ties among comparably-recent
// candidates. Remaining keys (owners desc, then id asc) make the order fully deterministic.
const COMPARABLE_BAND_POOL = 4; // candidates fetched per output slot, so a band's resolved rows are reachable

/** Coarse recency band (calendar quarter, newest sorts highest as a string). Null dates sort last. */
export function recencyBand(releaseDate: string | Date | null | undefined): string {
  if (!releaseDate) return "0000-Q0";
  const d = new Date(releaseDate);
  if (Number.isNaN(d.getTime())) return "0000-Q0";
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export async function getSteamComparables(db: Querier, limit = 12): Promise<SteamComparable[]> {
  const candidates = await db.query(
    `SELECT g.id AS id, g.title, l.scale_tier AS tier, ${canonSql("l.genre")} AS genre, l.rating, l.votes,
            l.owners_est AS owners, l.price_cents AS price, g.developer, g.release_date, l.ai_disclosure
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND l.rating IS NOT NULL
       AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
       AND coalesce(l.owners_est, 0) >= ${COMPARABLE_OWNERS_FLOOR}
       AND g.release_date >= (date_trunc('year', CURRENT_DATE) - INTERVAL '${COMPARABLE_RECENCY_YEARS} years')
     ORDER BY g.release_date DESC NULLS LAST, l.owners_est DESC NULLS LAST
     LIMIT $1`,
    [limit * COMPARABLE_BAND_POOL],
  );
  // teamSizeFor is a TS lookup (not SQL), so the tie-break has to run here, over a pool wider than
  // the output — hence the over-fetch above. Bands still gate everything: only intra-band order moves.
  const rows = candidates
    .slice()
    .sort((a, b) => {
      const band = recencyBand(b.release_date).localeCompare(recencyBand(a.release_date));
      if (band !== 0) return band;
      const resolved = (teamSizeFor(a.developer) ? 0 : 1) - (teamSizeFor(b.developer) ? 0 : 1);
      if (resolved !== 0) return resolved;
      const owners =
        (b.owners == null ? -1 : num(b.owners)) - (a.owners == null ? -1 : num(a.owners));
      if (owners !== 0) return owners;
      return num(a.id) - num(b.id);
    })
    .slice(0, limit);
  const velocities = await reviewVelocities(
    db,
    rows.map((r) => num(r.id)),
  );
  return rows.map((r) => {
    const ts = teamSizeFor(r.developer);
    return {
      title: r.title,
      tier: r.tier ?? "—",
      genre: r.genre ?? "—",
      rating: r.rating == null ? null : +Number(r.rating).toFixed(2),
      votes: r.votes == null ? null : num(r.votes),
      owners: r.owners == null ? null : num(r.owners),
      priceCents: r.price == null ? null : num(r.price),
      developer: r.developer ?? null,
      releaseDate:
        r.release_date == null ? null : new Date(r.release_date).toISOString().slice(0, 10),
      // Tri-state (#110): true = discloses AI content, false = checked & doesn't, null = not
      // checked (outside the gated recent-non-AAA fetch cohort) or the store-page fetch failed.
      aiDisclosure: r.ai_disclosure == null ? null : Boolean(r.ai_disclosure),
      teamSize: ts
        ? {
            bucket: ts.bucket,
            headcount: ts.headcount,
            source: ts.source,
            confidence: ts.confidence,
          }
        : null,
      reviewVelocity: velocities.get(num(r.id)) ?? null,
    };
  });
}

// Steam pricing: price-band breakdown over the indie cohort (how indies price + what each band is worth).
const PRICE_BANDS = ["Free", "<$5", "$5–10", "$10–20", "$20+"];
export async function getSteamPricing(db: Querier): Promise<SteamPriceBand[]> {
  const rows = await db.query(
    `SELECT CASE
              WHEN l.price_cents IS NULL OR l.price_cents = 0 THEN 'Free'
              WHEN l.price_cents < 500  THEN '<$5'
              WHEN l.price_cents < 1000 THEN '$5–10'
              WHEN l.price_cents < 2000 THEN '$10–20'
              ELSE '$20+'
            END AS band,
            count(*)::int AS games,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.rating)::float AS med_rating,
            coalesce(sum(l.owners_est), 0)::float AS total_owners,
            coalesce(sum(l.owners_est * l.price_cents), 0)::float AS rev_cents
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa') ${RELEASED_ONLY}
     GROUP BY band`,
  );
  const by = new Map(rows.map((r) => [r.band, r]));
  return PRICE_BANDS.filter((b) => by.has(b)).map((band) => {
    const r = by.get(band)!;
    return {
      band,
      games: num(r.games),
      medianRating: r.med_rating == null ? null : +Number(r.med_rating).toFixed(2),
      totalOwners: num(r.total_owners),
      revenueProxy: Math.round(num(r.rev_cents) / 100),
    };
  });
}

// Steam ownership/engagement by genre (indie cohort): market size + live CCU + playtime.
export async function getSteamOwnership(db: Querier): Promise<SteamOwnershipRow[]> {
  const rows = await db.query(
    `SELECT ${canonSql("l.genre")} AS genre, count(*)::int AS games,
            coalesce(sum(l.owners_est), 0)::float AS total_owners,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.owners_est)::float AS med_owners,
            coalesce(sum(l.ccu), 0)::int AS ccu,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.median_playtime_min)::float AS med_play
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND l.genre IS NOT NULL AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa') ${RELEASED_ONLY}
     GROUP BY ${canonSql("l.genre")} ORDER BY total_owners DESC`,
  );
  return rows.map((r) => ({
    genre: r.genre,
    games: num(r.games),
    totalOwners: num(r.total_owners),
    medianOwners: Math.round(num(r.med_owners)),
    ccu: num(r.ccu),
    medianPlaytimeMin: Math.round(num(r.med_play)),
  }));
}

// Top Steam studios (indie cohort) — Steam exposes real developer names.
export async function getSteamDevelopers(db: Querier): Promise<SteamDeveloperRow[]> {
  const rows = await db.query(
    `SELECT g.developer AS developer, count(DISTINCT g.id)::int AS games,
            coalesce(sum(l.owners_est), 0)::float AS owners, avg(l.rating)::float AS avg_rating,
            mode() WITHIN GROUP (ORDER BY ${canonSql("l.genre")}) AS top_genre
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND g.developer IS NOT NULL AND g.developer <> ''
       AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa') ${RELEASED_ONLY}
     GROUP BY g.developer ORDER BY owners DESC, games DESC LIMIT 40`,
  );
  return rows.map((r) => ({
    developer: r.developer,
    games: num(r.games),
    totalOwners: num(r.owners),
    avgRating: +num(r.avg_rating).toFixed(2),
    topGenre: r.top_genre ?? "—",
  }));
}

// Recent Steam releases (indie cohort) by release date.
// Steam shows no OVERALL review score until a title clears ~10 reviews (#109). Below this a
// fresh launch has rating=NULL and reads as "quiet" — the modal indie outcome (most launches
// land here), not a survivor. Surfacing votes + reviews/day + this flag is how New Releases
// stops hiding the failure baseline the survivor-only Comparables view deletes.
export const STEAM_SCORE_THRESHOLD_VOTES = 10;
export function newReleaseTraction(
  votes: number | null,
  releaseDate: string | null,
  now: number = Date.now(),
): {
  daysSinceRelease: number | null;
  reviewsPerDay: number | null;
  belowScoreThreshold: boolean;
} {
  const v = votes ?? 0;
  const belowScoreThreshold = v < STEAM_SCORE_THRESHOLD_VOTES;
  if (!releaseDate) return { daysSinceRelease: null, reviewsPerDay: null, belowScoreThreshold };
  const days = Math.floor((now - new Date(`${releaseDate}T00:00:00Z`).getTime()) / 86400000);
  const daysSinceRelease = days >= 0 ? days : null;
  const reviewsPerDay =
    daysSinceRelease == null ? null : +(v / Math.max(daysSinceRelease, 1)).toFixed(2);
  return { daysSinceRelease, reviewsPerDay, belowScoreThreshold };
}

export async function getSteamNewReleases(db: Querier): Promise<SteamNewRelease[]> {
  const rows = await db.query(
    `SELECT g.title, ${canonSql("l.genre")} AS genre, l.scale_tier AS tier, l.rating, l.votes, l.owners_est AS owners, l.price_cents AS price, g.release_date
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND g.release_date IS NOT NULL
       AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
     ORDER BY g.release_date DESC LIMIT 40`,
  );
  return rows.map((r) => {
    const releaseDate =
      r.release_date == null ? null : new Date(r.release_date).toISOString().slice(0, 10);
    const votes = r.votes == null ? null : num(r.votes);
    return {
      title: r.title,
      genre: r.genre ?? "—",
      tier: r.tier ?? "—",
      rating: r.rating == null ? null : +Number(r.rating).toFixed(2),
      votes,
      owners: r.owners == null ? null : num(r.owners),
      priceCents: r.price == null ? null : num(r.price),
      releaseDate,
      ...newReleaseTraction(votes, releaseDate),
    };
  });
}

async function steamGapExamples(db: Querier): Promise<Map<string, string[]>> {
  const rows = await db.query(
    `SELECT genre, tag, title FROM (
       SELECT ${canonSql("l.genre")} AS genre, ${canonSql("t.name")} AS tag, g.title AS title,
              row_number() OVER (PARTITION BY ${canonSql("l.genre")}, ${canonSql("t.name")} ORDER BY l.owners_est DESC NULLS LAST) AS rn
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
       JOIN game_tags gt ON gt.game_id = g.id JOIN tags t ON t.id = gt.tag_id
       WHERE g.is_live AND src.name = 'steam' AND l.genre IS NOT NULL AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
         AND lower(${canonSql("t.name")}) <> lower(${canonSql("l.genre")}) ${RELEASED_ONLY}
     ) x WHERE rn <= 3`,
  );
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const k = `${r.genre} × ${r.tag}`;
    const a = m.get(k) ?? [];
    a.push(r.title);
    m.set(k, a);
  }
  return m;
}

// Steam opportunity: indie genre×tag with high demand (owners) + quality, low supply, monetizable.
export async function getSteamOpportunity(db: Querier): Promise<SteamGap[]> {
  const supply = await genreSupplyTrend(db, "steam");
  // Standing flags add a visible score term BEFORE the sort and the top-8 cut (#12b), so
  // steering can surface a market the raw score kept off the list. None set → no-op.
  const { flags } = await getBriefSteering(db);
  const [rows, ex] = await Promise.all([
    db.query(
      `SELECT ${canonSql("l.genre")} AS genre, ${canonSql("t.name")} AS tag,
              count(DISTINCT g.id)::int AS supply_n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY l.owners_est)::float AS demand,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS quality,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price_cents)::float AS med_price
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
       JOIN game_tags gt ON gt.game_id = g.id JOIN tags t ON t.id = gt.tag_id
       WHERE g.is_live AND src.name = 'steam' AND l.genre IS NOT NULL AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
         AND lower(${canonSql("t.name")}) <> lower(${canonSql("l.genre")}) ${RELEASED_ONLY}
       GROUP BY ${canonSql("l.genre")}, ${canonSql("t.name")} HAVING count(DISTINCT g.id) >= 2`,
    ),
    steamGapExamples(db),
  ]);
  if (rows.length < 2) return [];
  const z = (vals: number[]) => {
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    return (v: number) => (v - m) / sd;
  };
  const zDem = z(rows.map((r) => num(r.demand)));
  const zSup = z(rows.map((r) => num(r.supply_n)));
  const zQual = z(rows.map((r) => num(r.quality)));
  return rows
    .map((r) => ({
      label: `${r.genre} × ${r.tag}`,
      genre: r.genre,
      tag: r.tag,
      supplyN: num(r.supply_n),
      medianOwners: Math.round(num(r.demand)),
      qualityCeil: +num(r.quality).toFixed(2),
      medianPriceCents: Math.round(num(r.med_price)),
      score: +(zDem(num(r.demand)) + zQual(num(r.quality)) - zSup(num(r.supply_n))).toFixed(2),
      // Same intermediates the score above sums — surfaced, not re-derived (#87). Signs match:
      // demand/quality lift, supply is negated. Rounded independently; sum ≈ score ±0.02.
      components: {
        demand: +zDem(num(r.demand)).toFixed(2),
        quality: +zQual(num(r.quality)).toFixed(2),
        supply: +(-zSup(num(r.supply_n))).toFixed(2),
      },
      examples: ex.get(`${r.genre} × ${r.tag}`) ?? [],
      supplyRising: supply.get(r.genre)?.trend === "rising",
    }))
    .map((g) => steerRow(g, flags)) // standing flags re-score the ranking (#12b)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

// Composed Steam screen payload: KPIs + tier mix + cohorts + comparables + all sub-sections.
export async function getSteamOverview(db: Querier): Promise<SteamOverview> {
  const [
    tiers,
    indie,
    all,
    comparables,
    opportunity,
    quadrant,
    pricing,
    ownership,
    developers,
    newReleases,
    tagEconomics,
  ] = await Promise.all([
    getScaleTierBreakdown(db, "steam"),
    getSteamGenreEconomics(db, { cohort: "indie" }),
    getSteamGenreEconomics(db, { cohort: "all" }),
    getSteamComparables(db, 14),
    getSteamOpportunity(db),
    getSteamGenreQuadrant(db),
    getSteamPricing(db),
    getSteamOwnership(db),
    getSteamDevelopers(db),
    getSteamNewReleases(db),
    getSteamTagEconomics(db),
  ]);
  const games = tiers.reduce((s, t) => s + t.games, 0);
  const aaa = tiers.find((t) => t.tier === "aaa")?.games ?? 0;
  const agg = (
    await db.query(
      `SELECT count(*) FILTER (WHERE l.rating IS NOT NULL)::int AS r, count(*)::int AS n,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY l.price_cents) FILTER (
              WHERE l.price_cents IS NOT NULL AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
            )::float AS indie_med_price
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' ${RELEASED_ONLY}`,
    )
  )[0];
  // Quiet-launch baseline (#109): of tracked non-AAA titles released in the last 90 days, the
  // share still below the review-score threshold (votes < 10 → Steam shows no score yet). This
  // is the failure floor — the denominator the survivor-only Comparables view makes invisible.
  const quiet = (
    await db.query(
      `SELECT count(*) FILTER (WHERE coalesce(l.votes, 0) < ${STEAM_SCORE_THRESHOLD_VOTES})::int AS quiet,
              count(*)::int AS n
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
       WHERE g.is_live AND src.name = 'steam' AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
         AND g.release_date IS NOT NULL
         AND g.release_date >= CURRENT_DATE - INTERVAL '90 days'`,
    )
  )[0];
  // AI-disclosure share (#110): of tracked non-AAA titles released in the last 90 days for which
  // we HAVE a non-null ai_disclosure reading (the gated store-page fetch cohort), the share that
  // disclose AI-generated content. `sample` is the denominator — the count we actually checked, so
  // an unknown-heavy crawl reads as a small sample rather than a fake 0%.
  const ai = (
    await db.query(
      `SELECT count(*) FILTER (WHERE l.ai_disclosure)::int AS disclosed,
              count(*) FILTER (WHERE l.ai_disclosure IS NOT NULL)::int AS n
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
       WHERE g.is_live AND src.name = 'steam' AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
         AND g.release_date IS NOT NULL
         AND g.release_date >= CURRENT_DATE - INTERVAL '90 days'`,
    )
  )[0];
  return {
    kpi: {
      games,
      indie: games - aaa,
      aaa,
      ratedPct: num(agg.n) ? Math.round((num(agg.r) / num(agg.n)) * 100) : 0,
      indieMedianPriceCents: Math.round(num(agg.indie_med_price)),
      quietLaunchPct: num(quiet.n) ? Math.round((num(quiet.quiet) / num(quiet.n)) * 100) : 0,
      quietLaunchSample: num(quiet.n),
      aiDisclosurePct: num(ai.n) ? Math.round((num(ai.disclosed) / num(ai.n)) * 100) : null,
      aiDisclosureSample: num(ai.n),
    },
    read: composeSteamRead({ opportunity, indie }),
    // Read over the ranked-AND-cut list, so a flag whose only match fell below the cut reports
    // as matching nothing you can SEE, rather than as a silent win.
    steering: steeringLens((await getBriefSteering(db)).flags, opportunity),
    tiers,
    indie,
    all,
    tagEconomics,
    comparables,
    opportunity,
    quadrant,
    pricing,
    ownership,
    developers,
    newReleases,
    subtitle: "Steam (PC) · indie-addressable cohort default",
  };
}
