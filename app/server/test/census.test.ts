// Steam release census (#245 slice 2). Fixtures are real store-search responses captured
// 2026-09-21: Roguelike Deckbuilder (niche — one page covers both 30-day windows) and Roguelite
// (broad — one page runs out inside the recent window).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  censusUrl,
  fetchTagSeeds,
  interleaveSeeds,
  parseCensusPage,
  parseTagBandPage,
  parseTagSeedPage,
  parseStoreDate,
  parseStoreTags,
  runCensus,
  selectCensusTags,
  summarizeCensus,
  tagBandUrl,
  tagUpcomingUrl,
} from "../src/crawler/census.ts";
import { classifyCensusSupply, matchSteering, parseTagPairFlag } from "../src/queries/shared.ts";
import { setBriefSteering } from "../src/queries/library.ts";
import { freshMemoryDb } from "../src/db/db.ts";
import { loadGames } from "../src/crawler/load.ts";
import { STEAM_BASE_URL, addTagSeeds, parseSteamGame } from "../src/crawler/steam.ts";
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
    // #258: three crawled survivors of an 800+ title market — the band stays, marked a survivor read.
    expect(deck.successBand).toBeTruthy();
    expect(deck.bandCoverage).toBeCloseTo(3 / (deck.census?.totalCount ?? 1), 4);
    expect(deck.bandCoverage!).toBeLessThan(q.BAND_COVERAGE_FLOOR);
    expect(deck.survivorBand).toBe(true);
  });

  it("band coverage: survivor below the floor, plain read above it, null with no census", () => {
    expect(q.bandCoverageFor(3, { totalCount: 2360 }).survivorBand).toBe(true);
    expect(q.bandCoverageFor(120, { totalCount: 909 })).toEqual({
      bandCoverage: 0.132,
      survivorBand: false,
    });
    expect(q.bandCoverageFor(3, null)).toEqual({ bandCoverage: null, survivorBand: false });
    expect(q.bandCoverageFor(3, { totalCount: 0 })).toEqual({
      bandCoverage: null,
      survivorBand: false,
    });
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
    expect(row.bandCoverage).toBeNull();
    expect(row.survivorBand).toBe(false);
  });
});

// #265 tag-seeded discovery. Fixture: Roguelike Deckbuilder's reviews-sorted search page
// (count=25), captured live 2026-10-19.
const REVIEWS = fx("steam_search_reviews_1091588.json");
// Same tag, reviews-sorted with maxprice=20 (count=50), captured live 2026-11-02.
const BAND = fx("steam_search_band_1091588.json");

describe("tag-seeded discovery (#265)", () => {
  it("reads the top appids of a reviews-sorted page, mid-band titles included", () => {
    const ids = parseTagSeedPage(REVIEWS);
    expect(ids).toHaveLength(25);
    expect(ids.slice(0, 2)).toEqual([646570, 2379780]); // Slay the Spire, Balatro
    expect(parseTagSeedPage(REVIEWS, 5)).toHaveLength(5);
    expect(() => parseTagSeedPage("{}")).toThrow();
  });

  it("fetches one page per steered tag and fails soft per tag and overall", async () => {
    const db = await freshMemoryDb();
    await setBriefSteering(db, ["Roguelike deckbuilder"]);
    const urls: string[] = [];
    const store = (url: string) => {
      urls.push(url);
      if (url.includes("populartags")) return Promise.resolve(TAGS);
      return Promise.resolve(url.includes("maxprice=") ? BAND : REVIEWS);
    };
    const seeds = await fetchTagSeeds(db, () => {}, store, 25, 0);
    expect(seeds.length).toBeGreaterThan(0);
    const rd = seeds.find((s) => s.tag === "Roguelike Deckbuilder")?.appids ?? [];
    // Top page and band page interleaved: the top end leads, band-only titles follow it.
    expect(rd.slice(0, 2)).toEqual([646570, 2379780]);
    expect(rd).toEqual(expect.arrayContaining([3084740, 1678320])); // Command Deck, Heat Death
    expect(new Set(rd).size).toBe(rd.length);
    // Two pages per steered tag: the reviews-sorted top and the price-capped band.
    expect(urls.filter((u) => u.includes("maxprice=20"))).toHaveLength(seeds.length);
    expect(urls.filter((u) => u.includes("sort_by=Reviews_DESC"))).toHaveLength(seeds.length * 2);

    // The band page failing alone keeps the top page's seeds (and vice versa).
    const noBand = (url: string) =>
      url.includes("maxprice=") ? Promise.reject(new Error("429")) : store(url);
    const partial = await fetchTagSeeds(db, () => {}, noBand, 25, 0);
    expect(partial.find((s) => s.tag === "Roguelike Deckbuilder")?.appids).toHaveLength(25);

    const logs: string[] = [];
    const blocked = (url: string) =>
      url.includes("populartags") ? Promise.resolve(TAGS) : Promise.reject(new Error("403"));
    expect(await fetchTagSeeds(db, (m) => logs.push(m), blocked, 25, 0)).toEqual([]);
    expect(logs.some((m) => m.includes("FAILED"))).toBe(true);
    const down = () => Promise.reject(new Error("down"));
    expect(await fetchTagSeeds(db, () => {}, down, 25, 0)).toEqual([]);
    expect(await fetchTagSeeds(await freshMemoryDb(), () => {}, store, 25, 0)).toEqual([]); // no flags
  });

  it("keeps only US$10-20 list-price titles from the price-capped page", () => {
    expect(tagBandUrl(1091588)).toContain("maxprice=20");
    const ids = parseTagBandPage(BAND, 50);
    expect(ids.length).toBeGreaterThan(10);
    expect(ids).not.toContain(646570); // Slay the Spire: US$24.99 list, on sale at US$6.24
    expect(ids).not.toContain(1557740); // ROUNDS: US$5.99
    expect(ids).toEqual(expect.arrayContaining([2379780, 2084000, 3084740])); // Balatro, Shogun Showdown, Command Deck
    expect(parseTagBandPage(BAND, 5)).toHaveLength(5);
    expect(() => parseTagBandPage("{}")).toThrow();
    expect(interleaveSeeds([1, 2, 3], [2, 9])).toEqual([1, 2, 9, 3]);
  });

  it("dedupes against the base seed and never raises the cap", () => {
    const base = Array.from({ length: 200 }, (_, i) => i + 1);
    const tagSeeds = [
      { tag: "A", appids: [1, 2, 9001, 9002, 9003] }, // 1 and 2 already in the kept base
      { tag: "B", appids: [9101, 9102, 9103, 9002] }, // interleaved: A reaches 9002 first
    ];
    const r = addTagSeeds(base, tagSeeds, 200);
    expect(r.ids).toHaveLength(200);
    expect(new Set(r.ids).size).toBe(200);
    expect(r.ids).toEqual(expect.arrayContaining([9001, 9002, 9003, 9101, 9102, 9103]));
    expect(r.perTag).toEqual([
      { tag: "A", added: 3, known: 2 },
      { tag: "B", added: 3, known: 1 },
    ]);
    // Tag seeds take at most a quarter of the cap; unused slots return to the base tail.
    const many = [{ tag: "C", appids: Array.from({ length: 100 }, (_, i) => 5000 + i) }];
    const capped = addTagSeeds(base, many, 200);
    expect(capped.ids).toHaveLength(200);
    expect(capped.perTag[0].added).toBe(50);
    expect(addTagSeeds(base, [], 200).ids).toEqual(base);
  });

  it("rotates each tag's list so deep rows get crawled, inside the same cap", () => {
    const base = Array.from({ length: 200 }, (_, i) => i + 1);
    const tagSeeds = [
      { tag: "A", appids: Array.from({ length: 40 }, (_, i) => 5000 + i) },
      { tag: "B", appids: Array.from({ length: 33 }, (_, i) => 6000 + i) },
    ];
    const all = tagSeeds.flatMap((t) => t.appids);
    const seen = new Set<number>();
    for (let rotation = 0; rotation < 8; rotation++) {
      const r = addTagSeeds(base, tagSeeds, 40, 0.25, rotation);
      expect(r.ids).toHaveLength(40);
      expect(new Set(r.ids).size).toBe(40);
      expect(r.perTag.reduce((n, t) => n + t.added, 0)).toBe(10);
      for (const id of r.ids) if (id >= 5000) seen.add(id);
    }
    expect(seen.size).toBe(all.length);
    // No rotation is the original front-of-list behaviour.
    expect(addTagSeeds(base, tagSeeds, 40, 0.25).ids).toEqual(
      addTagSeeds(base, tagSeeds, 40, 0.25, 0).ids,
    );
  });
});

// #292 coming-soon seeding. Fixture: Card Battler's coming-soon page, Released_ASC, count=25,
// captured live 2026-11-09.
const COMING_SOON = fx("steam_search_comingsoon_791774.json");

describe("coming-soon tag seeds (#292)", () => {
  const base = Array.from({ length: 200 }, (_, i) => i + 1);
  const released = Array.from({ length: 100 }, (_, i) => 5000 + i);
  const soonIds = Array.from({ length: 100 }, (_, i) => 7000 + i);
  const isSoon = (id: number) => id >= 7000;

  it("asks for the coming-soon page ascending, which leads with near-term launches", () => {
    const url = tagUpcomingUrl(791774);
    expect(url).toContain("filter=comingsoon");
    expect(url).toContain("sort_by=Released_ASC");
    const ids = parseTagSeedPage(COMING_SOON, 25);
    expect(ids).toHaveLength(25);
    expect(ids[0]).toBe(3445440); // Fablery, launching on the capture date
    const dates = [
      ...JSON.parse(COMING_SOON).results_html.matchAll(/search_released[^>]*>\s*([^<]*?)\s*</g),
    ].map((m: RegExpMatchArray) => m[1]);
    expect(dates).toHaveLength(25);
    for (const d of dates) expect(d).toMatch(/^Nov \d+, 2026$/);
  });

  it("reserves part of a budget the released seeds would otherwise fill", () => {
    const r = addTagSeeds(base, [{ tag: "A", appids: released, upcoming: soonIds }], 200);
    expect(r.ids).toHaveLength(200);
    expect(new Set(r.ids).size).toBe(200);
    expect(r.ids.filter(isSoon)).toHaveLength(20);
    expect(r.ids.filter((id) => id >= 5000 && id < 7000)).toHaveLength(30);
    expect(r.perTagUpcoming).toEqual([{ tag: "A", added: 20, known: 0 }]);
  });

  it("gives unused reserved slots back to released seeds and counts known titles", () => {
    const short = addTagSeeds(base, [{ tag: "A", appids: released, upcoming: [7000, 1] }], 200);
    expect(short.ids.filter(isSoon)).toEqual([7000]);
    expect(short.ids.filter((id) => id >= 5000 && id < 7000)).toHaveLength(49);
    expect(short.perTagUpcoming).toEqual([{ tag: "A", added: 1, known: 1 }]); // 1 is in the base
  });

  it("rotates the coming-soon list across crawls inside its reserved slots", () => {
    const tagSeeds = [{ tag: "A", appids: released, upcoming: soonIds.slice(0, 12) }];
    const seen = new Set<number>();
    for (let rotation = 0; rotation < 3; rotation++) {
      const r = addTagSeeds(base, tagSeeds, 40, 0.25, rotation);
      expect(r.ids.filter(isSoon)).toHaveLength(4);
      for (const id of r.ids.filter(isSoon)) seen.add(id);
    }
    expect(seen.size).toBe(12);
  });

  it("fetches one extra page per tag and fails soft on it alone", async () => {
    const db = await freshMemoryDb();
    await setBriefSteering(db, ["Roguelike deckbuilder"]);
    const store = (url: string) => {
      if (url.includes("populartags")) return Promise.resolve(TAGS);
      if (url.includes("filter=comingsoon")) return Promise.resolve(COMING_SOON);
      return Promise.resolve(url.includes("maxprice=") ? BAND : REVIEWS);
    };
    const seeds = await fetchTagSeeds(db, () => {}, store, 25, 0);
    expect(seeds[0].upcoming?.[0]).toBe(3445440);

    const logs: string[] = [];
    const noSoon = (url: string) =>
      url.includes("filter=comingsoon") ? Promise.reject(new Error("429")) : store(url);
    const partial = await fetchTagSeeds(db, (m) => logs.push(m), noSoon, 25, 0);
    expect(partial[0].upcoming).toEqual([]);
    expect(partial[0].appids.length).toBeGreaterThan(0);
    expect(logs.some((m) => m.includes("tag upcoming"))).toBe(true);
  });
});

describe("steered tag pairs (#293)", () => {
  const PAIR = "Card Battler × Cozy";
  const store = parseStoreTags(TAGS);
  // The flags live on 2026-11-05 and what the matcher selected for them before pairs existed.
  const LIVE =
    "Unity engine (general)|Godot engine (general)|Luck/deck builder synergy games|Rogue-lites|Blackjack or playing card mechanics|Fairy tale setting|Melancholy tone|Living playing card/toy soldiers setting|Players acceptance on AI use in video games|Steam Next Fest demo-volume trend|Tabletop board game as overworld Map Mechanics".split(
      "|",
    );
  const BEFORE =
    "1716:Roguelike|3959:Roguelite|1666:Card Game|17389:Tabletop|32322:Deckbuilding|1770:Board Game|791774:Card Battler|1091588:Roguelike Deckbuilder";
  const pick = (flags: string[], cap?: number) => selectCensusTags(store, flags, cap);

  it("existing single-tag flags select exactly what they selected before", () => {
    expect(
      pick(LIVE)
        .map((t) => `${t.tagid}:${t.name}`)
        .join("|"),
    ).toBe(BEFORE);
    for (const f of LIVE) expect(parseTagPairFlag(f)).toBeNull();
  });

  it("a pair claims neither parent, in the census or in the matcher", () => {
    expect(pick([PAIR]).map((t) => t.name)).toEqual([PAIR]);
    expect(matchSteering([PAIR], { genre: "", tag: "Card Battler" })).toEqual([]);
    expect(matchSteering([PAIR], { genre: "Casual", tag: "Cozy" })).toEqual([]);
  });

  it("has one stable key whichever way round it is written", () => {
    const [a] = pick([PAIR]);
    expect(a).toMatchObject({ key: "791774+97376", param: "791774,97376" });
    expect(a.tagid).toBeLessThan(0);
    expect(pick(["Cozy × Card Battler"])).toEqual([a]);
    expect(pick([PAIR, "Cozy × Card Battler"])).toHaveLength(1);
  });

  it("drops a pair unless both halves are distinct exact store tags", () => {
    expect(pick(["Card Battler × Warm", "Cozy × Cozy", "A × B × C"])).toEqual([]);
  });

  it("takes a cap seat ahead of single tags", () => {
    expect(pick([...LIVE, PAIR], 3).map((t) => t.name)).toEqual([PAIR, "Roguelike", "Roguelite"]);
  });

  it("seeds on one AND search per page and carries both halves for membership", async () => {
    const db = await freshMemoryDb();
    await setBriefSteering(db, [PAIR]);
    const urls: string[] = [];
    const fetchText = (u: string) => {
      urls.push(u);
      return Promise.resolve(u.includes("populartags") ? TAGS : NICHE);
    };
    const seeds = await fetchTagSeeds(db, () => {}, fetchText, 5, 0, 5);
    expect(urls.filter((u) => u.includes("tags=791774,97376&"))).toHaveLength(3);
    expect(urls).toHaveLength(4); // the tag list + the three pages
    expect(seeds[0].parts).toEqual(["Card Battler", "Cozy"]);
    expect(tagBandUrl("791774,97376")).toContain("tags=791774,97376&");
    expect(tagUpcomingUrl("791774,97376")).toContain("tags=791774,97376&");
  });

  it("keeps both halves below the top-10 tag cut", () => {
    const tags: Record<string, number> = { "Card Battler": 50, Cozy: 40 };
    for (let i = 0; i < 12; i++) tags[`Filler ${i}`] = 1000 - i;
    const app = { name: "T", steam_appid: 1, release_date: { date: "Jan 1, 2025" } };
    const kept = parseSteamGame(1, app, null, { tags }, ["Card Battler", "Cozy"]).tags;
    expect(kept).toEqual(expect.arrayContaining(["Card Battler", "Cozy"]));
    expect(parseSteamGame(1, app, null, { tags }, []).tags).not.toContain("Cozy");
  });

  it("records one census row, and the lens returns only titles carrying both", async () => {
    const db = await freshMemoryDb();
    await setBriefSteering(db, [PAIR]);
    const fetchText = (u: string) => Promise.resolve(u.includes("populartags") ? TAGS : NICHE);
    expect(await runCensus(db, () => {}, fetchText, CAPTURED, 0)).toMatchObject({ stored: 1 });
    await runCensus(db, () => {}, fetchText, CAPTURED, 0); // same-day re-run keeps the first row
    const rows = await db.query(`SELECT tag_key, tag_name, total_count FROM tag_census`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tag_key: "791774+97376", tag_name: PAIR });
    const g = (sourceGameId: string, tags: string[]) =>
      steamGame({ sourceGameId, tags, releaseDate: "2020-01-01" });
    const both = ["Card Battler", "Cozy"];
    const games = [g("P1", both), g("P2", both), g("P3", both), g("C1", ["Card Battler"])];
    await loadGames(db, "steam", STEAM_BASE_URL, [...games, g("Z1", ["Cozy"])], CAPTURED);
    const lookup = (t: string) => q.getSteamTagLookup(db, t, { cohort: "all" });
    const [row] = (await lookup("card battler × cozy")).rows;
    expect(row).toMatchObject({ genre: PAIR, games: 3, supplySource: "census" });
    expect(row.census?.totalCount).toBeGreaterThan(800);
    expect(row.examples.map((e) => e.title).sort()).toEqual(["Game P1", "Game P2", "Game P3"]);
    const [parent] = (await lookup("card battler")).rows;
    expect(parent).toMatchObject({ games: 4, census: null });
    expect((await lookup("cozy × card battler")).rows[0].census).toEqual(row.census);
  });
});
