// Upcoming (unreleased) follower demand — #54's read half, filed as #164. Load-bearing: an
// unmeasurable rate is null and never 0 (a fake "0/day" reads as "stopped growing", not as "we
// don't know yet"), and surfacing this cohort must not leak it into a released analytic.
import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { loadGames } from "../src/crawler/load.ts";
import type { RawGame } from "../src/crawler/base.ts";
import {
  FOLLOWER_HISTORY_DEPTH,
  FOLLOWER_MAX_WINDOW_DAYS,
  followerTraction,
  getSteamUpcoming,
  getSteamNewReleases,
  getSteamComparables,
} from "../src/queries/steam.ts";

const snap = (followers: number | null, d: string) => ({ followers, capturedAt: `${d}T00:00:00Z` });

describe("#164 followerTraction (pure)", () => {
  it("reads followers/day from two measured snapshots", () => {
    expect(followerTraction([snap(1200, "2026-08-13"), snap(1000, "2026-08-11")])).toEqual({
      followers: 1200,
      followerVelocity: 100,
      followerWindowDays: 2,
    });
  });

  it("below two measured snapshots the rate is NULL, never 0", () => {
    const nulls = { followers: null, followerVelocity: null, followerWindowDays: null };
    expect(followerTraction([])).toEqual(nulls);
    expect(followerTraction([snap(null, "2026-08-13")])).toEqual(nulls);
    expect(followerTraction([snap(4180, "2026-08-13")])).toEqual({ ...nulls, followers: 4180 });
  });

  it("a shrinking audience reads negative, not clamped", () => {
    expect(
      followerTraction([snap(900, "2026-08-13"), snap(1000, "2026-08-12")]).followerVelocity,
    ).toBe(-100);
  });

  it("skips a day whose follower fetch failed rather than reporting a fake 0/day", () => {
    const t = followerTraction([
      snap(1300, "2026-08-13"),
      snap(null, "2026-08-12"),
      snap(1000, "2026-08-11"),
    ]);
    expect(t).toMatchObject({ followerVelocity: 150, followerWindowDays: 2 }); // window widens
  });

  it("#201: with a week+ of snapshots it measures the LONGEST window, not the shortest", () => {
    // Nine daily snapshots, 2026-08-05 … 08-13, +100/day except a noisy last day (+700).
    const days = Array.from({ length: 9 }, (_, i) => `2026-08-${String(5 + i).padStart(2, "0")}`);
    const snaps = days.map((d, i) => snap(i === 8 ? 2400 : 1000 + i * 100, d));
    const t = followerTraction(snaps);
    expect(t).toMatchObject({ followers: 2400, followerWindowDays: 8, followerVelocity: 175 });
  });

  it("#201: caps the window at FOLLOWER_MAX_WINDOW_DAYS — older snapshots are excluded", () => {
    expect(FOLLOWER_MAX_WINDOW_DAYS).toBe(14);
    const t = followerTraction([
      snap(3000, "2026-08-31"),
      snap(1600, "2026-08-17"), // exactly 14 days back — the longest allowed
      snap(1500, "2026-08-16"), // 15 days back — excluded
      snap(0, "2026-06-01"), // stale row — must not stretch the window
    ]);
    expect(t).toMatchObject({ followerWindowDays: 14, followerVelocity: 100 });
  });

  it("#201: only snapshots older than the cap → null rate (never a stretched window or 0)", () => {
    const t = followerTraction([snap(3000, "2026-08-31"), snap(1000, "2026-07-01")]);
    expect(t).toEqual({ followers: 3000, followerVelocity: null, followerWindowDays: null });
  });

  it("#201: the history depth can fill the full cap on a daily crawl", () => {
    expect(FOLLOWER_HISTORY_DEPTH).toBeGreaterThanOrEqual(FOLLOWER_MAX_WINDOW_DAYS + 1);
  });

  it("ignores a same-day re-crawl, whose near-zero window would invent a wild rate", () => {
    const t = followerTraction([
      { followers: 1010, capturedAt: "2026-08-13T18:00:00Z" },
      { followers: 1000, capturedAt: "2026-08-13T12:00:00Z" },
    ]);
    expect(t.followerVelocity).toBeNull();
  });
});

// Steam-only fields are optional on RawGame, so an unreleased row is the SHORT one: no rating, no
// owners, no price, no release date. `comingSoon` defaults on here; the released control overrides.
const NULLS = { thumbnailUrl: null, description: null, engine: null, orientation: null };
const game = (o: Partial<RawGame> & { sourceGameId: string; title: string }): RawGame => ({
  ...NULLS,
  url: `https://store.steampowered.com/app/${o.sourceGameId}`,
  developer: "Studio",
  mobile: false,
  genre: "Indie",
  tags: ["indie"],
  rating: null,
  votes: null,
  featured: false,
  comingSoon: true,
  ...o,
});
const SHIPPED = game({
  sourceGameId: "1",
  title: "Shipped",
  comingSoon: false,
  releaseDate: "2026-01-15",
  scaleTier: "small_indie",
  rating: 4.5,
  votes: 500,
  ownersEst: 50_000,
  priceCents: 1499,
});
const UNMEASURED = game({ sourceGameId: "4", title: "Unmeasured" }); // coming-soon, never read
describe("#164 getSteamUpcoming", () => {
  let db: Querier;
  beforeAll(async () => {
    db = await freshMemoryDb();
    const base = "https://store.steampowered.com";
    const climbing = (followers: number) =>
      game({ sourceGameId: "2", title: "Climbing", followers, priceCents: 1999 });
    // Two crawl days: "Climbing" is measured on both, "OneDay" only on the second.
    await loadGames(db, "steam", base, [SHIPPED, climbing(1000), UNMEASURED], "2026-08-11");
    await loadGames(
      db,
      "steam",
      base,
      [SHIPPED, climbing(1600), game({ sourceGameId: "3", title: "OneDay", followers: 8000 })],
      "2026-08-13",
    );
  }, 60000);

  it("returns the coming-soon cohort, most-followed first, with a rate off consecutive snapshots", async () => {
    const rows = await getSteamUpcoming(db);
    expect(rows.map((r) => r.title)).toEqual(["OneDay", "Climbing", "Unmeasured"]);
    expect(rows[1]).toMatchObject({
      followers: 1600,
      followerVelocity: 300, // 600 over 2 days
      followerWindowDays: 2,
      priceCents: 1999,
    });
    // One snapshot → a total with a null rate; none → all null. Neither is 0.
    expect(rows[0]).toMatchObject({ followers: 8000, followerVelocity: null });
    expect(rows[2]).toMatchObject({ followers: null, followerVelocity: null });
  });

  it("released analytics are untouched — the cohort does not leak", async () => {
    const [news, comps] = await Promise.all([getSteamNewReleases(db), getSteamComparables(db)]);
    expect(news.map((r) => r.title)).toEqual(["Shipped"]);
    expect(comps.every((c) => c.title === "Shipped")).toBe(true);
    // And no released row grew a follower field it cannot honestly fill.
    expect(Object.keys(news[0])).not.toContain("followers");
  });

  it("an empty cohort is an empty list, not a throw", async () => {
    await expect(getSteamUpcoming(await freshMemoryDb())).resolves.toEqual([]);
  }, 60000);
});
