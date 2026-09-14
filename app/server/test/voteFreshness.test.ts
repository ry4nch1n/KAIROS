import { beforeAll, describe, expect, it } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import {
  browserVoteSeries,
  browserVoteSteps,
  formatFreshness,
  formatVoteSteps,
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
  netChange: 0,
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
  it("splits moving series by net direction — a falling count is not a zero one", () => {
    const s = summarizeVoteSeries("k", [
      row({ distinct: 3, netChange: 12 }),
      row({ distinct: 2, netChange: -23 }),
      row({ distinct: 2, netChange: -1 }),
      row({ distinct: 3, netChange: 0 }),
    ]);
    expect(s).toMatchObject({ moving: 4, rising: 1, falling: 2 });
    expect(formatFreshness(s)).toContain("up 1 · down 2 · back to start 1");
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
      { source: "poki", votes: [104, null, 100], days: [0, 1, 2] }, // falling, null skipped
      { source: "poki", votes: [50], days: [0] }, // thin
      { source: "steam", votes: [9, 9], days: [0, 30] }, // not a browser portal
    ]);
    const rows = (await browserVoteSeries(db)).sort((a, b) => a.id - b.id);
    expect(rows.map((r) => [r.captures, r.distinct, Math.round(r.spanDays), r.netChange])).toEqual([
      [3, 1, 10, 0],
      [2, 2, 2, -4],
      [1, 1, 0, 0],
    ]);
    expect((await browserVoteSeries(db, [rows[0].id])).map((r) => r.id)).toEqual([rows[0].id]);
  });

  it("profiles capture-to-capture steps per portal and peak size", async () => {
    await seed([
      { source: "crazygames", votes: [500, 490, 480, 485], days: [0, 3, 6, 9] }, // <1k: 2 down, 1 up
      { source: "crazygames", votes: [20000, 20000, 18000], days: [0, 4, 8] }, // >=10k: flat, then a purge
      { source: "poki", votes: [100, 110], days: [0, 2] },
    ]);
    const steps = await browserVoteSteps(db);
    expect(steps.map((p) => [p.source, p.size, p.up, p.down, p.flat])).toEqual([
      ["crazygames", "<1k", 1, 2, 0],
      ["crazygames", ">=10k", 0, 1, 1],
      ["poki", "<1k", 1, 0, 0],
    ]);
    const small = steps[0];
    expect(small.medianDownPct).toBeCloseTo(2.02, 1); // 500→490 is 2%, 490→480 is 2.04%
    expect(small.medianGapDays).toBe(3);
    expect(formatVoteSteps(steps[1])).toContain("median step down −10%");
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
