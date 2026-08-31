import { beforeAll, describe, expect, it } from "vitest";
import { applySchema, freshMemoryDb, type Querier } from "../src/db/db.ts";
import { steamCohortCounts } from "../src/checks/steamCohort.ts";
import { assessSteamDataQuality } from "../src/checks/steamDataQuality.ts";

// #148. ~1/6 of every fresh cohort is an unreleased title (#54 part 2) with an honest NULL
// release_date and NULL scale_tier; the gate counted them, diluting `dateFill` and padding
// `indie` — the floors that catch a broken date parser and an all-AAA seed. Drives the REAL
// SQL against PGlite: the counts are the part a pure test of assessSteamDataQuality can't see.

let db: Querier;

// Floors low enough that only the invariant under test can trip, so a failure names its cause.
const THRESHOLDS = {
  minCrawled: 5,
  minDateFill: 0.5,
  minRatedFill: 0,
  minIndie: 15,
  minComparables: 1,
};

/** `released: null` = the browser shape, which never measures release state. */
interface Row {
  released: boolean | null;
  date?: string | null;
  tier?: string | null;
  followers?: number | null;
}

/** Seed one Steam crawl day. Same slugs across days on purpose: v_latest takes the later one. */
async function seed(rows: Row[], day = "2026-08-30"): Promise<void> {
  const sid = (
    await db.query(
      `INSERT INTO sources(name, base_url) VALUES ('steam','https://steam.test')
       ON CONFLICT (name) DO UPDATE SET base_url = EXCLUDED.base_url RETURNING id`,
    )
  )[0].id;
  const crawlId = (
    await db.query(
      `INSERT INTO crawls(source_id, started_at, status) VALUES ($1,$2,'ok') RETURNING id`,
      [sid, day],
    )
  )[0].id;
  for (const [i, r] of rows.entries()) {
    const gid = (
      await db.query(
        `INSERT INTO games(source_id, source_game_id, url, title, release_date, last_seen_at)
         VALUES ($1,$2,$3,$2,$4,$5)
         ON CONFLICT (source_id, source_game_id)
           DO UPDATE SET release_date = EXCLUDED.release_date, last_seen_at = EXCLUDED.last_seen_at
         RETURNING id`,
        [sid, `app-${i}`, `https://steam.test/app-${i}`, r.date ?? null, day],
      )
    )[0].id;
    await db.query(
      `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, scale_tier, coming_soon, followers)
       VALUES ($1,$2,$3,4.4,$4,$5,$6)`,
      [
        gid,
        crawlId,
        day,
        r.tier ?? null,
        r.released === null ? null : !r.released,
        r.followers ?? null,
      ],
    );
  }
}

const reset = () =>
  db.exec(
    `TRUNCATE game_tags, game_snapshots, tags, games, crawls, sources RESTART IDENTITY CASCADE;`,
  );
/** A shipped, dated, non-AAA title — the healthy shape. */
const released = (): Row => ({ released: true, date: "2026-06-01", tier: "small_indie" });
/** Unreleased, ingested honestly: no date, no measurable scale. */
const upcoming = (followers: number | null = 1200): Row => ({ released: false, followers });
const many = <T>(n: number, f: () => T) => Array.from({ length: n }, f);

beforeAll(async () => {
  db = await freshMemoryDb();
  await applySchema(db);
});

describe("gate cohort excludes coming-soon rows (#148)", () => {
  it("counts only released titles toward the floors, and reports the rest", async () => {
    await reset();
    await seed([
      ...many(20, released),
      ...many(5, () => upcoming(900)),
      ...many(5, () => upcoming(null)),
    ]);

    const c = await steamCohortCounts(db);
    expect(c.cohort).toBe(30); // the crawl really did write 30 rows
    expect(c.crawled).toBe(20); // …but only 20 are the released cohort
    expect(c.unreleased).toBe(10); // …and the rest are reported, not hidden
    expect([c.withDate, c.rated, c.indie]).toEqual([20, 20, 20]); // indie is NOT 30
    // The point: dateFill reads 100% of the released cohort, not 67% of everything.
    expect(c.withDate / c.crawled).toBe(1);
    expect(c.withDate / c.cohort).toBeCloseTo(0.667, 2); // what it used to read
    // The capture-yield cohorts (#158) are untouched: still the whole crawl, still the
    // unreleased rows for followers — the floors narrowed, the yield gate did not.
    expect([c.releaseStateCaptured, c.followersCaptured]).toEqual([30, 5]);
  });

  it("no longer lets coming-soon rows disguise an all-AAA seed", async () => {
    await reset();
    // Every released title is AAA; the 20 upcoming rows pass `scale_tier IS NULL OR <> aaa`,
    // so before #148 they alone cleared the floor.
    await seed([
      ...many(20, () => ({ ...released(), tier: "aaa" })),
      ...many(20, () => upcoming()),
    ]);

    const c = await steamCohortCounts(db);
    expect(c.indie).toBe(0);
    const res = assessSteamDataQuality({ ...c, comparables: 5 }, THRESHOLDS);
    expect(res.failures.join(" ")).toMatch(/indie cohort too small/);
  });

  it("is null-safe: rows that never measure release state stay in the cohort", async () => {
    await reset();
    // Browser-shaped rows, seeded on the steam source on purpose, so the predicate itself is
    // under test rather than the source filter.
    await seed([...many(5, released), ...many(5, () => ({ ...released(), released: null }))]);

    const c = await steamCohortCounts(db);
    expect([c.cohort, c.crawled, c.unreleased]).toEqual([10, 10, 0]);
    expect(c.releaseStateCaptured).toBe(5); // …and they still read as uncaptured release state
  });
});
