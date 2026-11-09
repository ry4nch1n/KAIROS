// Festival-window follower lift (#284). Load-bearing: entry/window/lift are null, never 0, when a
// side is unmeasured; the pre-window rate reuses #201's longest-window rule; the cohort is the
// titles that were coming soon AT THE TIME, and a Steam-wide fest says its lift is diluted.
import { describe, it, expect } from "vitest";
import { freshMemoryDb } from "../src/db/db.ts";
import { loadGames } from "../src/crawler/load.ts";
import type { RawGame } from "../src/crawler/base.ts";
import { setBriefSteering } from "../src/queries/library.ts";
import { festivalLiftFor, getFestivalLift, getSteamOverview } from "../src/queries/steam.ts";
import { CONTRACT } from "../../shared/src/contract.ts";

const snap = (followers: number | null, d: string) => ({ followers, capturedAt: `${d}T06:00:00Z` });
const FEST = { start: "2026-10-19", end: "2026-10-26" };

describe("#284 contract festivalWindows", () => {
  it("seeds Steam Next Fest October 2026 with verified dates, in the issue's shape", () => {
    expect(CONTRACT.version).toBeGreaterThanOrEqual(43);
    const nf = CONTRACT.festivalWindows.find((w) => w.id === "next-fest-2026-10");
    expect(nf).toMatchObject({ kind: "next-fest", ...FEST });
    for (const w of CONTRACT.festivalWindows) expect(w.start <= w.end).toBe(true);
  });
});

describe("#284 festivalLiftFor (pure)", () => {
  it("entry = last count before start; window and pre rates; lift = window ÷ pre", () => {
    const r = festivalLiftFor(
      [
        snap(1000, "2026-10-08"),
        snap(1100, "2026-10-18"), // pre: 100 over 10 days = 10/day; entry 1100
        snap(1500, "2026-10-22"),
        snap(1800, "2026-10-26"), // window: 700 over 8 days = 87.5/day
        snap(9999, "2026-10-28"), // after the window — ignored
      ],
      FEST.start,
      FEST.end,
    );
    expect(r).toEqual({ entryFollowers: 1100, preVelocity: 10, windowVelocity: 87.5, lift: 8.75 });
  });

  it("null, never 0, when a side is missing", () => {
    const none = { entryFollowers: null, preVelocity: null, windowVelocity: null, lift: null };
    expect(festivalLiftFor([], FEST.start, FEST.end)).toEqual(none);
    // Only in-window snapshots: no entry, so nothing measurable.
    expect(
      festivalLiftFor([snap(5, "2026-10-20"), snap(9, "2026-10-25")], FEST.start, FEST.end),
    ).toEqual(none);
    // One pre snapshot: entry + window rate, but no pre-rate → no lift.
    expect(
      festivalLiftFor([snap(100, "2026-10-18"), snap(140, "2026-10-22")], FEST.start, FEST.end),
    ).toEqual({ entryFollowers: 100, preVelocity: null, windowVelocity: 10, lift: null });
  });

  it("a flat or shrinking pre-rate yields no lift (a ratio over ≤0 is not a lift)", () => {
    const r = festivalLiftFor(
      [snap(100, "2026-10-10"), snap(100, "2026-10-18"), snap(200, "2026-10-24")],
      FEST.start,
      FEST.end,
    );
    expect(r.preVelocity).toBe(0);
    expect(r.windowVelocity).not.toBeNull();
    expect(r.lift).toBeNull();
  });
});

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

describe("#284 getFestivalLift (PGlite)", () => {
  it("reads the coming-soon cohort around the window, on the Steam overview too", async () => {
    const db = await freshMemoryDb();
    const base = "https://store.steampowered.com";
    const day = async (d: string, f: number[], soon = true) =>
      loadGames(
        db,
        "steam",
        base,
        f.map((n, i) =>
          game({ sourceGameId: String(500 + i), title: `F${i}`, followers: n, comingSoon: soon }),
        ),
        d,
      );
    await day("2026-10-08", [1000, 50]);
    await day("2026-10-18", [1100, 60]); // pre: 10/day and 1/day
    await day("2026-10-26", [1900, 76]); // window (8 days): 100/day and 2/day → lift 10 and 2
    await day("2026-11-01", [2000, 80], false); // launched since — still counted (soon at the time)
    const [read] = await getFestivalLift(db);
    expect(read).toMatchObject({
      id: "next-fest-2026-10",
      scope: "coming-soon-cohort",
      titles: 2,
      withEntry: 2,
      n: 2,
      thin: true,
      entryFollowers: { median: 580 },
      lift: { median: 6 },
    });
    expect(read.note).toMatch(/diluted/);
    expect(read.rows[0]).toMatchObject({ title: "F0", entryFollowers: 1100, lift: 10 });
    const overview = await getSteamOverview(db);
    expect(overview.festivalLift?.[0].n).toBe(2);
  }, 60000);

  it("slices by price band and steered tag, with unpriced titles in no band", async () => {
    const db = await freshMemoryDb();
    await setBriefSteering(db, ["Roguelike deckbuilders"]);
    const load = (d: string, f: number[]) =>
      loadGames(
        db,
        "steam",
        "https://store.steampowered.com",
        [
          game({
            sourceGameId: "1",
            title: "Priced",
            followers: f[0],
            priceCents: 1499,
            tags: ["Roguelike Deckbuilder"],
          }),
          game({
            sourceGameId: "2",
            title: "Unpriced",
            followers: f[1],
            priceCents: null,
            tags: ["Roguelike Deckbuilder"],
          }),
          game({ sourceGameId: "3", title: "Other", followers: f[2], priceCents: null, tags: [] }),
        ],
        d,
      );
    await load("2026-10-08", [100, 50, 10]);
    await load("2026-10-18", [200, 60, 20]);
    await load("2026-10-26", [1000, 76, 30]);
    const [read] = await getFestivalLift(db);
    expect(read).toMatchObject({ titles: 3, priced: 1, tagged: 2 });
    expect(read.byPriceBand.map((b) => b.scope)).toEqual(["$10–20"]);
    expect(read.byPriceBand[0]).toMatchObject({
      titles: 1,
      n: 1,
      thin: true,
      lift: { median: 10 },
    });
    expect(read.byTag.map((t) => t.scope)).toEqual(["Roguelike Deckbuilder"]);
    expect(read.byTag[0]).toMatchObject({ titles: 2, n: 2, thin: true });
  }, 60000);

  it("reports null percentiles for an unmeasurable slice and no tags without steering", async () => {
    const db = await freshMemoryDb();
    await loadGames(
      db,
      "steam",
      "https://store.steampowered.com",
      [game({ sourceGameId: "9", title: "Solo", followers: 5, priceCents: 0, tags: ["Puzzle"] })],
      "2026-10-20",
    );
    const [read] = await getFestivalLift(db);
    expect(read.byTag).toEqual([]);
    expect(read.byPriceBand[0]).toMatchObject({
      scope: "Free",
      n: 0,
      withEntry: 0,
      lift: { median: null },
      entryFollowers: { median: null },
    });
  }, 60000);
});
