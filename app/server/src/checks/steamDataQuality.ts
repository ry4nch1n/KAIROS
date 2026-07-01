// Data-quality invariants for the Steam source — the recency/accuracy gate that catches the
// class of bug shape-tests miss: a crawl that "succeeds" but produces stale or wrong data
// (empty indie seed → all-AAA, a broken date parser → all-null release_date, comparables
// collapsing to a couple rows). Pure + unit-tested; reused by the live validator and the
// post-crawl CI canary. Counts are computed by the caller against v_latest for src=steam.

export interface SteamQualityCounts {
  total: number;        // live steam games
  withDate: number;     // release_date NOT NULL  (guards the date parser)
  rated: number;        // rating NOT NULL
  indie: number;        // scale_tier <> 'aaa'    (guards seed-empty→all-AAA and scale-as-AAA)
  comparables: number;  // rows returned by getSteamComparables (guards recency window collapse)
}

export interface SteamQualityThresholds {
  minTotal: number;
  minDateFill: number;   // fraction 0–1
  minRatedFill: number;  // fraction 0–1
  minIndie: number;
  minComparables: number;
}

// Conservative — only fires on genuine degeneracy, not normal variance (avoids alert fatigue
// on the daily crawl). Tune in one place.
export const DEFAULT_STEAM_QUALITY: SteamQualityThresholds = {
  minTotal: 50,
  minDateFill: 0.5,
  minRatedFill: 0.4,
  minIndie: 15,
  minComparables: 3,
};

export interface SteamQualityResult {
  ok: boolean;
  failures: string[];
  metrics: { total: number; dateFillPct: number; ratedPct: number; indie: number; comparables: number };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function assessSteamDataQuality(
  c: SteamQualityCounts,
  t: SteamQualityThresholds = DEFAULT_STEAM_QUALITY
): SteamQualityResult {
  const dateFillPct = c.total ? c.withDate / c.total : 0;
  const ratedPct = c.total ? c.rated / c.total : 0;
  const failures: string[] = [];

  if (c.total < t.minTotal)
    failures.push(`too few Steam games: ${c.total} < ${t.minTotal} (crawl produced little/no data?)`);
  if (dateFillPct < t.minDateFill)
    failures.push(`release_date fill too low: ${pct(dateFillPct)} < ${pct(t.minDateFill)} (date-parser / locale regression?)`);
  if (ratedPct < t.minRatedFill)
    failures.push(`rating fill too low: ${pct(ratedPct)} < ${pct(t.minRatedFill)}`);
  if (c.indie < t.minIndie)
    failures.push(`indie cohort too small: ${c.indie} < ${t.minIndie} (indie seed empty → all-AAA, or over-classification?)`);
  if (c.comparables < t.minComparables)
    failures.push(`recent comparables too sparse: ${c.comparables} < ${t.minComparables} (recency window / seed recency regression?)`);

  return {
    ok: failures.length === 0,
    failures,
    metrics: { total: c.total, dateFillPct, ratedPct, indie: c.indie, comparables: c.comparables },
  };
}
