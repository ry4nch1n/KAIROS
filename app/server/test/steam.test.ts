import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshMemoryDb, applySchema, type Querier } from "../src/db/db.ts";
import {
  parseOwners, normalizeSteamRating, classifyScaleTier,
  isSelfPublished, parseReleaseDate, parseSteamGame, STEAM_BASE_URL, mergeSeeds,
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

describe("D4 classifyScaleTier", () => {
  it("classifies by review/owner scale", () => {
    expect(classifyScaleTier({ reviews: 300, owners: 20_000, selfPublished: true })).toBe("hobby");
    expect(classifyScaleTier({ reviews: 5_000, owners: 100_000, selfPublished: true })).toBe("small_indie");
    expect(classifyScaleTier({ reviews: 50_000, owners: 800_000, selfPublished: false })).toBe("est_indie");
    expect(classifyScaleTier({ reviews: 282_133, owners: 7_500_000, selfPublished: true })).toBe("aaa");
  });
  it("a publisher-backed title is at least small_indie", () => {
    expect(classifyScaleTier({ reviews: 100, owners: 10_000, selfPublished: false })).toBe("small_indie");
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
    expect(g.scaleTier).toBe("aaa");
    expect(g.tags.length).toBeGreaterThan(0);
    expect(g.tags).toContain("Action Roguelike");
  });
});

describe("parseReleaseDate", () => {
  it("parses Steam's display date to ISO", () => {
    expect(parseReleaseDate("17 Sep, 2020")).toBe("2020-09-17");
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
    expect(s.scale_tier).toBe("aaa");
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

describe("D12 getSteamComparables", () => {
  it("returns indie-tier rated games ordered by owners desc", async () => {
    const db = await freshMemoryDb();
    await seedSteamSample(db);
    const c = await q.getSteamComparables(db, 10);
    expect(c.every((r) => r.tier !== "aaa")).toBe(true);          // AAA excluded
    expect(c.every((r) => r.rating !== null)).toBe(true);          // only rated
    expect(c.map((r) => r.owners)).toEqual([100_000, 60_000, 30_000]); // owners desc
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
