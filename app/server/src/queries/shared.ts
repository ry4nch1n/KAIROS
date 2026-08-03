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
  const votesPerDay = Math.max(0, Math.round((pts[pts.length - 1] - pts[0]) / daySpan));
  if (pts.length < 3) return { votesPerDay, trajectory: "plateau" };
  const mid = Math.floor(pts.length / 2);
  const early = (pts[mid] - pts[0]) / Math.max(1, mid);
  const late = (pts[pts.length - 1] - pts[mid]) / Math.max(1, pts.length - 1 - mid);
  let trajectory: Trajectory = "plateau";
  if (late > early * 1.25 && late > 0) trajectory = "rising";
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
/** Score added per matching flag — enough to lift an on-interest market over a marginally
 *  better one, too small to float a market the data doesn't support (a z-score is ~1.0). */
export const STEERING_WEIGHT = 0.5;

export interface Steerable {
  genre: string;
  tag: string;
  score: number;
  components: ScoreComponents;
  steering?: SteeringMatch;
}

// Too generic to carry an interest; a flag with no significant word matches by family only.
const STOP = new Set(["game", "games", "the", "and", "for", "with", "new", "more", "very"]);
const wordsOf = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));

export const activeFlags = (flags: string[]) =>
  (flags ?? []).filter((f) => typeof f === "string" && f.trim());

/** Flags (verbatim) that match this market. Whole-word, plural-tolerant on the market's own
 *  genre/tag labels, plus the loop-family route when BOTH sides resolve to the same family. */
export function matchSteering(flags: string[], m: { genre: string; tag: string }): string[] {
  const hay = ` ${`${m.genre} ${m.tag}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
  const family = loopFamilyFor(m.genre, m.tag) ?? loopFamilyFromLabels([m.genre, m.tag]);
  const out: string[] = [];
  for (const flag of flags) {
    if (typeof flag !== "string" || !flag.trim()) continue;
    const byWord = wordsOf(flag).some(
      (w) =>
        hay.includes(` ${w} `) ||
        hay.includes(` ${w}s `) ||
        hay.includes(` ${w.replace(/s$/, "")} `),
    );
    const byFamily = family != null && loopFamilyFromLabels([flag]) === family;
    if ((byWord || byFamily) && !out.includes(flag)) out.push(flag);
  }
  return out;
}

/** Re-score ONE ranked market. A no-op when nothing matches (or nothing is set): score,
 *  components and keys stay exactly as the market data computed them. Slots into the ranking
 *  chain before its `.sort`, so a lift can push a market above the top-N cut. */
export function steerRow<T extends Steerable>(row: T, flags: string[]): T {
  const matched = matchSteering(activeFlags(flags), row);
  if (!matched.length) return row; // no claim, never force-fit
  const delta = +(STEERING_WEIGHT * matched.length).toFixed(2);
  row.score = +(row.score + delta).toFixed(2);
  row.components = { ...row.components, steering: delta };
  row.steering = { flags: matched, delta };
  return row;
}

/** What steering did to a ranking, for display. Undefined when no flags are set — the honest
 *  reading of "nothing is steering", not an empty lens implying an inert filter ran. */
export function steeringLens(flags: string[], rows: Steerable[]): SteeringLens | undefined {
  const active = activeFlags(flags);
  if (!active.length) return undefined;
  const hit = new Set(rows.flatMap((r) => r.steering?.flags ?? []));
  return {
    flags: active,
    applied: active.filter((f) => hit.has(f)),
    unmatched: active.filter((f) => !hit.has(f)),
    steered: rows.filter((r) => r.steering).length,
    weight: STEERING_WEIGHT,
  };
}
