import { beforeAll, describe, expect, it } from "vitest";
import { applySchema, freshMemoryDb, type Querier } from "../src/db/db.ts";
import {
  BROWSER_ENRICHMENTS,
  browserCaptureCohorts,
  type BrowserEnrichment,
} from "../src/checks/browserCaptureYield.ts";
import { assessCaptureYield, MIN_CAPTURE_COHORT } from "../src/checks/steamDataQuality.ts";

// #158, browser half. The Steam capture-yield rows are asserted as pure functions in
// steamDataQuality.test.ts; what was never covered is the half that can actually be wrong in
// production — the SQL that turns "the rows this crawl just wrote" into eligible/captured
// counts. So this test drives the REAL query against a real (PGlite) database and proves the
// guard fires on a seeded 0%-capture day, stays quiet on a healthy one, and never false-alarms
// below the cohort floor.

let db: Querier;

/** Seed one crawl day per entry; `ranks` is one snapshot per game (null = not captured). */
async function seed(
  days: { source: string; day: string; ranks: (number | null)[] }[],
): Promise<void> {
  await db.exec(
    `TRUNCATE game_tags, game_snapshots, tags, games, crawls, sources RESTART IDENTITY CASCADE;`,
  );
  for (const d of days) {
    const sid = (
      await db.query(
        `INSERT INTO sources(name, base_url) VALUES ($1,$2)
         ON CONFLICT (name) DO UPDATE SET base_url = EXCLUDED.base_url RETURNING id`,
        [d.source, `https://${d.source}.test`],
      )
    )[0].id;
    const crawlId = (
      await db.query(
        `INSERT INTO crawls(source_id, started_at, status) VALUES ($1,$2,'ok') RETURNING id`,
        [sid, d.day],
      )
    )[0].id;
    for (const [i, rank] of d.ranks.entries()) {
      const slug = `${d.source}-${i}`;
      // Same slug across days on purpose: v_latest must then resolve to the LATER snapshot.
      const gid = (
        await db.query(
          `INSERT INTO games(source_id, source_game_id, url, title, last_seen_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (source_id, source_game_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
           RETURNING id`,
          [sid, slug, `https://${d.source}.test/game/${slug}`, slug, d.day],
        )
      )[0].id;
      await db.query(
        `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, featured, homepage_position)
         VALUES ($1,$2,$3,4.2,500,$4,$5)`,
        [gid, crawlId, d.day, rank != null, rank],
      );
    }
  }
}

const cg = (ranks: (number | null)[], day = "2026-08-30") => ({
  source: "crazygames",
  day,
  ranks,
});
const nulls = (n: number) => Array.from({ length: n }, () => null);

async function assess(registry: BrowserEnrichment[] = BROWSER_ENRICHMENTS) {
  return assessCaptureYield(await browserCaptureCohorts(db, registry));
}

beforeAll(async () => {
  db = await freshMemoryDb();
  await applySchema(db);
});

describe("browser capture yield — asserted against the rows the crawl wrote (#56/#158)", () => {
  it("fires when the homepage shelf goes quiet: 0% over a real cohort", async () => {
    await seed([cg(nulls(12))]);
    const r = await assess();
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/crazygames\.featured_rank capture 0% over 12 eligible/);
    expect(r.failures.join(" ")).toMatch(/#56/);
  });

  it("passes on a healthy day — the shelf parsed and ranks landed", async () => {
    await seed([cg([1, 2, 3, ...nulls(9)])]);
    const r = await assess();
    expect(r.ok).toBe(true);
    expect(r.lines.join(" ")).toMatch(/crazygames\.featured_rank 3\/12 eligible \(25%\)/);
  });

  it("never false-alarms below the cohort floor (a CRAWL_LIMIT-capped or empty run)", async () => {
    await seed([cg(nulls(MIN_CAPTURE_COHORT - 1))]);
    expect((await assess()).ok).toBe(true);
    await seed([]); // source absent entirely
    const empty = await assess();
    expect(empty.ok).toBe(true);
    expect(empty.lines.join(" ")).toMatch(/0\/0 eligible — under the assertion floor/);
  });

  it("reads the FRESHEST day only — yesterday's ranks cannot mask today's silence", async () => {
    await seed([cg([1, 2, 3, ...nulls(9)], "2026-08-29"), cg(nulls(12), "2026-08-30")]);
    const r = await assess();
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/crazygames\.featured_rank capture 0% over 12 eligible/);
  });

  it("scopes the cohort to its own source — another portal's rows never leak in", async () => {
    await seed([cg(nulls(12)), { source: "poki", day: "2026-08-30", ranks: [1, 2, 3, 4, 5] }]);
    const r = await assess();
    expect(r.lines).toHaveLength(1); // poki is deliberately not guarded
    expect(r.lines.join(" ")).toMatch(/0\/12 eligible/);
    expect(r.ok).toBe(false);
  });

  it("honours a narrower eligibility predicate, mirroring the crawler's own gate", async () => {
    await seed([cg([1, ...nulls(11)])]);
    // Only the promoted rows are eligible here, so the same data reads as a 1/1 cohort that is
    // below the floor — the shape a future browser enrichment with its own gate will use.
    const r = await assess([{ ...BROWSER_ENRICHMENTS[0], eligibleWhere: "featured IS TRUE" }]);
    expect(r.ok).toBe(true);
    expect(r.lines.join(" ")).toMatch(/1\/1 eligible \(100%\)/);
  });

  it("refuses a column name that is not a plain identifier (it is interpolated)", async () => {
    await expect(
      browserCaptureCohorts(db, [{ ...BROWSER_ENRICHMENTS[0], column: "x; DROP TABLE games" }]),
    ).rejects.toThrow(/unsafe enrichment column/);
  });
});
