// Vote-count freshness on the browser portals (#204, part 2). REPORT ONLY — never a gate failure.
//
// #204's estimator fix (a least-squares slope over every capture) moved 1 of 30 Hidden Gems rows,
// because 22 of them have captures whose vote count never changes, and a fitted slope over a
// constant series is exactly 0. That leaves two readings the rate itself cannot tell apart:
//   · the games genuinely stopped accreting votes (a real answer about the market), or
//   · the capture is stale — a cached page, or a count the portal stopped updating.
// The discriminator is the POPULAR cohort on the same portal. Heavily-played titles must gain
// votes between captures; if their counts freeze at the same rate as the gems', the crawl is
// reading a stale number, not a quiet market. So every summary here is read against that baseline.
//
// Report-only because nothing about it is known yet: a threshold picked before the first reading
// would be a guess. Promote a row to an assertion once the numbers have been seen.
import type { Querier } from "../db/db.ts";
import { getHiddenGems } from "../queries/index.ts";

/** An unchanged count reads as FROZEN only across at least this span; shorter is just recent. */
export const FROZEN_MIN_SPAN_DAYS = 7;
/** Share of each portal's live catalogue (by peak votes) that counts as the popular baseline. */
export const POPULAR_SHARE = 0.1;

export interface VoteSeries {
  id: number;
  source: string;
  captures: number; // distinct capture instants carrying a vote count
  distinct: number; // distinct vote values across those captures
  spanDays: number; // first → last capture
  peakVotes: number;
}

export interface FreshnessSummary {
  key: string;
  games: number;
  thin: number; // < 2 captures — no rate is possible
  unchangedRecent: number; // unchanged, but over less than FROZEN_MIN_SPAN_DAYS
  frozen: number; // unchanged across >= FROZEN_MIN_SPAN_DAYS
  moving: number; // the count changed at least once
  medianCaptures: number;
  medianSpanDays: number;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarizeVoteSeries(key: string, rows: VoteSeries[]): FreshnessSummary {
  const multi = rows.filter((r) => r.captures >= 2);
  const unchanged = multi.filter((r) => r.distinct === 1);
  return {
    key,
    games: rows.length,
    thin: rows.length - multi.length,
    unchangedRecent: unchanged.filter((r) => r.spanDays < FROZEN_MIN_SPAN_DAYS).length,
    frozen: unchanged.filter((r) => r.spanDays >= FROZEN_MIN_SPAN_DAYS).length,
    moving: multi.length - unchanged.length,
    medianCaptures: median(rows.map((r) => r.captures)),
    medianSpanDays: +median(rows.map((r) => r.spanDays)).toFixed(1),
  };
}

export function formatFreshness(s: FreshnessSummary): string {
  const pct = (n: number) => (s.games ? `${Math.round((n / s.games) * 100)}%` : "—");
  return (
    `${s.key}: ${s.games} games · moving ${s.moving} (${pct(s.moving)}) · ` +
    `frozen ≥${FROZEN_MIN_SPAN_DAYS}d ${s.frozen} (${pct(s.frozen)}) · ` +
    `unchanged <${FROZEN_MIN_SPAN_DAYS}d ${s.unchangedRecent} · <2 captures ${s.thin} · ` +
    `median ${s.medianCaptures} captures over ${s.medianSpanDays}d`
  );
}

/** One row per live browser-portal game (optionally restricted to `ids`), over its full series. */
export async function browserVoteSeries(db: Querier, ids?: number[]): Promise<VoteSeries[]> {
  const rows = await db.query(
    `SELECT g.id AS id, s.name AS source,
            count(DISTINCT gs.captured_at)::int AS captures,
            count(DISTINCT gs.votes)::int AS distinct_votes,
            extract(epoch FROM (max(gs.captured_at) - min(gs.captured_at)))::float / 86400 AS span_days,
            max(gs.votes)::float AS peak_votes
     FROM game_snapshots gs
     JOIN games g ON g.id = gs.game_id
     JOIN sources s ON s.id = g.source_id
     WHERE gs.votes IS NOT NULL AND g.is_live AND s.name <> 'steam'
       ${ids ? "AND g.id = ANY($1)" : ""}
     GROUP BY g.id, s.name`,
    ids ? [ids] : [],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    source: String(r.source),
    captures: Number(r.captures),
    distinct: Number(r.distinct_votes),
    spanDays: Number(r.span_days ?? 0),
    peakVotes: Number(r.peak_votes ?? 0),
  }));
}

/** Per portal: the Hidden Gems rows, the whole live catalogue, and its popular baseline. */
export async function voteFreshnessReport(db: Querier): Promise<FreshnessSummary[]> {
  const gemIds = (await getHiddenGems(db, "all")).map((g) => g.gameId);
  const [gems, all] = await Promise.all([
    gemIds.length ? browserVoteSeries(db, gemIds) : Promise.resolve([]),
    browserVoteSeries(db),
  ]);
  const out: FreshnessSummary[] = [];
  for (const source of [...new Set(all.map((r) => r.source))].sort()) {
    const catalogue = all.filter((r) => r.source === source);
    const popular = [...catalogue]
      .sort((a, b) => b.peakVotes - a.peakVotes)
      .slice(0, Math.max(1, Math.round(catalogue.length * POPULAR_SHARE)));
    out.push(
      summarizeVoteSeries(
        `${source} · hidden gems`,
        gems.filter((r) => r.source === source),
      ),
      summarizeVoteSeries(`${source} · popular top ${POPULAR_SHARE * 100}%`, popular),
      summarizeVoteSeries(`${source} · all live`, catalogue),
    );
  }
  return out;
}
