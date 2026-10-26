// Load-volume assertion (#269). FAILS THE GATE, per source.
//
// Every other check in the gate reads `v_latest` (the latest snapshot PER GAME), so a crawl that
// writes nothing does not empty those reads — it silently re-evaluates the previous night's
// cohort, and the gate stays green. Measured: Steam loaded 0/200 on 2026-10-22 (appdetails served
// HTML for every call) and Poki has loaded 0/0 nightly since early October; both runs passed.
// #158 asserts capture yield WITHIN a cohort; this asserts the cohort EXISTS.
//
// Volume is the number of snapshot rows attached to the source's latest crawl, counted from
// `game_snapshots` rather than the crawl runner's `inserted` tally: a same-day re-run is
// idempotent (ON CONFLICT DO NOTHING) and would otherwise read as an empty load.
//
// SKIP REASONS ARE NOT STORED. The crawler logs each skipped game to stdout and the `crawls` row
// carries no reason column, so a failure points at the crawl step's `skip` log lines instead of
// quoting one. Adding a column only for this message was judged not worth a schema change.
import type { Querier } from "../db/db.ts";

/**
 * Sources the daily crawl workflow (crawl.yml) loads before this gate runs. A source that is not
 * crawled there must not be listed, or the gate fails on a source nobody tried to load. `census`
 * is not a game load (it writes `tag_census`) and runs after the gate.
 */
export const CRAWLED_SOURCES = ["crazygames", "poki", "steam"] as const;

/** The latest load fails below this share of the source's recent median. */
export const MIN_VOLUME_SHARE = 0.25;
/** How many crawls before the latest one form the baseline median. */
export const BASELINE_CRAWLS = 7;

export interface SourceLoadVolume {
  source: string;
  /** Day of the latest crawl (YYYY-MM-DD), null when the source has never been crawled. */
  latestDay: string | null;
  /** Snapshot rows the latest crawl wrote. */
  latest: number;
  /** Snapshot rows of up to BASELINE_CRAWLS crawls before the latest, newest first. */
  previous: number[];
}

export interface LoadVolumeResult {
  failures: string[];
  /** One report line per source, printed whether or not it passed. */
  lines: string[];
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const SKIP_HINT =
  "no skip reason is stored for the crawl — see its `skip` lines in the crawl step's log";

/** Read the latest crawl plus its baseline for each source, in source order. */
export async function sourceLoadVolumes(
  db: Querier,
  sources: readonly string[] = CRAWLED_SOURCES,
  baseline = BASELINE_CRAWLS,
): Promise<SourceLoadVolume[]> {
  const rows = await db.query(
    `SELECT s.name AS source, to_char(c.started_at, 'YYYY-MM-DD') AS day,
            (SELECT count(*)::int FROM game_snapshots gs WHERE gs.crawl_id = c.id) AS n,
            row_number() OVER (PARTITION BY s.name ORDER BY c.started_at DESC, c.id DESC)::int AS rn
     FROM crawls c JOIN sources s ON s.id = c.source_id
     WHERE s.name = ANY($1)`,
    [[...sources]],
  );
  return sources.map((source) => {
    const mine = rows
      .filter((r: any) => r.source === source && r.rn <= baseline + 1)
      .sort((a: any, b: any) => a.rn - b.rn);
    return {
      source,
      latestDay: mine[0]?.day ?? null,
      latest: mine[0]?.n ?? 0,
      previous: mine.slice(1).map((r: any) => r.n as number),
    };
  });
}

/** Fail any source whose latest crawl loaded nothing, or collapsed against its recent median. */
export function assessLoadVolume(
  volumes: SourceLoadVolume[],
  minShare = MIN_VOLUME_SHARE,
): LoadVolumeResult {
  const failures: string[] = [];
  const lines: string[] = [];
  for (const v of volumes) {
    if (v.latestDay == null) {
      lines.push(`${v.source}: no crawl recorded`);
      failures.push(
        `load volume: ${v.source} has no crawl recorded, though the daily crawl loads it (#269).`,
      );
      continue;
    }
    const med = v.previous.length ? median(v.previous) : null;
    const share = med ? v.latest / med : null;
    lines.push(
      `${v.source}: ${v.latest} rows on ${v.latestDay}` +
        (med == null
          ? " (no baseline yet)"
          : ` vs median ${med} over last ${v.previous.length}` +
            (share == null ? "" : ` (${Math.round(share * 100)}%)`)),
    );
    if (v.latest === 0) {
      failures.push(
        `load volume: ${v.source} loaded 0 rows on ${v.latestDay} — every downstream read is ` +
          `re-evaluating an older cohort; ${SKIP_HINT} (#269).`,
      );
    } else if (share != null && share < minShare) {
      failures.push(
        `load volume: ${v.source} loaded ${v.latest} rows on ${v.latestDay}, ` +
          `${Math.round(share * 100)}% of its median ${med} over the last ${v.previous.length} ` +
          `crawls (floor ${Math.round(minShare * 100)}%); ${SKIP_HINT} (#269).`,
      );
    }
  }
  return { failures, lines };
}
