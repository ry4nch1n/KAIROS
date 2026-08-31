// Capture-yield cohorts for the BROWSER portals — the half of #158 the Steam gate can't reach.
//
// Same bug class as #54, different failure surface: a browser enrichment comes from ONE fetch
// per crawl, and that fetch is deliberately failure-tolerant (`fetchDiscoverySeed` logs and
// returns [] on any throw/404/empty parse, so a moved listing page can never empty a crawl).
// The portal re-marks-up its homepage, every row loads with a NULL column, and the run still
// reports `✔ loaded`. For CrazyGames promotion (#56) that silence reads exactly like the
// hardcoded `featured: false` the column was added to replace.
//
// Registry, not per-source code: scoping, counting and the assertion are shared, so guarding
// the next browser enrichment is one row in BROWSER_ENRICHMENTS.
import type { Querier } from "../db/db.ts";
import type { CaptureCohort } from "./steamDataQuality.ts";

/** One guarded browser-portal enrichment, expressed as data over `game_snapshots`. */
export interface BrowserEnrichment {
  /** `sources.name` the enrichment belongs to. */
  source: string;
  /** Id as it reads in the gate output. */
  key: string;
  /** Snapshot column carrying the captured value; NULL means "not captured". */
  column: string;
  /**
   * SQL predicate over the fresh cohort selecting the rows the crawler would have attempted
   * this enrichment for. Defaults to the whole cohort. TRUSTED LITERAL from this file — it is
   * interpolated, so nothing caller-supplied may ever reach it.
   */
  eligibleWhere?: string;
  /** Sample floor below which 0% is not evidence. Defaults to MIN_CAPTURE_COHORT. */
  minCohort?: number;
  /** What a silent 0% costs downstream, with the issue ref. Shown on failure. */
  why: string;
}

// NOT guarded, deliberately:
//  · poki.homepage_position — read from the getHomepage blob already on each game page, so a
//    row carries a rank only when the crawled game happens to sit on the grid. Poki seeds no
//    promotion URLs, so a zero-overlap day is legitimate and 0% is not evidence.
//  · poki.trending — `typeof g.trending_rank === "number"` is always a boolean, so the column
//    is never NULL. It cannot go quiet, only go wrong, which is a different check.
//  · crazygames.trending — the portal publishes no such signal; NULL is the correct steady
//    state, so 0% capture is by design.
export const BROWSER_ENRICHMENTS: BrowserEnrichment[] = [
  {
    source: "crazygames",
    key: "crazygames.featured_rank",
    column: "homepage_position",
    // The whole fresh cohort is eligible because `extractFeatured` seeds the 8-slot shelf into
    // the crawl's OWN url set (mergeDiscovery caps the seed at half the limit, so all 8 fit).
    // A healthy run therefore always parses at least one ranked title, so 0% over a real cohort
    // can only mean the shelf parse returned nothing.
    why:
      "the homepage-shelf parse (#56) is the single point of failure for portal promotion, and " +
      "when it goes quiet every row reads as not-featured — indistinguishable from the " +
      "hardcoded false the column replaced, so promotion silently drops out of the data.",
  },
];

/** Column names are interpolated, so they must be plain identifiers. */
const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Count `captured/eligible` per browser enrichment over each source's FRESHEST crawl cohort —
 * the rows that crawl just wrote, never log text. Same cohort discipline as the Steam half:
 * the load is append-only over a rotating window, so measuring all-time would mix in legacy
 * rows a single crawl can't refill and the assertion would never mean anything again.
 */
export async function browserCaptureCohorts(
  db: Querier,
  registry: BrowserEnrichment[] = BROWSER_ENRICHMENTS,
): Promise<CaptureCohort[]> {
  const cohorts: CaptureCohort[] = [];
  for (const e of registry) {
    if (!IDENT.test(e.column)) throw new Error(`unsafe enrichment column: ${e.column}`);
    const eligible = e.eligibleWhere ?? "TRUE";
    const row = (
      await db.query(
        `WITH src AS (
           SELECT l.* FROM v_latest l
           JOIN games g ON g.id = l.game_id
           JOIN sources s ON s.id = g.source_id
           WHERE g.is_live AND s.name = $1
         ), fresh AS (
           SELECT * FROM src WHERE captured_at::date = (SELECT max(captured_at::date) FROM src)
         )
         SELECT count(*) FILTER (WHERE ${eligible})::int AS eligible,
                count(*) FILTER (WHERE (${eligible}) AND ${e.column} IS NOT NULL)::int AS captured
         FROM fresh`,
        [e.source],
      )
    )[0];
    cohorts.push({
      key: e.key,
      eligible: Number(row?.eligible ?? 0),
      captured: Number(row?.captured ?? 0),
      minCohort: e.minCohort,
      why: e.why,
    });
  }
  return cohorts;
}
