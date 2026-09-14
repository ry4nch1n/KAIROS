import { afterEach, describe, expect, it, vi } from "vitest";
import type { BriefDemandTracker, MarketGap, SteamGap } from "shared";
import { briefSeed, browserGapSeed, copyText, familyFor, steamGapSeed } from "./pitchSeed.ts";

const ctx = { source: "CrazyGames", captured: "2026-09-14" };
const browserGap: MarketGap = {
  label: "Puzzle × Merge",
  genre: "Puzzle",
  tag: "Merge",
  supplyN: 14,
  appetite: 12345.4,
  appetiteUnit: "votes",
  qualityCeil: 9.126,
  score: 2.345,
  components: { demand: 1, quality: 0.5, supply: -0.2 },
  examples: ["Merge Lab", "Tile Town"],
  supplyRising: true,
};
const steam = { medianVotes: 812, medianOwners: 35000, medianPriceCents: 1499, examples: [] };
const steamGap = { ...browserGap, ...steam, supplyRising: false } as unknown as SteamGap;

describe("gap seeds", () => {
  it("browser: appetite as median votes per title, flags and examples", () => {
    expect(browserGapSeed(browserGap, ctx)).toBe(
      "Pitch seed — Puzzle × Merge\nMarket: Puzzle · Merge\nSource: CrazyGames · captured 2026-09-14\n" +
        "Appetite: 12,345 median votes per title\nSupply: 14 games · supply rising\n" +
        "Quality ceiling: 9.13 (P90 rating)\nOpportunity score: 2.3\nExamples: Merge Lab · Tile Town",
    );
  });

  it("browser on All Browser: appetite is a within-portal percentile, never 'median votes' (#204 S4)", () => {
    const s = browserGapSeed(
      { ...browserGap, appetite: 61.6, appetiteUnit: "votePercentile" },
      ctx,
    );
    expect(s).toContain("Appetite: P62 median vote percentile per title (within its portal)");
    expect(s).not.toContain("median votes");
  });

  it("steam: median reviews with owners as context, price, missing fields omitted", () => {
    const s = steamGapSeed(steamGap, ctx);
    expect(s).toContain("Appetite: 812 median reviews per game (≈35,000 median owners, context)");
    expect(s).toContain("Median price: $14.99");
    // no flag or examples line when absent, and no tool, skill or command named
    expect(s).not.toMatch(/supply rising|Examples|\/\w|kairos|skill/i);
    const bare = steamGapSeed({ ...steamGap, medianOwners: 0, medianPriceCents: 0 }, ctx);
    expect(bare).not.toContain("owners");
    expect(bare).toContain("Median price: Free");
  });
});

const tracker: BriefDemandTracker = {
  rows: [
    { family: "deckbuilder", signals: 2, titles: ["Card Keep", "Other"] },
    { family: null, signals: 1, titles: ["Loose Item"] },
  ],
  tagged: 2,
  total: 3,
};

describe("brief seed", () => {
  it("finds the loop family by title; unclassified is not a family", () => {
    expect(familyFor(" card keep ", tracker)).toBe("deckbuilder");
    expect(familyFor("Loose Item", tracker)).toBeNull();
  });

  it("builds a full seed with family and source, and omits optional lines cleanly", () => {
    const item = {
      name: "Card Keep",
      category: "Contained-systemic",
      status: "Demo",
      date: "2026-09-10",
      figure: "12k wishlists",
      blurb: "A castle deckbuilder.",
      relevance: "Proves a card loop.",
      source: "https://example.com/card-keep",
    };
    expect(briefSeed(item, { editionDate: "2026-09-11", tracker })).toBe(
      "Pitch seed — Card Keep\nSignal: Contained-systemic · Demo · 2026-09-10\nLoop family: deckbuilder\n" +
        "Figure: 12k wishlists\nWhat: A castle deckbuilder.\nWhy it matters: Proves a card loop.\n" +
        "Source: News Brief 2026-09-11 · https://example.com/card-keep",
    );
    const bare = briefSeed({ name: "Bare", figure: null }, { editionDate: "2026-09-11" });
    expect(bare).toBe("Pitch seed — Bare\nSource: News Brief 2026-09-11");
  });
});

describe("copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns false (never throws) with no clipboard and no execCommand", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", undefined);
    await expect(copyText("x")).resolves.toBe(false);
    vi.stubGlobal("document", { createElement: () => ({}) });
    await expect(copyText("x")).resolves.toBe(false);
  });

  it("uses the async clipboard, falling back to execCommand when it rejects", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("seed")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("seed");
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("no")) } });
    const ta = { value: "", style: {}, select() {}, remove: vi.fn() };
    const doc = { createElement: () => ta, body: { appendChild() {} }, execCommand: () => true };
    vi.stubGlobal("document", doc);
    await expect(copyText("seed")).resolves.toBe(true);
    expect(ta.value).toBe("seed");
    expect(ta.remove).toHaveBeenCalled();
  });
});
