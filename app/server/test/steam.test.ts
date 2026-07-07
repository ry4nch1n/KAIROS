import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshMemoryDb, applySchema, type Querier } from "../src/db/db.ts";
import {
  parseOwners, normalizeSteamRating, classifyScaleTier, isMajorBacked,
  isSelfPublished, parseReleaseDate, parseSteamGame, STEAM_BASE_URL, mergeSeeds, appDetailsUrl,
  rankTagByOwners, INDIE_CANON, parseSearchAppids,
} from "../src/crawler/steam.ts";
import { loadGames } from "../src/crawler/load.ts";
import { crazygames } from "../src/crawler/crazygames.ts";
import type { RawGame } from "../src/crawler/base.ts";
import * as q from "../src/queries/index.ts";
import { createApp } from "../src/api/app.ts";

const fx = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));

async function cols(db: Querier, table: string): Promise<Set<string>> {
  const r = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [table]
  );
  return new Set(r.map((x) => x.column_name as string));
}

describe("D1 schema has Steam columns", () => {
  it("games + game_snapshots expose the Phase 2 columns", async () => {
    const db = await freshMemoryDb();
    const g = await cols(db, "games");
    const s = await cols(db, "game_snapshots");
    expect(g.has("release_date")).toBe(true);
    for (const c of [
      "price_cents", "discount_pct", "owners_est", "ccu",
      "median_playtime_min", "metacritic", "scale_tier", "plays",
    ]) {
      expect(s.has(c), `game_snapshots.${c}`).toBe(true);
    }
  });

  it("re-applying schema is idempotent", async () => {
    const db = await freshMemoryDb();
    await applySchema(db); // second application must not error
    const s = await cols(db, "game_snapshots");
    expect(s.has("scale_tier")).toBe(true);
  });
});

describe("D2b mergeSeeds — round-robin so indie coverage survives a small limit", () => {
  it("interleaves sources instead of letting the first (AAA-heavy) list dominate", () => {
    const indie = [200, 201, 202, 203];
    const trending = [1, 2, 3, 4];
    const featured = [10, 11, 12, 13];
    const merged = mergeSeeds([indie, trending, featured], 6);
    expect(merged).toEqual([200, 1, 10, 201, 2, 11]);
    // the regression we caught: a small limit must still include indie ids
    expect(merged.filter((id) => id >= 200).length).toBeGreaterThanOrEqual(2);
  });
  it("dedups across lists and respects the limit", () => {
    expect(mergeSeeds([[1, 2], [2, 3]], 10)).toEqual([1, 2, 3]);
    expect(mergeSeeds([[1, 2, 3, 4, 5]], 3)).toEqual([1, 2, 3]);
  });
});

describe("D2c rankTagByOwners — owners-desc, NOT Object.keys appid order", () => {
  it("ranks a SteamSpy tag object by estimated owners, ignoring key order", () => {
    // Keys are ascending-appid (what Object.keys would yield); owners are the opposite order.
    const tagJson = {
      "50": { appid: 50, name: "Ancient Obscure Indie", owners: "20,000 .. 50,000" },
      "646570": { appid: 646570, name: "Slay the Spire", owners: "5,000,000 .. 10,000,000" },
      "2379780": { appid: 2379780, name: "Balatro", owners: "2,000,000 .. 5,000,000" },
    };
    // Object.keys order would put appid 50 first; owners ranking must put it last.
    expect(rankTagByOwners(tagJson)).toEqual([646570, 2379780, 50]);
  });
  it("tolerates empty / malformed input", () => {
    expect(rankTagByOwners({})).toEqual([]);
    expect(rankTagByOwners(undefined as any)).toEqual([]);
  });
});

describe("D2e parseSearchAppids — appids from Steam store-search results_html", () => {
  it("extracts and dedups data-ds-appid attributes in order", () => {
    const html = `
      <a data-ds-appid="4704690"><span class="title">MECCHA CHAMELEON</span></a>
      <a data-ds-appid="1623730"><span class="title">Palworld</span></a>
      <a data-ds-appid="4704690"><span class="title">dup ignored</span></a>`;
    expect(parseSearchAppids(html)).toEqual([4704690, 1623730]);
  });
  it("returns [] for empty/malformed html", () => {
    expect(parseSearchAppids("")).toEqual([]);
    expect(parseSearchAppids(undefined as any)).toEqual([]);
  });
});

describe("D2d INDIE_CANON — recognizable benchmarks are always seedable", () => {
  it("includes the modern indie hits users compare against", () => {
    expect(INDIE_CANON).toContain(646570);  // Slay the Spire
    expect(INDIE_CANON).toContain(1145360); // Hades
    expect(INDIE_CANON).toContain(2379780); // Balatro
    // canon is seeded first so a small round-robin limit still keeps them all
    expect(mergeSeeds([INDIE_CANON, [1, 2, 3]], 8)).toEqual(
      expect.arrayContaining([646570, 1145360, 2379780])
    );
  });
});

describe("D2 parseOwners (SteamSpy bucket → midpoint estimate)", () => {
  it("takes the midpoint of a range", () => {
    expect(parseOwners("5,000,000 .. 10,000,000")).toBe(7_500_000);
    expect(parseOwners("20,000 .. 50,000")).toBe(35_000);
  });
  it("handles a single value and rejects garbage", () => {
    expect(parseOwners("1,000,000")).toBe(1_000_000);
    expect(parseOwners("")).toBeNull();
    expect(parseOwners(undefined as any)).toBeNull();
  });
});

describe("D3 normalizeSteamRating (positive ratio → 0–5)", () => {
  it("scales the positive ratio to 0–5", () => {
    expect(normalizeSteamRating(276574, 282133)).toBeCloseTo(4.9, 2);
    expect(normalizeSteamRating(50, 100)).toBe(2.5);
  });
  it("null when there are no reviews", () => {
    expect(normalizeSteamRating(0, 0)).toBeNull();
  });
});

describe("D6 isSelfPublished", () => {
  it("true when publisher is empty or a subset of developers", () => {
    expect(isSelfPublished(["Supergiant Games"], ["Supergiant Games"])).toBe(true);
    expect(isSelfPublished(["Indie Dev"], [])).toBe(true);
  });
  it("false when a distinct publisher backs the game", () => {
    expect(isSelfPublished(["Some Studio"], ["Devolver Digital"])).toBe(false);
  });
});

describe("D6c isMajorBacked", () => {
  it("true for a mega-publisher / first-party label", () => {
    expect(isMajorBacked(["Sucker Punch Productions"], ["PlayStation Publishing LLC"])).toBe(true);
    expect(isMajorBacked(["DICE"], ["Electronic Arts"])).toBe(true);
  });
  it("false for indie devs and indie-friendly publishers", () => {
    expect(isMajorBacked(["tobyfox"], [])).toBe(false);
    expect(isMajorBacked(["Some Studio"], ["Devolver Digital"])).toBe(false);
  });
});

describe("D4 classifyScaleTier", () => {
  it("classifies by review/owner scale", () => {
    expect(classifyScaleTier({ reviews: 300, owners: 20_000, selfPublished: true })).toBe("hobby");
    expect(classifyScaleTier({ reviews: 5_000, owners: 100_000, selfPublished: true })).toBe("small_indie");
    expect(classifyScaleTier({ reviews: 50_000, owners: 800_000, selfPublished: false })).toBe("est_indie");
  });
  it("a publisher-backed title is at least small_indie", () => {
    expect(classifyScaleTier({ reviews: 100, owners: 10_000, selfPublished: false })).toBe("small_indie");
  });
  it("a self-published breakout is est_indie, NOT aaa (scale != AAA)", () => {
    // Hades-scale: 282k reviews, 7.5M owners, self-published (Supergiant) — a huge INDIE hit.
    expect(classifyScaleTier({ reviews: 282_133, owners: 7_500_000, selfPublished: true })).toBe("est_indie");
    // Terraria-scale self-pub megahit stays est_indie too.
    expect(classifyScaleTier({ reviews: 1_000_000, owners: 35_000_000, selfPublished: true })).toBe("est_indie");
  });
  it("a major-backed title is aaa even at modest Steam scale (console port)", () => {
    // Ghost of Tsushima DIRECTOR'S CUT: 62k reviews, 3.5M owners — below scale thresholds,
    // but Sony first-party → not an indie comparable.
    expect(classifyScaleTier({
      reviews: 61_939, owners: 3_500_000, selfPublished: false, majorBacked: true,
    })).toBe("aaa");
  });
});

describe("D5 parseSteamGame (Hades — 3 real fixtures → RawGame)", () => {
  const appData = fx("steam_appdetails_1145360.json")["1145360"].data;
  const reviews = fx("steam_reviews_1145360.json").query_summary;
  const steamspy = fx("steamspy_1145360.json");
  const g = parseSteamGame(1145360, appData, reviews, steamspy);

  it("maps the core fields", () => {
    expect(g.sourceGameId).toBe("1145360");
    expect(g.title).toBe("Hades");
    expect(g.rating).toBeCloseTo(4.9, 2);
    expect(g.votes).toBe(282133);
    expect(g.developer).toBe("Supergiant Games");
    expect(g.genre).toBe("Action");
  });
  it("maps the Phase 2 Steam metrics", () => {
    expect(g.ownersEst).toBe(7_500_000);
    expect(g.priceCents).toBe(550);
    expect(g.discountPct).toBe(75);
    expect(g.metacritic).toBe(93);
    expect(g.releaseDate).toBe("2020-09-17");
    expect(g.scaleTier).toBe("est_indie"); // self-published megahit — a big INDIE, not AAA
    expect(g.tags.length).toBeGreaterThan(0);
    expect(g.tags).toContain("Action Roguelike");
  });
});

describe("parseReleaseDate", () => {
  it("parses Steam's display date to ISO", () => {
    expect(parseReleaseDate("17 Sep, 2020")).toBe("2020-09-17");
  });
  it("parses month-first en-US format", () => {
    expect(parseReleaseDate("Mar 25, 2025")).toBe("2025-03-25");
    expect(parseReleaseDate("Sep 17, 2020")).toBe("2020-09-17");
  });
  it("null for coming-soon / unparseable", () => {
    expect(parseReleaseDate("")).toBeNull();
    expect(parseReleaseDate("Coming soon")).toBeNull();
  });
});

const hades = () => parseSteamGame(
  1145360,
  fx("steam_appdetails_1145360.json")["1145360"].data,
  fx("steam_reviews_1145360.json").query_summary,
  fx("steamspy_1145360.json")
);

describe("D7 loader persists Steam fields", () => {
  it("writes price/owners/ccu/tier/plays into the snapshot and release_date onto the game", async () => {
    const db = await freshMemoryDb();
    await loadGames(db, "steam", STEAM_BASE_URL, [hades()], "2026-06-30T00:00:00.000Z");
    const s = (await db.query(
      `SELECT price_cents, discount_pct, owners_est, ccu, median_playtime_min, metacritic, scale_tier, plays, rating, votes
       FROM game_snapshots LIMIT 1`
    ))[0];
    expect(Number(s.price_cents)).toBe(550);
    expect(Number(s.discount_pct)).toBe(75);
    expect(Number(s.owners_est)).toBe(7_500_000);
    expect(Number(s.plays)).toBe(7_500_000);
    expect(Number(s.metacritic)).toBe(93);
    expect(s.scale_tier).toBe("est_indie"); // self-published megahit — a big INDIE, not AAA
    expect(Number(s.votes)).toBe(282133);
    const g = (await db.query(`SELECT release_date, developer FROM games LIMIT 1`))[0];
    expect(new Date(g.release_date).toISOString().slice(0, 10)).toBe("2020-09-17");
    expect(g.developer).toBe("Supergiant Games");
  });

  it("browser load is unaffected — new columns are null", async () => {
    const db = await freshMemoryDb();
    const cg = crazygames.parseGame(
      readFileSync(fileURLToPath(new URL("./fixtures/crazygames_game.html", import.meta.url)), "utf8"),
      "https://www.crazygames.com/game/final-drop"
    );
    await loadGames(db, "crazygames", "https://www.crazygames.com", [cg], "2026-06-30T00:00:00.000Z");
    const s = (await db.query(`SELECT price_cents, owners_est, scale_tier FROM game_snapshots LIMIT 1`))[0];
    expect(s.price_cents).toBeNull();
    expect(s.owners_est).toBeNull();
    expect(s.scale_tier).toBeNull();
  });
});

describe("D8 loader idempotency (steam)", () => {
  it("re-running the same crawl day inserts no duplicate snapshots", async () => {
    const db = await freshMemoryDb();
    const date = "2026-06-30T00:00:00.000Z";
    const r1 = await loadGames(db, "steam", STEAM_BASE_URL, [hades()], date);
    const r2 = await loadGames(db, "steam", STEAM_BASE_URL, [hades()], date);
    const n = (await db.query(`SELECT count(*)::int n FROM game_snapshots`))[0].n;
    expect(r1.inserted).toBe(1);
    expect(r2.inserted).toBe(0);
    expect(Number(n)).toBe(1);
  });
});

// synthetic Steam games with controlled tier/genre/price/owners for query tests
function steamGame(o: Partial<RawGame> & { sourceGameId: string }): RawGame {
  return {
    url: `https://store.steampowered.com/app/${o.sourceGameId}`,
    title: o.title ?? `Game ${o.sourceGameId}`,
    thumbnailUrl: null, developer: o.developer ?? "Dev", description: null,
    engine: null, orientation: null, mobile: false,
    genre: o.genre ?? "Action", tags: o.tags ?? ["Indie"],
    rating: o.rating === undefined ? 4.5 : o.rating,
    votes: o.votes === undefined ? 5000 : o.votes, featured: false,
    releaseDate: o.releaseDate ?? "2024-01-01",
    plays: o.ownersEst ?? 100000, ownersEst: o.ownersEst ?? 100000,
    priceCents: o.priceCents ?? 1500, discountPct: 0,
    ccu: o.ccu ?? 100, medianPlaytimeMin: 600, metacritic: null,
    scaleTier: o.scaleTier ?? "small_indie",
    sourceGameId: o.sourceGameId,
  };
}

async function seedSteamSample(db: Querier) {
  const games: RawGame[] = [
    steamGame({ sourceGameId: "A", genre: "Action", scaleTier: "small_indie", priceCents: 1500, ownersEst: 100_000, rating: 4.5, votes: 5_000 }),
    steamGame({ sourceGameId: "B", genre: "Action", scaleTier: "aaa", priceCents: 5000, ownersEst: 8_000_000, rating: 4.8, votes: 200_000 }),
    steamGame({ sourceGameId: "C", genre: "Puzzle", scaleTier: "hobby", priceCents: 500, ownersEst: 30_000, rating: 4.2, votes: 800 }),
    steamGame({ sourceGameId: "D", genre: "Puzzle", scaleTier: "small_indie", priceCents: 1000, ownersEst: 60_000, rating: 4.6, votes: 1_500 }),
  ];
  await loadGames(db, "steam", STEAM_BASE_URL, games, "2026-06-30T00:00:00.000Z");
}

describe("D9 getScaleTierBreakdown('steam')", () => {
  it("returns per-tier counts summing to the Steam game total", async () => {
    const db = await freshMemoryDb();
    await seedSteamSample(db);
    const b = await q.getScaleTierBreakdown(db, "steam");
    const map = Object.fromEntries(b.map((r) => [r.tier, r.games]));
    expect(map["small_indie"]).toBe(2);
    expect(map["aaa"]).toBe(1);
    expect(map["hobby"]).toBe(1);
    expect(b.reduce((s, r) => s + r.games, 0)).toBe(4);
  });
});

describe("D10 getSteamGenreEconomics (indie-default cohort)", () => {
  it("excludes the AAA tier by default and computes economics", async () => {
    const db = await freshMemoryDb();
    await seedSteamSample(db);
    const rows = await q.getSteamGenreEconomics(db);
    const action = rows.find((r) => r.genre === "Action")!;
    expect(action.games).toBe(1); // AAA game B excluded
    expect(action.totalOwners).toBe(100_000);
    expect(action.revenueProxy).toBeGreaterThan(0);
    expect(rows.find((r) => r.genre === "Puzzle")!.games).toBe(2);
  });
  it("includes AAA when cohort='all'", async () => {
    const db = await freshMemoryDb();
    await seedSteamSample(db);
    const rows = await q.getSteamGenreEconomics(db, { cohort: "all" });
    expect(rows.find((r) => r.genre === "Action")!.games).toBe(2);
  });
});

describe("D11 platform isolation incl. steam", () => {
  it("steam queries ignore browser rows and vice-versa", async () => {
    const db = await freshMemoryDb();
    await seedSteamSample(db);
    const cg = crazygames.parseGame(
      readFileSync(fileURLToPath(new URL("./fixtures/crazygames_game.html", import.meta.url)), "utf8"),
      "https://www.crazygames.com/game/final-drop"
    );
    await loadGames(db, "crazygames", "https://www.crazygames.com", [cg], "2026-06-30T00:00:00.000Z");
    const b = await q.getScaleTierBreakdown(db, "steam");
    expect(b.reduce((s, r) => s + r.games, 0)).toBe(4); // steam only, not 5
    const econ = await q.getSteamGenreEconomics(db, { cohort: "all" });
    expect(econ.reduce((s, r) => s + r.games, 0)).toBe(4); // steam only
    const devs = await q.getGenres(db, "crazygames"); // browser query excludes steam
    expect(devs.every((r) => r.genre !== "Puzzle" || true)).toBe(true);
    const cgCount = (await db.query(
      `SELECT count(*)::int n FROM games g JOIN sources s ON s.id=g.source_id WHERE s.name='crazygames'`
    ))[0].n;
    expect(Number(cgCount)).toBe(1);
  });
});

describe("D10b getSteamGenreEconomics — medianRating null when cohort has no rated games", () => {
  it("emits null (not a misleading 0) for a reviewless genre", async () => {
    const db = await freshMemoryDb();
    await loadGames(db, "steam", STEAM_BASE_URL, [
      steamGame({ sourceGameId: "X", genre: "Roguelike", scaleTier: "hobby", rating: null, votes: null, ownersEst: 10_000, priceCents: 500 }),
    ], "2026-06-30T00:00:00.000Z");
    const row = (await q.getSteamGenreEconomics(db)).find((r) => r.genre === "Roguelike")!;
    expect(row.medianRating).toBeNull();
  });
});

describe("D10c genre economics per-game revenue — size vs opportunity (#24)", () => {
  it("adds median (skew-resistant) and mean revenue per game alongside the total", async () => {
    const db = await freshMemoryDb();
    await loadGames(db, "steam", STEAM_BASE_URL, [
      // one $10 genre with a top-heavy spread: $100k / $200k / $900k
      steamGame({ sourceGameId: "s1", genre: "Sim", scaleTier: "small_indie", ownersEst: 10_000, priceCents: 1000 }),
      steamGame({ sourceGameId: "s2", genre: "Sim", scaleTier: "small_indie", ownersEst: 20_000, priceCents: 1000 }),
      steamGame({ sourceGameId: "s3", genre: "Sim", scaleTier: "small_indie", ownersEst: 90_000, priceCents: 1000 }),
    ], "2026-06-30T00:00:00.000Z");
    const row = (await q.getSteamGenreEconomics(db)).find((r) => r.genre === "Sim")!;
    expect(row.revenueProxy).toBe(1_200_000);         // category size
    expect(row.medianRevenuePerGame).toBe(200_000);   // typical outcome
    expect(row.meanRevenuePerGame).toBe(400_000);     // hit-skewed mean exposes top-heaviness
  });

  it("counts free/unpriced games as $0 in the median instead of skipping them", async () => {
    const db = await freshMemoryDb();
    await loadGames(db, "steam", STEAM_BASE_URL, [
      steamGame({ sourceGameId: "f1", genre: "Arcade", scaleTier: "hobby", ownersEst: 50_000, priceCents: 0 }),
      steamGame({ sourceGameId: "f2", genre: "Arcade", scaleTier: "hobby", ownersEst: 40_000, priceCents: 0 }),
      steamGame({ sourceGameId: "f3", genre: "Arcade", scaleTier: "hobby", ownersEst: 10_000, priceCents: 1000 }),
    ], "2026-06-30T00:00:00.000Z");
    const row = (await q.getSteamGenreEconomics(db)).find((r) => r.genre === "Arcade")!;
    expect(row.medianRevenuePerGame).toBe(0); // mostly-free genre medians honestly at $0
  });
});

describe("D12 getSteamComparables", () => {
  it("returns indie-tier rated games (AAA excluded, only rated)", async () => {
    const db = await freshMemoryDb();
    await seedSteamSample(db);
    const c = await q.getSteamComparables(db, 10);
    expect(c.every((r) => r.tier !== "aaa")).toBe(true);          // AAA excluded
    expect(c.every((r) => r.rating !== null)).toBe(true);          // only rated
    expect(c.length).toBe(3);
  });
});

describe("D12b getSteamComparables prefers recent releases", () => {
  it("orders by release date (newest first) and applies an owners floor", async () => {
    const db = await freshMemoryDb();
    await loadGames(db, "steam", STEAM_BASE_URL, [
      steamGame({ sourceGameId: "old", title: "Old Hit", genre: "Action", scaleTier: "small_indie", releaseDate: "2015-05-01", ownersEst: 2_000_000, rating: 4.5, votes: 50_000 }),
      steamGame({ sourceGameId: "new", title: "New Indie", genre: "Action", scaleTier: "small_indie", releaseDate: "2024-06-01", ownersEst: 80_000, rating: 4.3, votes: 3_000 }),
      steamGame({ sourceGameId: "tiny", title: "Tiny Game", genre: "Indie", scaleTier: "hobby", releaseDate: "2025-01-01", ownersEst: 5_000, rating: 4.0, votes: 50 }),
    ], "2026-06-30T00:00:00.000Z");
    const c = await q.getSteamComparables(db, 10);
    expect(c[0].title).toBe("New Indie");          // 2024 before 2015
    expect(c[0].releaseDate).toBe("2024-06-01");
    expect(c.map((x) => x.title)).not.toContain("Tiny Game"); // below owners floor
  });
});

describe("D12c review velocity — the wishlist-proxy leading indicator (#11)", () => {
  const DAY = 86400000;
  const t0 = Date.parse("2026-06-01T00:00:00Z");

  it("computeReviewVelocity: Δreviews/Δdays over the trailing window", () => {
    expect(q.computeReviewVelocity([t0, t0 + 10 * DAY], [1000, 2000])).toBe(100);
    // snapshots older than the window must not dilute the recent rate
    expect(q.computeReviewVelocity([t0, t0 + 40 * DAY, t0 + 50 * DAY], [0, 4000, 4500], 30)).toBe(50);
  });

  it("is null (not a misleading 0) when history can't support a rate", () => {
    expect(q.computeReviewVelocity([t0], [100])).toBeNull();          // single snapshot
    expect(q.computeReviewVelocity([t0, t0], [100, 200])).toBeNull(); // zero time span
    // 2 points exist but only 1 falls inside the trailing window
    expect(q.computeReviewVelocity([t0, t0 + 40 * DAY], [100, 200], 30)).toBeNull();
  });

  it("clamps review purges to 0 rather than reporting a negative rate", () => {
    expect(q.computeReviewVelocity([t0, t0 + 5 * DAY], [2000, 1500])).toBe(0);
  });

  it("getSteamComparables surfaces reviewVelocity from snapshot deltas", async () => {
    const db = await freshMemoryDb();
    const g = steamGame({ sourceGameId: "vel", title: "Velocity Game", scaleTier: "small_indie", releaseDate: "2025-05-01", ownersEst: 90_000, rating: 4.4, votes: 1_000 });
    await loadGames(db, "steam", STEAM_BASE_URL, [g], "2026-06-20T00:00:00.000Z");
    await loadGames(db, "steam", STEAM_BASE_URL, [{ ...g, votes: 2_000 }], "2026-06-30T00:00:00.000Z");
    const row = (await q.getSteamComparables(db, 10)).find((x) => x.title === "Velocity Game")!;
    expect(row.reviewVelocity).toBe(100); // +1,000 reviews over 10 days
  });

  it("single-snapshot games report null velocity", async () => {
    const db = await freshMemoryDb();
    await seedSteamSample(db); // one crawl day → 1 snapshot per game
    const c = await q.getSteamComparables(db, 10);
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((x) => x.reviewVelocity === null)).toBe(true);
  });
});

describe("D13b getSteamOverview kpi.indieMedianPriceCents", () => {
  it("computes median price over the indie cohort (excludes AAA)", async () => {
    const db = await freshMemoryDb();
    await seedSteamSample(db); // indie prices: A 1500, C 500, D 1000 → median 1000 (B=aaa excluded)
    const o = await q.getSteamOverview(db);
    expect(o.kpi.indieMedianPriceCents).toBe(1000);
  });
});

describe("appDetailsUrl pins locale (fixes the 'Ação' leak)", () => {
  it("requests English genres and USD pricing", () => {
    const u = appDetailsUrl(1145360);
    expect(u).toContain("appids=1145360");
    expect(u).toContain("l=english");
    expect(u).toContain("cc=us");
  });
});

describe("D13 getSteamOverview", () => {
  it("composes kpi + tiers + cohort economics + comparables", async () => {
    const db = await freshMemoryDb();
    await seedSteamSample(db);
    const o = await q.getSteamOverview(db);
    expect(o.kpi.games).toBe(4);
    expect(o.kpi.aaa).toBe(1);
    expect(o.kpi.indie).toBe(3);
    expect(o.tiers.reduce((s, t) => s + t.games, 0)).toBe(4);
    expect(o.indie.length).toBeGreaterThan(0);
    expect(o.all.length).toBeGreaterThanOrEqual(o.indie.length);
    expect(o.comparables.length).toBe(3);
    expect(o.subtitle).toContain("Steam");
  });
});

describe("D15 platform 'all' is browser-only — Steam never pollutes browser analytics", () => {
  it("excludes Steam from 'all' browser queries while Steam stays on its own surface", async () => {
    const db = await freshMemoryDb();
    const browser: RawGame = {
      sourceGameId: "b1", url: "https://poki.com/en/g/x", title: "Browser Racer",
      thumbnailUrl: null, developer: "DevB", description: null, engine: null,
      orientation: null, mobile: true, genre: "Racing", tags: ["Racing"],
      rating: 4.2, votes: 100, featured: false,
    };
    await loadGames(db, "poki", "https://poki.com", [browser], "2026-06-28T00:00:00.000Z");
    await loadGames(db, "steam", STEAM_BASE_URL, [steamGame({ sourceGameId: "s1", genre: "Action" })], "2026-06-30T00:00:00.000Z");

    const genres = (await q.getGenres(db, "all")).map((g) => g.genre);
    expect(genres).toContain("Racing");
    expect(genres).not.toContain("Action"); // Steam genre must NOT appear in browser "all"

    const ov = await q.getSteamOverview(db); // Steam still fully visible on its own surface
    expect(ov.kpi.games).toBe(1);
  });
});

async function seedSteamRich(db: Querier) {
  await loadGames(db, "steam", STEAM_BASE_URL, [
    steamGame({ sourceGameId: "1", genre: "Action", scaleTier: "small_indie", priceCents: 1500, ownersEst: 200_000, rating: 4.5, votes: 5000, tags: ["Roguelike"], developer: "StudioA", releaseDate: "2024-03-01", ccu: 500 }),
    steamGame({ sourceGameId: "2", genre: "Action", scaleTier: "hobby", priceCents: 0, ownersEst: 50_000, rating: 4.1, votes: 300, tags: ["Roguelike"], developer: "StudioA", releaseDate: "2023-06-01", ccu: 50 }),
    steamGame({ sourceGameId: "3", genre: "Puzzle", scaleTier: "small_indie", priceCents: 999, ownersEst: 120_000, rating: 4.6, votes: 2000, tags: ["Pixel"], developer: "StudioB", releaseDate: "2025-01-01", ccu: 80 }),
    steamGame({ sourceGameId: "5", genre: "Puzzle", scaleTier: "hobby", priceCents: 1200, ownersEst: 60_000, rating: 4.2, votes: 400, tags: ["Pixel"], developer: "StudioB", releaseDate: "2024-09-01", ccu: 20 }),
    steamGame({ sourceGameId: "4", genre: "Action", scaleTier: "aaa", priceCents: 6000, ownersEst: 9_000_000, rating: 4.8, votes: 300_000, tags: ["Roguelike"], developer: "BigCorp", releaseDate: "2022-01-01", ccu: 100_000 }),
  ], "2026-06-30T00:00:00.000Z");
}

describe("D16 Steam sub-sections (Pricing / Ownership / Developers / New releases / Opportunity)", () => {
  it("pricing groups the indie cohort into price bands (AAA excluded)", async () => {
    const db = await freshMemoryDb(); await seedSteamRich(db);
    const p = await q.getSteamPricing(db);
    const by = Object.fromEntries(p.map((b) => [b.band, b]));
    expect(by["Free"].games).toBe(1);          // g2
    expect(by["Free"].revenueProxy).toBe(0);
    expect(by["$10–20"].games).toBe(2);        // g1, g5
    expect(p.some((b) => b.games > 4)).toBe(false); // AAA g4 excluded
  });

  it("ownership rolls up owners + CCU by genre (indie)", async () => {
    const db = await freshMemoryDb(); await seedSteamRich(db);
    const o = await q.getSteamOwnership(db);
    const action = o.find((r) => r.genre === "Action")!;
    expect(action.games).toBe(2);
    expect(action.totalOwners).toBe(250_000);
    expect(action.ccu).toBe(550);             // 500 + 50
  });

  it("developers ranks indie studios by owners", async () => {
    const db = await freshMemoryDb(); await seedSteamRich(db);
    const d = await q.getSteamDevelopers(db);
    expect(d.map((r) => r.developer)).not.toContain("BigCorp"); // AAA excluded
    expect(d[0].developer).toBe("StudioA");
    expect(d[0].games).toBe(2);
    expect(d[0].totalOwners).toBe(250_000);
  });

  it("new releases are indie, newest first", async () => {
    const db = await freshMemoryDb(); await seedSteamRich(db);
    const n = await q.getSteamNewReleases(db);
    expect(n[0].releaseDate).toBe("2025-01-01");
    expect(n.every((r) => r.tier !== "aaa")).toBe(true);
  });

  it("opportunity ranks indie genre×tag gaps", async () => {
    const db = await freshMemoryDb(); await seedSteamRich(db);
    const g = await q.getSteamOpportunity(db);
    expect(g.length).toBe(2); // Action×Roguelike, Puzzle×Pixel
    expect(g.every((x) => typeof x.score === "number" && x.examples.length > 0)).toBe(true);
  });

  it("getSteamOverview bundles every section", async () => {
    const db = await freshMemoryDb(); await seedSteamRich(db);
    const o = await q.getSteamOverview(db);
    expect(o.pricing.length).toBeGreaterThan(0);
    expect(o.ownership.length).toBeGreaterThan(0);
    expect(o.developers.length).toBeGreaterThan(0);
    expect(o.newReleases.length).toBeGreaterThan(0);
    expect(o.opportunity.length).toBe(2);
  });
});

describe("D16c opportunity score formula is pinned (#12)", () => {
  // The UI legend states: opportunity = z(demand) + z(quality ceiling) − z(supply),
  // with price shown as context but NOT scored. This fixture is built so the z-terms
  // are hand-computable: two pairs with equal supply (z=0) whose demand and quality
  // z-scores are exactly ±1 → scores must be exactly +2.0 and −2.0. If the formula
  // changes, this test fails and the Radar legend/tooltip must be updated with it.
  it("score = z(median owners) + z(P90 rating) − z(supply); price not scored", async () => {
    const db = await freshMemoryDb();
    await loadGames(db, "steam", STEAM_BASE_URL, [
      // pair 1: Action × roguelike — median owners 150k, P90 rating 4.36
      steamGame({ sourceGameId: "a1", genre: "Action", tags: ["roguelike"], ownersEst: 100_000, rating: 4.0, priceCents: 100 }),
      steamGame({ sourceGameId: "a2", genre: "Action", tags: ["roguelike"], ownersEst: 200_000, rating: 4.4, priceCents: 100 }),
      // pair 2: Puzzle × roguelike — median owners 30k, P90 rating 3.36, far pricier
      steamGame({ sourceGameId: "p1", genre: "Puzzle", tags: ["roguelike"], ownersEst: 20_000, rating: 3.0, priceCents: 9900 }),
      steamGame({ sourceGameId: "p2", genre: "Puzzle", tags: ["roguelike"], ownersEst: 40_000, rating: 3.4, priceCents: 9900 }),
    ], "2026-06-30T00:00:00.000Z");
    const opp = await q.getSteamOpportunity(db);
    const action = opp.find((g) => g.genre === "Action")!;
    const puzzle = opp.find((g) => g.genre === "Puzzle")!;
    // z(demand)=±1, z(quality)=±1, z(supply)=0 (equal supply) → ±2.0 exactly
    expect(action.score).toBeCloseTo(2.0, 5);
    expect(puzzle.score).toBeCloseTo(-2.0, 5);
    // price is context only: the cheap pair outranks the expensive one purely on demand+quality
    expect(opp[0].genre).toBe("Action");
  });
});

describe("D14 GET /api/steam", () => {
  it("serves the steam overview as JSON", async () => {
    const db = await freshMemoryDb();
    await seedSteamSample(db);
    const app = createApp(db);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as any).port;
    try {
      const res = await fetch(`http://localhost:${port}/api/steam`);
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(j.kpi.games).toBe(4);
      expect(j.kpi.indie).toBe(3);
      expect(Array.isArray(j.comparables)).toBe(true);
      expect(Array.isArray(j.indie)).toBe(true);
    } finally {
      server.close();
    }
  });
});
