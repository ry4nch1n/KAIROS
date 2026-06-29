// One-off diagnostic — data quality for the GameRadar redesign. Prints aggregates only, no secrets.
import { appDb, usingNeon } from "./db.ts";

const db = await appDb();
const q = (sql: string) => db.query(sql);
const pj = (label: string, rows: any) => console.log(`\n### ${label}\n` + JSON.stringify(rows, null, 2));

console.log(`DB: ${usingNeon() ? "Neon" : "local PGlite"}`);

pj("snapshot counts + distinct capture days", await q(
  `SELECT count(*)::int AS snapshots,
          count(DISTINCT captured_at)::int AS distinct_captured_at,
          count(DISTINCT date_trunc('day', captured_at))::int AS distinct_days,
          min(captured_at) AS first, max(captured_at) AS last
   FROM game_snapshots`));

pj("distinct captured_at values (the chart 'weeks')", await q(
  `SELECT captured_at, count(*)::int AS rows FROM game_snapshots GROUP BY captured_at ORDER BY captured_at`));

pj("featured / trending / homepage_position population", await q(
  `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE featured)::int AS featured_true,
          count(*) FILTER (WHERE trending)::int AS trending_true,
          count(*) FILTER (WHERE homepage_position IS NOT NULL)::int AS homepage_pos_set,
          count(*) FILTER (WHERE plays IS NOT NULL)::int AS plays_set,
          count(*) FILTER (WHERE votes IS NOT NULL)::int AS votes_set,
          count(*) FILTER (WHERE rating IS NOT NULL)::int AS rating_set,
          count(*) FILTER (WHERE genre IS NOT NULL)::int AS genre_set
   FROM game_snapshots`));

pj("games by source + developer/engine coverage", await q(
  `SELECT s.name,
          count(g.id)::int AS games,
          count(g.developer) FILTER (WHERE g.developer IS NOT NULL AND g.developer <> '')::int AS has_dev,
          count(g.engine) FILTER (WHERE g.engine IS NOT NULL AND g.engine <> '')::int AS has_engine
   FROM sources s LEFT JOIN games g ON g.source_id = s.id GROUP BY s.name ORDER BY s.name`));

pj("rating distribution (latest snapshot per game)", await q(
  `SELECT width_bucket(rating, 0, 5, 10) AS bucket, count(*)::int AS n,
          round(min(rating),2) AS lo, round(max(rating),2) AS hi
   FROM v_latest WHERE rating IS NOT NULL GROUP BY bucket ORDER BY bucket`));

pj("votes distribution (latest)", await q(
  `SELECT count(*)::int AS n,
          min(votes) AS min, max(votes) AS max,
          round(avg(votes)) AS avg,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY votes)::int AS median,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY votes)::int AS p90
   FROM v_latest WHERE votes IS NOT NULL`));

pj("hidden gems count vs total (rating>=4.4 AND votes<5000 AND not featured)", await q(
  `SELECT count(*)::int AS hidden_gems,
          (SELECT count(*)::int FROM v_latest) AS total_latest
   FROM v_latest WHERE rating >= 4.4 AND votes < 5000 AND featured = false`));

pj("genre coverage (top 15 by game count, latest)", await q(
  `SELECT genre, count(*)::int AS games FROM v_latest WHERE genre IS NOT NULL
   GROUP BY genre ORDER BY games DESC LIMIT 15`));

pj("snapshot deltas — do rating/votes actually change day to day? (sample games with >1 snapshot)", await q(
  `WITH per AS (
     SELECT game_id, count(*)::int AS snaps,
            max(votes)-min(votes) AS vote_span,
            round((max(rating)-min(rating))::numeric,2) AS rating_span
     FROM game_snapshots GROUP BY game_id)
   SELECT count(*)::int AS games_with_multi_snaps,
          count(*) FILTER (WHERE vote_span > 0)::int AS games_votes_changed,
          count(*) FILTER (WHERE rating_span > 0)::int AS games_rating_changed,
          max(vote_span) AS max_vote_span
   FROM per WHERE snaps > 1`));

process.exit(0);
