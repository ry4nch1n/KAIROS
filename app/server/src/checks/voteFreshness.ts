// Vote-count freshness and direction on the browser portals (#204). REPORT ONLY — never a gate failure.
//
// Hidden Gems' votes/day reads 0 on most rows. A zero rate has several causes, and the rate alone
// can't tell them apart:
//   · frozen    — the capture keeps reading the same count (stale page, or a count that stopped);
//   · falling   — the count goes DOWN between captures. The rate clamps negative slopes to 0, so a
//                 portal whose count is not a running total reads exactly like a dead title;
//   · thin      — fewer than two captures, so no rate is possible.
// Each is read against the POPULAR cohort on the same portal. Heavily-played titles must gain votes
// if the count is cumulative: if they fall as often as the gems, the count is not a running total and
// "votes per day" is not an accretion rate on that portal.
//
// Report-only because a threshold picked before the first readings would be a guess. Promote a row
// to an assertion once the numbers have been seen.
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
  netChange: number; // last capture's count − first capture's count
}

export interface FreshnessSummary {
  key: string;
  games: number;
  thin: number; // < 2 captures — no rate is possible
  unchangedRecent: number; // unchanged, but over less than FROZEN_MIN_SPAN_DAYS
  frozen: number; // unchanged across >= FROZEN_MIN_SPAN_DAYS
  moving: number; // the count changed at least once
  rising: number; // moving, and ended above where it started
  falling: number; // moving, and ended below where it started
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
  const moving = multi.filter((r) => r.distinct > 1);
  return {
    key,
    games: rows.length,
    thin: rows.length - multi.length,
    unchangedRecent: unchanged.filter((r) => r.spanDays < FROZEN_MIN_SPAN_DAYS).length,
    frozen: unchanged.filter((r) => r.spanDays >= FROZEN_MIN_SPAN_DAYS).length,
    moving: moving.length,
    rising: moving.filter((r) => r.netChange > 0).length,
    falling: moving.filter((r) => r.netChange < 0).length,
    medianCaptures: median(rows.map((r) => r.captures)),
    medianSpanDays: +median(rows.map((r) => r.spanDays)).toFixed(1),
  };
}

export function formatFreshness(s: FreshnessSummary): string {
  const pct = (n: number) => (s.games ? `${Math.round((n / s.games) * 100)}%` : "—");
  return (
    `${s.key}: ${s.games} games · moving ${s.moving} (${pct(s.moving)}; ` +
    `up ${s.rising} · down ${s.falling} · back to start ${s.moving - s.rising - s.falling}) · ` +
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
            max(gs.votes)::float AS peak_votes,
            ((array_agg(gs.votes ORDER BY gs.captured_at DESC))[1]
              - (array_agg(gs.votes ORDER BY gs.captured_at ASC))[1])::float AS net_change
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
    netChange: Number(r.net_change ?? 0),
  }));
}

/**
 * Capture-to-capture step profile per portal and title size (#204). A falling count has two very
 * different shapes, and they call for different fixes:
 *   · a ROLLING WINDOW — down steps are routine at every size, and each is small and steady, because
 *     old votes age out continuously;
 *   · a LIFETIME count with purges — down steps are rare, and each one is a large step change.
 * Size buckets use the title's peak count, so a small title's noise can't hide a large one's shape.
 */
export interface VoteStepProfile {
  source: string;
  size: string; // peak-votes bucket
  up: number;
  down: number;
  flat: number;
  medianDownPct: number | null; // median relative size of a down step, as a positive percent
  medianUpPct: number | null;
  medianGapDays: number | null; // median days between consecutive captures
}

export async function browserVoteSteps(db: Querier): Promise<VoteStepProfile[]> {
  const rows = await db.query(
    `WITH s AS (
       SELECT g.id AS id, src.name AS source, gs.captured_at AS t, max(gs.votes)::float AS v
       FROM game_snapshots gs
       JOIN games g ON g.id = gs.game_id
       JOIN sources src ON src.id = g.source_id
       WHERE gs.votes IS NOT NULL AND g.is_live AND src.name <> 'steam'
       GROUP BY g.id, src.name, gs.captured_at
     ), steps AS (
       SELECT id, source, v,
              lag(v) OVER w AS pv,
              extract(epoch FROM (t - lag(t) OVER w))::float / 86400 AS dt,
              max(v) OVER (PARTITION BY id) AS peak
       FROM s WINDOW w AS (PARTITION BY id ORDER BY t)
     )
     SELECT source,
            CASE WHEN peak < 1000 THEN '<1k' WHEN peak < 10000 THEN '1k-10k' ELSE '>=10k' END AS size,
            count(*) FILTER (WHERE v > pv)::int AS up,
            count(*) FILTER (WHERE v < pv)::int AS down,
            count(*) FILTER (WHERE v = pv)::int AS flat,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY (pv - v) / pv * 100)
              FILTER (WHERE v < pv AND pv > 0) AS med_down_pct,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY (v - pv) / pv * 100)
              FILTER (WHERE v > pv AND pv > 0) AS med_up_pct,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY dt) AS med_gap
     FROM steps
     WHERE pv IS NOT NULL
     GROUP BY source, size
     ORDER BY source, min(peak)`,
  );
  const n = (x: unknown) => (x == null ? null : +Number(x).toFixed(2));
  return rows.map((r) => ({
    source: String(r.source),
    size: String(r.size),
    up: Number(r.up),
    down: Number(r.down),
    flat: Number(r.flat),
    medianDownPct: n(r.med_down_pct),
    medianUpPct: n(r.med_up_pct),
    medianGapDays: n(r.med_gap),
  }));
}

export function formatVoteSteps(p: VoteStepProfile): string {
  const total = p.up + p.down + p.flat;
  const pct = (k: number) => (total ? `${Math.round((k / total) * 100)}%` : "—");
  const size = (x: number | null, sign: string) => (x == null ? "—" : `${sign}${x}%`);
  return (
    `${p.source} · peak ${p.size}: ${total} steps · up ${p.up} (${pct(p.up)}) · ` +
    `down ${p.down} (${pct(p.down)}) · flat ${p.flat} · median step down ${size(p.medianDownPct, "−")} · ` +
    `up ${size(p.medianUpPct, "+")} · median gap ${p.medianGapDays ?? "—"}d`
  );
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
