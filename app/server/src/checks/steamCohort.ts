// The Steam half of the crawl gate's cohort SQL — "the rows this crawl just wrote", counted.
//
// Extracted from scripts/check-steam-data.ts (#148) for the reason browserCaptureYield.ts
// exists: the assertions are pure and tested, but the SQL that FEEDS them is what can silently
// be wrong in production, and a process-exiting IIFE cannot be driven by a test. Here it can.
//
// COHORT DISCIPLINE, two axes, deliberately different:
//  · FRESHNESS — every count is over the games whose latest snapshot is from the most recent
//    crawl day; the append-only DB's legacy rows keep null dates a single crawl can't fix.
//  · RELEASE STATE (#148) — the quality floors (dateFill/ratedFill/indie/minCrawled) are
//    measured over RELEASED titles only, via the very predicate the analytics use
//    (RELEASED_ONLY). Since #54 part 2 the crawl also seeds Steam's "Popular Upcoming" shelf,
//    and an unreleased title carries an honest NULL release_date and NULL scale_tier. Counting
//    those toward the floors let ~1/6 of the cohort dilute dateFill and pad `indie` with rows
//    that pass `scale_tier IS NULL` — i.e. the all-AAA-seed regression the indie floor exists
//    to catch could hide behind them. `IS NOT TRUE` is null-safe, so a row that never measures
//    release state (the browser shape) stays counted. The capture-yield cohorts (#158) keep
//    measuring the FULL crawl, and the unreleased rows are reported — an invisible-but-
//    influential stream is how #148 happened in the first place.
import type { Querier } from "../db/db.ts";
import { RELEASED_ONLY } from "../queries/steam.ts";
import { STEAM_AI_DISCLOSURE_MAX_AGE_DAYS } from "../crawler/steam.ts";

export interface SteamCohortCounts {
  /** Every fresh-cohort row, released or not — the crawl's true size, and what release-state capture is measured over. */
  cohort: number;
  /** Released rows only — the denominator for every data-quality floor. */
  crawled: number;
  /** Fresh rows the store marks unreleased. Reported, and the eligible set for follower capture. */
  unreleased: number;
  /** Released rows carrying a release_date / rating / a non-aaa tier. */
  withDate: number;
  rated: number;
  indie: number;
  /** Capture yield (#158): rows carrying the release-state marker at all. */
  releaseStateCaptured: number;
  /** Of `unreleased`, those that came back with a follower count. */
  followersCaptured: number;
  aiEligible: number; // eligibility mirrors wantsAiDisclosure() in crawler/steam.ts
  aiCaptured: number;
}

/** Count the freshest Steam crawl cohort once — every gate metric comes out of this one pass. */
export async function steamCohortCounts(db: Querier): Promise<SteamCohortCounts> {
  const r = (
    await db.query(
      `WITH steam AS (
         SELECT l.*, g.release_date
         FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources s ON s.id = g.source_id
         WHERE g.is_live AND s.name = 'steam'
       ), fresh AS (
         SELECT *,
                -- The analytics' own released-cohort predicate, reused verbatim (#148).
                (TRUE ${RELEASED_ONLY}) AS released,
                -- Mirrors wantsAiDisclosure() in crawler/steam.ts: non-AAA, dated, released within
                -- the max-age window (+1 day of slack for future-dating). Both sides read the SAME
                -- persisted columns, so the two cohorts coincide; keep them in step if either moves.
                (l.scale_tier IS DISTINCT FROM 'aaa' AND l.release_date IS NOT NULL
                 AND l.release_date BETWEEN (CURRENT_DATE - $1::int) AND (CURRENT_DATE + 1)) AS ai_wanted
         FROM steam l WHERE l.captured_at::date = (SELECT max(captured_at::date) FROM steam)
       )
       SELECT count(*)::int AS cohort,
              count(*) FILTER (WHERE released)::int AS crawled,
              count(*) FILTER (WHERE NOT released)::int AS unreleased,
              count(*) FILTER (WHERE released AND release_date IS NOT NULL)::int AS with_date,
              count(*) FILTER (WHERE released AND rating IS NOT NULL)::int AS rated,
              count(*) FILTER (WHERE released AND (scale_tier IS NULL OR scale_tier <> 'aaa'))::int AS indie,
              -- capture-yield cohorts (#158): eligible vs actually-carrying-a-value, per enrichment
              count(*) FILTER (WHERE coming_soon IS NOT NULL)::int AS release_state_captured,
              count(*) FILTER (WHERE NOT released AND followers IS NOT NULL)::int AS followers_captured,
              count(*) FILTER (WHERE ai_wanted)::int AS ai_eligible,
              count(*) FILTER (WHERE ai_wanted AND ai_disclosure IS NOT NULL)::int AS ai_captured
       FROM fresh`,
      [STEAM_AI_DISCLOSURE_MAX_AGE_DAYS],
    )
  )[0];
  const n = (v: unknown) => Number(v ?? 0);
  return {
    cohort: n(r?.cohort),
    crawled: n(r?.crawled),
    unreleased: n(r?.unreleased),
    withDate: n(r?.with_date),
    rated: n(r?.rated),
    indie: n(r?.indie),
    releaseStateCaptured: n(r?.release_state_captured),
    followersCaptured: n(r?.followers_captured),
    aiEligible: n(r?.ai_eligible),
    aiCaptured: n(r?.ai_captured),
  };
}
