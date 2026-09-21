// Steam release census (#245 slice 2). Fixtures are real store-search responses captured
// 2026-09-21: Roguelike Deckbuilder (niche — one page covers both 30-day windows) and Roguelite
// (broad — one page runs out inside the recent window).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  censusUrl,
  parseCensusPage,
  parseStoreDate,
  parseStoreTags,
  runCensus,
  selectCensusTags,
  summarizeCensus,
} from "../src/crawler/census.ts";
import { classifyCensusSupply, matchSteering } from "../src/queries/shared.ts";
import { setBriefSteering } from "../src/queries/library.ts";
import { freshMemoryDb } from "../src/db/db.ts";
import { loadGames } from "../src/crawler/load.ts";
import { STEAM_BASE_URL } from "../src/crawler/steam.ts";
import * as q from "../src/queries/index.ts";
import type { RawGame } from "../src/crawler/base.ts";

// Minimal released Steam title (same shape as steam.test.ts's helper).
const steamGame = (o: { sourceGameId: string; tags: string[]; releaseDate: string }): RawGame => ({
  url: `https://store.steampowered.com/app/${o.sourceGameId}`,
  title: `Game ${o.sourceGameId}`,
  thumbnailUrl: null,
  developer: "Dev",
  description: null,
  engine: null,
  orientation: null,
  mobile: false,
  genre: "Strategy",
  tags: o.tags,
  rating: 4.5,
  votes: 5000,
  featured: false,
  releaseDate: o.releaseDate,
  plays: 100000,
  ownersEst: 100000,
  priceCents: 1500,
  discountPct: 0,
  ccu: 100,
  medianPlaytimeMin: 600,
  metacritic: null,
  scaleTier: "small_indie",
  sourceGameId: o.sourceGameId,
});
const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const NICHE = fx("steam_search_census_1091588.json");
const BROAD = fx("steam_search_census_3959.json");
const TAGS = fx("steam_populartags.json");
const CAPTURED = "2026-09-21";
// The standing flags as of 2026-09-17 — the set the census was designed against.
const FLAGS = [
  "Unity engine (general)",
  "Unity asset store",
  "Luck/deck builder synergy games",
  "Rogue-lites",
  "Blackjack or playing card mechanics",
  "Fairy tale setting",
  "Melancholy tone",
  "Living playing card/toy soldiers setting",
  "Players acceptance on AI use in video games",
  "Steam Next Fest demo-volume trend",
  "Tabletop board game as overworld Map Mechanics",
];

describe("census parsing", () => {
  it("reads both store date formats and refuses dateless labels", () => {
    expect(parseStoreDate("Sep 20, 2026")).toBe("2026-09-20");
    expect(parseStoreDate("  20 Sep, 2026 ")).toBe("2026-09-20");
    expect(parseStoreDate("Coming soon")).toBeNull();
    expect(parseStoreDate("Q4 2026")).toBeNull();
    expect(parseStoreDate("2026")).toBeNull();
  });

  it("parses a full page: total count, a date and a price per row", () => {
    const page = parseCensusPage(NICHE);
    expect(page.totalCount).toBeGreaterThan(800);
    expect(page.rows).toHaveLength(100);
    expect(page.rows.filter((r) => r.released).length).toBeGreaterThan(95);
    expect(page.rows[0]).toEqual({ released: "2026-09-20", priceCents: 999 });
  });

  it("fails loudly when the markup no longer yields rows", () => {
    const broken = JSON.stringify({ success: 1, total_count: 886, results_html: "<div></div>" });
    expect(() => parseCensusPage(broken)).toThrow(/no result rows/);
    expect(() => parseCensusPage(JSON.stringify({ items: [] }))).toThrow(/results_html/);
  });

  it("asks the infinite-scroll endpoint, games only, one 100-row page", () => {
    const u = censusUrl(1091588);
    expect(u).toContain("infinite=1");
    expect(u).toContain("category1=998");
    expect(u).toContain("count=100");
    expect(u).not.toContain("json=1");
  });
});

describe("census summary", () => {
  it("a niche tag: one page covers both windows exactly", () => {
    const s = summarizeCensus(parseCensusPage(NICHE), CAPTURED);
    expect(s.truncated).toBe(false);
    expect(s.coveredDays).toBe(60);
    expect(s.recent + s.prior).toBeGreaterThanOrEqual(90); // 94 measured at capture
    expect(s.medianPriceCents).toBeGreaterThanOrEqual(700);
    expect(s.medianPriceCents).toBeLessThanOrEqual(900);
    expect(classifyCensusSupply(s)).not.toBe("quiet");
  });

  it("a broad tag: the page runs out inside a month, so it is a lower bound read as rising", () => {
    const s = summarizeCensus(parseCensusPage(BROAD), CAPTURED);
    expect(s.truncated).toBe(true);
    expect(s.coveredDays).toBeLessThan(30);
    expect(s.prior).toBe(0);
    expect(classifyCensusSupply(s)).toBe("rising");
  });

  it("a page that runs out inside the prior window compares daily rates", () => {
    // 60 releases in the last 30 days; 20 in the 10 prior days the page reached = 60 per 30 days.
    expect(classifyCensusSupply({ recent: 60, prior: 20, coveredDays: 40, truncated: true })).toBe(
      "steady",
    );
    // Read as a raw count, 60 vs 20 would have claimed "rising".
    expect(classifyCensusSupply({ recent: 60, prior: 20, coveredDays: 60, truncated: false })).toBe(
      "rising",
    );
  });

  it("a prior tail under a week is not scaled up — it reads as a page full within a month", () => {
    // Card Battler, live 2026-09-21: 86 + 14 over 32 days. Scaled, 14 in 2 days = 210/month → "cooling".
    expect(classifyCensusSupply({ recent: 86, prior: 14, coveredDays: 32, truncated: true })).toBe(
      "rising",
    );
  });

  it("ignores future-dated rows", () => {
    const page = { totalCount: 2, rows: [{ released: "2026-10-01", priceCents: 999 }] };
    expect(summarizeCensus(page, CAPTURED).recent).toBe(0);
  });
});

describe("census target set", () => {
  it("picks the steered store tags, and 'video games' no longer claims video tags", () => {
    const picked = selectCensusTags(parseStoreTags(TAGS), FLAGS).map((t) => t.name);
    for (const t of ["Roguelike Deckbuilder", "Deckbuilding", "Card Battler", "Roguelite"]) {
      expect(picked).toContain(t);
    }
    expect(picked).not.toContain("Video Production");
    expect(picked).not.toContain("360 Video");
    expect(picked.length).toBeLessThanOrEqual(15);
  });

  it("no flags, no census", () => {
    expect(selectCensusTags(parseStoreTags(TAGS), [])).toEqual([]);
  });

  it("the matcher drops 'video' the way it drops 'game'", () => {
    expect(
      matchSteering(["AI use in video games"], { genre: "", tag: "Video Production" }),
    ).toEqual([]);
  });
});

describe("census end to end", () => {
  const fakeStore = (url: string) =>
    Promise.resolve(
      url.includes("populartags") ? TAGS : url.includes("tags=1091588") ? NICHE : BROAD,
    );

  it("stores one row per tag per day, and the tag lens reads supply from it", async () => {
    const db = await freshMemoryDb();
    await setBriefSteering(db, ["Roguelike deckbuilder"]);
    const r1 = await runCensus(db, () => {}, fakeStore, CAPTURED, 0);
    expect(r1.failed).toEqual([]);
    expect(r1.stored).toBeGreaterThan(0);
    await runCensus(db, () => {}, fakeStore, CAPTURED, 0); // same-day re-run keeps the first row
    const rows = await db.query(`SELECT count(*)::int AS n FROM tag_census`);
    expect(rows[0].n).toBe(r1.stored);

    // Three old survivors: on the crawl sample alone this tag reads "unobserved" (slice 1).
    const old = (id: string) =>
      steamGame({ sourceGameId: id, tags: ["Roguelike Deckbuilder"], releaseDate: "2020-01-01" });
    await loadGames(db, "steam", STEAM_BASE_URL, [old("R1"), old("R2"), old("R3")], CAPTURED);
    const deck = (await q.getSteamTagEconomics(db, { cohort: "all", minSupply: 3 })).find(
      (x) => x.genre === "Roguelike Deckbuilder",
    )!;
    expect(deck.supplySource).toBe("census");
    expect(deck.supplyTrend).not.toBe("unobserved");
    expect(deck.census?.totalCount).toBeGreaterThan(800);
  });

  it("without a census row the crawl read stands", async () => {
    const db = await freshMemoryDb();
    const old = (id: string) =>
      steamGame({ sourceGameId: id, tags: ["Niche Tag"], releaseDate: "2020-01-01" });
    const anchor = steamGame({ sourceGameId: "A1", tags: ["Anchor"], releaseDate: "2026-06-01" });
    await loadGames(
      db,
      "steam",
      STEAM_BASE_URL,
      [anchor, old("N1"), old("N2"), old("N3")],
      CAPTURED,
    );
    const row = (await q.getSteamTagEconomics(db, { cohort: "all", minSupply: 3 })).find(
      (x) => x.genre === "Niche Tag",
    )!;
    expect(row.supplySource).toBe("crawl");
    expect(row.census).toBeNull();
    expect(row.supplyTrend).toBe("unobserved");
  });
});
