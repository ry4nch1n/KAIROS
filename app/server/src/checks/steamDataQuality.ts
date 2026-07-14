// Data-quality invariants for the Steam source — the recency/accuracy gate that catches the
// class of bug shape-tests miss: a crawl that "succeeds" but produces stale or wrong data
// (empty indie seed → all-AAA, a broken date parser → all-null release_date, comparables
// collapsing to a couple rows). Pure + unit-tested; reused by the live validator and the
// post-crawl CI canary.
//
// COHORT NOTE: the accuracy/seed checks (crawled/withDate/rated/indie) are measured over the
// FRESHEST crawl cohort — the games whose latest snapshot is from the most recent crawl — NOT
// the whole accumulated DB. The load is append-only over a rotating seed, so legacy rows keep
// null dates a single crawl can't fix; measuring all-time would false-fail forever. `comparables`
// is the exception: it's the actual queryable UI output over all live Steam games.

export interface SteamQualityCounts {
  crawled: number; // games in the most-recent crawl (fresh cohort) — did the crawl produce data
  withDate: number; // fresh cohort with release_date  (date-parser / locale accuracy)
  rated: number; // fresh cohort with a rating
  indie: number; // fresh cohort with scale_tier <> 'aaa'  (indie seed present + not all-AAA)
  comparables: number; // getSteamComparables over ALL live Steam (recency window populated)
}

export interface SteamQualityThresholds {
  minCrawled: number;
  minDateFill: number; // fraction 0–1 of the fresh cohort
  minRatedFill: number; // fraction 0–1 of the fresh cohort
  minIndie: number; // fresh-cohort non-aaa count
  minComparables: number;
}

// Conservative — only fires on genuine degeneracy, not normal variance (avoids alert fatigue
// on the daily crawl). Tune in one place.
export const DEFAULT_STEAM_QUALITY: SteamQualityThresholds = {
  minCrawled: 50,
  minDateFill: 0.5,
  minRatedFill: 0.4,
  minIndie: 15,
  minComparables: 3,
};

export interface SteamQualityResult {
  ok: boolean;
  failures: string[];
  metrics: {
    crawled: number;
    dateFillPct: number;
    ratedPct: number;
    indie: number;
    comparables: number;
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function assessSteamDataQuality(
  c: SteamQualityCounts,
  t: SteamQualityThresholds = DEFAULT_STEAM_QUALITY,
): SteamQualityResult {
  const dateFillPct = c.crawled ? c.withDate / c.crawled : 0;
  const ratedPct = c.crawled ? c.rated / c.crawled : 0;
  const failures: string[] = [];

  if (c.crawled < t.minCrawled)
    failures.push(
      `latest crawl too small: ${c.crawled} < ${t.minCrawled} games (crawl produced little/no data?)`,
    );
  if (dateFillPct < t.minDateFill)
    failures.push(
      `release_date fill too low: ${pct(dateFillPct)} < ${pct(t.minDateFill)} (date-parser / locale regression?)`,
    );
  if (ratedPct < t.minRatedFill)
    failures.push(`rating fill too low: ${pct(ratedPct)} < ${pct(t.minRatedFill)}`);
  if (c.indie < t.minIndie)
    failures.push(
      `indie cohort too small: ${c.indie} < ${t.minIndie} (indie seed empty → all-AAA, or over-classification?)`,
    );
  if (c.comparables < t.minComparables)
    failures.push(
      `recent comparables too sparse: ${c.comparables} < ${t.minComparables} (recency window / seed recency regression?)`,
    );

  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      crawled: c.crawled,
      dateFillPct,
      ratedPct,
      indie: c.indie,
      comparables: c.comparables,
    },
  };
}
