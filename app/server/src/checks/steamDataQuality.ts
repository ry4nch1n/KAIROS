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

// ── Capture yield (#54, generalised by #158) ─────────────────────────────────
// The class of bug: an OPTIONAL enrichment fetch fails wholesale, every per-item error is
// swallowed as "unknown", and the run still reports `✔ loaded` because a row inserts fine with
// a null column. #54 was the canonical instance — 451 consecutive HTTP 429s across four daily
// crawls, all green, found by hand four days late.
//
// The assertion that catches it: measure CAPTURE YIELD (captured / eligible) against the DB
// rows the crawl just wrote — never against log text — and fail on 0% over a cohort large
// enough for 0% to mean something. One table row per guarded enrichment, so the NEXT optional
// fetch is guarded by adding four fields, not by re-deriving the reasoning.
//
// WHY IT LIVES IN THE GATE (check:steam) AND NOT IN crawler/run.ts (#158): #54's first cut
// exited non-zero from the crawl step, which runs BEFORE the data-quality gate — so one quiet
// enrichment skipped every other check that day. Generalising multiplies that, so the yield
// pass now reports alongside the rest of the gate. The crawl still ends red (crawl.yml fails on
// the gate step), and loads are append-only, so a red run never costs a day of data.

/** Below this many eligible titles a 0% rate is not evidence of anything. */
export const MIN_CAPTURE_COHORT = 10;

/** One guarded enrichment: what was attemptable, what arrived, and what silence costs. */
export interface CaptureCohort {
  /** Enrichment id, as it reads in the gate output — e.g. "followers". */
  key: string;
  /** Rows the crawler would have attempted this enrichment for (its own gating predicate). */
  eligible: number;
  /** Of those, rows that came back carrying a value (column IS NOT NULL). */
  captured: number;
  /** Sample floor below which 0% is not evidence. Defaults to {@link MIN_CAPTURE_COHORT}. */
  minCohort?: number;
  /** One line: what a silent 0% costs downstream, with the issue ref. Shown on failure. */
  why: string;
}

export interface CaptureYieldResult {
  ok: boolean;
  failures: string[];
  /** Per-enrichment `key captured/eligible (pct)`, reported whether or not it passed. */
  lines: string[];
}

/**
 * Assess every guarded enrichment in one pass. A cohort under its floor is REPORTED but never
 * asserted — a CRAWL_LIMIT-capped run, or a day with few coming-soon titles, must not false-
 * alarm. One captured value passes: these are trend series, so the bar is that the clock is
 * running, not that every fetch landed. A softer band (warn under 50%) can follow once there is
 * a baseline to calibrate against; 0% needs no calibration and is always wrong.
 */
export function assessCaptureYield(cohorts: CaptureCohort[]): CaptureYieldResult {
  const failures: string[] = [];
  const lines: string[] = [];

  for (const c of cohorts) {
    const floor = c.minCohort ?? MIN_CAPTURE_COHORT;
    const yieldPct = c.eligible ? c.captured / c.eligible : 0;
    const belowFloor = c.eligible < floor;
    lines.push(
      `${c.key} ${c.captured}/${c.eligible} eligible` +
        (c.eligible ? ` (${pct(yieldPct)})` : "") +
        (belowFloor ? " — under the assertion floor, not asserted" : ""),
    );
    if (belowFloor || c.captured > 0) continue;
    failures.push(
      `${c.key} capture 0% over ${c.eligible} eligible rows: the source returned nothing ` +
        `usable, so ${c.why} Snapshots were still loaded — this gate detects, it does not prevent.`,
    );
  }

  return { ok: failures.length === 0, failures, lines };
}
