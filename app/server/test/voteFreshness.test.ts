import { beforeAll, describe, expect, it } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import {
  browserVoteSeries,
  formatFreshness,
  summarizeVoteSeries,
  voteFreshnessReport,
  type VoteSeries,
} from "../src/checks/voteFreshness.ts";

// #204 part 2 — the report that separates "the gems stopped gaining votes" from "the capture
// reads a stale count". The SQL is driven against a real PGlite database, because the query is
// the part that can be wrong in production.

let db: Querier;

/** One game per entry: `votes[i]` captured `days[i]` days after 2026-08-01. */
async function seed(games: { source: string; votes: (number | null)[]; days: number[] }[]) {
  await db.exec(
    `TRUNCATE game_tags, game_snapshots, tags, games, crawls, sources RESTART IDENTITY CASCADE;`,
  );
  for (const [i, g] of games.entries()) {
    const sid = (
      await db.query(
        `INSERT INTO sources(name, base_url) VALUES ($1,$2)
         ON CONFLICT (name) DO UPDATE SET base_url = EXCLUDED.base_url RETURNING id`,
        [g.source, `https://${g.source}.test`],
      )
    )[0].id;
    const gid = (
      await db.query(
        `INSERT INTO games(source_id, source_game_id, url, title) VALUES ($1,$2,$3,$4) RETURNING id`,
        [sid, `g${i}`, `https://${g.source}.test/g${i}`, `g${i}`],
      )
    )[0].id;
    // One crawl per capture: a snapshot is unique per (game, crawl), as in production.
    for (const [k, v] of g.votes.entries()) {
      const cid = (
        await db.query(
          `INSERT INTO crawls(source_id, started_at, status) VALUES ($1, now(), 'ok') RETURNING id`,
          [sid],
        )
      )[0].id;
      await db.query(
        `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes)
         VALUES ($1,$2, timestamptz '2026-08-01' + make_interval(days => $3), 4.5, $4)`,
        [gid, cid, g.days[k], v],
      );
    }
  }
}

beforeAll(async () => {
  db = await freshMemoryDb();
});

const row = (p: Partial<VoteSeries>): VoteSeries => ({
  id: 1,
  source: "poki",
  captures: 2,
  distinct: 1,
  spanDays: 10,
  peakVotes: 100,
  ...p,
});

describe("summarizeVoteSeries (#204)", () => {
  it("buckets thin, unchanged-recent, frozen and moving series", () => {
    const s = summarizeVoteSeries("k", [
      row({ captures: 1, spanDays: 0 }),
      row({ spanDays: 3 }),
      row({ spanDays: 7 }),
      row({ distinct: 2 }),
    ]);
    expect(s).toMatchObject({ games: 4, thin: 1, unchangedRecent: 1, frozen: 1, moving: 1 });
    expect(formatFreshness(s)).toContain("frozen ≥7d 1 (25%)");
  });
  it("an empty cohort reports zeros, not NaN", () => {
    const s = summarizeVoteSeries("k", []);
    expect(s).toMatchObject({ games: 0, medianCaptures: 0, medianSpanDays: 0 });
    expect(formatFreshness(s)).not.toContain("NaN");
  });
});

describe("browserVoteSeries — real SQL (#204)", () => {
  it("counts capture instants, distinct values and span; ignores null votes and Steam", async () => {
    await seed([
      { source: "poki", votes: [100, 100, 100], days: [0, 5, 10] }, // frozen
      { source: "poki", votes: [100, null, 104], days: [0, 1, 2] }, // moving, null skipped
      { source: "poki", votes: [50], days: [0] }, // thin
      { source: "steam", votes: [9, 9], days: [0, 30] }, // not a browser portal
    ]);
    const rows = (await browserVoteSeries(db)).sort((a, b) => a.id - b.id);
    expect(rows.map((r) => [r.captures, r.distinct, Math.round(r.spanDays)])).toEqual([
      [3, 1, 10],
      [2, 2, 2],
      [1, 1, 0],
    ]);
    expect((await browserVoteSeries(db, [rows[0].id])).map((r) => r.id)).toEqual([rows[0].id]);
  });

  it("reports gems, popular and catalogue per portal", async () => {
    await seed([
      { source: "crazygames", votes: [900, 950], days: [0, 8] },
      { source: "crazygames", votes: [40, 40], days: [0, 8] },
    ]);
    const keys = (await voteFreshnessReport(db)).map((s) => s.key);
    expect(keys).toEqual([
      "crazygames · hidden gems",
      "crazygames · popular top 10%",
      "crazygames · all live",
    ]);
  });
});
