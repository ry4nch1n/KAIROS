// Unreleased / "coming soon" ingestion (#54 part 2). Two things are load-bearing and easy to
// regress: (a) an unshipped title must never acquire a release_date — Steam hands out real,
// PARSEABLE future dates, which would sort every unshipped game above every shipped one in the
// recency orderings; (b) it must stay out of the analytics that describe released titles.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { loadGames } from "../src/crawler/load.ts";
import type { RawGame } from "../src/crawler/base.ts";
import { isComingSoon, parseSteamGame } from "../src/crawler/steam.ts";
import {
  getSteamComparables,
  getSteamNewReleases,
  getSteamPricing,
  getScaleTierBreakdown,
} from "../src/queries/steam.ts";

const fx = (n: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), "utf8"));
// Real captured appdetails for IRON NEST (2950790), a genuinely unreleased title whose
// release_date is { coming_soon: true, date: "Aug 6, 2026" } — the parseable-future-date trap.
const UPCOMING = fx("steam_appdetails_2950790.json")["2950790"].data;
const RELEASED = fx("steam_appdetails_1145360.json")["1145360"].data; // Hades

describe("#54b coming-soon parsing", () => {
  it("reads the flag, never the date string", () => {
    expect(isComingSoon(UPCOMING)).toBe(true);
    expect(isComingSoon(RELEASED)).toBe(false);
    expect(isComingSoon({})).toBe(false);
  });

  it("an unreleased title has NO release date and NO scale tier", () => {
    const g = parseSteamGame(2950790, UPCOMING, {}, {});
    expect(g.comingSoon).toBe(true);
    // "Aug 6, 2026" parses cleanly — the flag is what stops it becoming a claimed release.
    expect(g.releaseDate).toBeNull();
    // Scale is a measured outcome; with no reviews and no owners there is nothing to measure.
    expect(g.scaleTier).toBeNull();
    expect(g.title).toContain("IRON NEST");
  });

  it("a released title is unchanged", () => {
    const g = parseSteamGame(1145360, RELEASED, { total_reviews: 300, total_positive: 290 }, {});
    expect(g.comingSoon).toBe(false);
    expect(g.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(g.scaleTier).not.toBeNull();
  });
});

// A null-dated / unreleased row loaded alongside real ones must not reorder or blank anything.
const steamGame = (o: Partial<RawGame> & { sourceGameId: string; title: string }): RawGame => ({
  url: `https://store.steampowered.com/app/${o.sourceGameId}`,
  thumbnailUrl: null,
  developer: "Studio",
  description: null,
  engine: null,
  orientation: null,
  mobile: false,
  genre: "Indie",
  tags: ["indie"],
  rating: 4.5,
  votes: 500,
  featured: false,
  plays: 50_000,
  ownersEst: 50_000,
  priceCents: 1499,
  scaleTier: "small_indie",
  ...o,
});

describe("#54b an unreleased row does not corrupt released-title analytics", () => {
  let db: Querier;
  let baseline: { comparables: string[]; newReleases: string[]; priced: number; tiers: number };

  beforeAll(async () => {
    db = await freshMemoryDb();
    const released: RawGame[] = [
      steamGame({ sourceGameId: "1", title: "Older", releaseDate: "2025-02-10" }),
      steamGame({ sourceGameId: "2", title: "Newer", releaseDate: "2025-11-20" }),
      steamGame({ sourceGameId: "3", title: "Newest", releaseDate: "2026-01-15" }),
    ];
    await loadGames(db, "steam", "https://store.steampowered.com", released, "2026-08-01");
    baseline = await read(db);
    // Now add the unreleased title — announced for a date LATER than every shipped one, with
    // no rating, no owners and no price: exactly the row that would top a recency sort and
    // drag every median down if it leaked into the released cohort.
    await loadGames(
      db,
      "steam",
      "https://store.steampowered.com",
      [
        steamGame({
          sourceGameId: "9",
          title: "Unshipped",
          releaseDate: null,
          comingSoon: true,
          scaleTier: null,
          rating: null,
          votes: null,
          plays: null,
          ownersEst: null,
          priceCents: null,
          followers: 44_182,
        }),
      ],
      "2026-08-02",
    );
  }, 60000);

  const read = async (d: Querier) => ({
    comparables: (await getSteamComparables(d)).map((r) => r.title),
    newReleases: (await getSteamNewReleases(d)).map((r) => r.title),
    priced: (await getSteamPricing(d)).reduce((s, b) => s + b.games, 0),
    tiers: (await getScaleTierBreakdown(d, "steam")).reduce((s, t) => s + t.games, 0),
  });

  it("release_date is stored NULL and coming_soon TRUE", async () => {
    const r = (
      await db.query(
        `SELECT g.release_date, l.coming_soon, l.followers FROM v_latest l
         JOIN games g ON g.id = l.game_id WHERE g.source_game_id = '9'`,
      )
    )[0];
    expect(r.release_date).toBeNull();
    expect(r.coming_soon).toBe(true);
    expect(Number(r.followers)).toBe(44_182); // the whole point: it DOES carry demand
  });

  it("recency ordering and every released-cohort aggregate are byte-identical", async () => {
    const after = await read(db);
    expect(after.newReleases[0]).toBe("Newest"); // NOT "Unshipped"
    expect(after).toEqual(baseline);
    expect(baseline.comparables.length).toBeGreaterThan(0);
  });
});
