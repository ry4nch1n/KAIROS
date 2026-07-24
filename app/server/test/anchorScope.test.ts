import { beforeAll, describe, expect, it } from "vitest";
import { applySchema, freshMemoryDb, type Querier } from "../src/db/db.ts";
import * as q from "../src/queries/index.ts";

// Regression for #100: the 14-day "new" anchor must be scoped to each platform's OWN newest
// record. The anchor is data-relative (newest first_seen_at, for determinism), NOT wall-clock
// — but it must carry the same source predicate as the query it bounds. We seed two sources at
// very different recency: a browser source (poki) whose newest discovery is 40 days old, and a
// Steam source that discovered a game today. So the GLOBAL max first_seen_at belongs to Steam.
// If any anchor were sourced globally (the bug), poki's 14-day window would slide to
// [today-14, today] and count ZERO poki entrants even though poki has three inside its own
// window. Every assertion below reads 0 under the global-anchor bug and the correct count only
// once the anchor is scoped to the outer query's platform.

let db: Querier;

async function seedGame(
  sid: number,
  crawlId: number,
  slug: string,
  firstSeenDaysAgo: number,
  opts: { genre: string; releaseDaysAgo?: number },
): Promise<void> {
  const releaseSql =
    opts.releaseDaysAgo === undefined
      ? "NULL"
      : `(now() - (${opts.releaseDaysAgo}::int::text || ' days')::interval)::date`;
  const gid = (
    await db.query(
      `INSERT INTO games(source_id, source_game_id, url, title, first_seen_at, last_seen_at, release_date, is_live)
       VALUES ($1,$2,$3,$4, now() - ($5::int::text || ' days')::interval, now(), ${releaseSql}, true) RETURNING id`,
      [sid, slug, `https://example.test/${slug}`, slug, firstSeenDaysAgo],
    )
  )[0].id;
  await db.query(
    `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre)
     VALUES ($1,$2, now(), 4.2, 500, $3)`,
    [gid, crawlId, opts.genre],
  );
}

beforeAll(async () => {
  db = await freshMemoryDb();
  await applySchema(db);
  const mkSource = async (name: string): Promise<number> =>
    (
      await db.query("INSERT INTO sources(name, base_url) VALUES ($1,$2) RETURNING id", [
        name,
        `https://${name}.example`,
      ])
    )[0].id;
  const mkCrawl = async (sid: number): Promise<number> =>
    (
      await db.query("INSERT INTO crawls(source_id, status) VALUES ($1,'ok') RETURNING id", [sid])
    )[0].id;

  const poki = await mkSource("poki");
  const pokiCrawl = await mkCrawl(poki);
  // poki's newest discovery is 40 days old; three titles fall inside poki's OWN 14-day window
  // ([now-54, now-40]) and its own 30-day supply window…
  await seedGame(poki, pokiCrawl, "poki-new-1", 40, { genre: "Puzzle" });
  await seedGame(poki, pokiCrawl, "poki-new-2", 46, { genre: "Puzzle" });
  await seedGame(poki, pokiCrawl, "poki-new-3", 52, { genre: "Puzzle" });
  // …and two sit well outside every poki window.
  await seedGame(poki, pokiCrawl, "poki-old-1", 75, { genre: "Puzzle" });
  await seedGame(poki, pokiCrawl, "poki-old-2", 95, { genre: "Puzzle" });

  const steam = await mkSource("steam");
  const steamCrawl = await mkCrawl(steam);
  // Steam discovered a game TODAY → Steam owns the global max first_seen_at.
  await seedGame(steam, steamCrawl, "steam-new-1", 0, { genre: "Puzzle", releaseDaysAgo: 0 });
  await seedGame(steam, steamCrawl, "steam-new-2", 10, { genre: "Puzzle", releaseDaysAgo: 10 });
  await seedGame(steam, steamCrawl, "steam-old-1", 30, { genre: "Puzzle", releaseDaysAgo: 30 });
}, 60000);

describe("#100 — the 14-day 'new' anchor is scoped per source", () => {
  it("getOverview newGames counts each platform from its OWN newest record", async () => {
    const poki = await q.getOverview(db, "poki");
    const steam = await q.getOverview(db, "steam");
    // poki's newest is 40d old; a global anchor (Steam = today) would read 0.
    expect(poki.kpi.newGames).toBe(3);
    // Steam owns the global max, so it is unaffected either way — 2 within its own window.
    expect(steam.kpi.newGames).toBe(2);
  });

  it("getNewReleases returns each platform's own-window cohort, not the global window", async () => {
    const poki = await q.getNewReleases(db, "poki");
    // 0 under a global anchor; the three poki entrants inside poki's own window otherwise.
    expect(poki.length).toBe(3);
    expect(poki.every((r) => r.title.startsWith("poki-new"))).toBe(true);
  });

  it("genreSupplyTrend (recentEntrants) anchors browser first_seen to the browser's own max", async () => {
    const genres = await q.getGenres(db, "poki");
    const puzzle = genres.find((g) => g.genre === "Puzzle");
    expect(puzzle).toBeTruthy();
    // 3 arrivals inside poki's own 30-day supply window; a global anchor (today) reads 0.
    expect(puzzle?.recentEntrants).toBe(3);
  });
});
