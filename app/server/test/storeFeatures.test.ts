// Store-page completeness capture (#178). Both inputs ride along on payloads the crawler
// already fetches, so the whole risk surface is parsing and the round-trip — hence pure-function
// coverage over the real captured appdetails/SteamSpy fixtures plus one PGlite write.
//
// The load-bearing distinction under test is NULL vs EMPTY: "the payload never told us" and
// "the listing carries none of the four features" must never collapse into each other, because
// the second one IS the signal (the two lowest-review titles in the 2026-08-24 deckbuilder pass
// were exactly the two shipping no achievements and no cloud saves).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  detectSimplifiedChinese,
  parseSteamGame,
  parseStoreFeatures,
  parseSupportedLanguages,
} from "../src/crawler/steam.ts";
import { crazygames } from "../src/crawler/crazygames.ts";
import { loadGames } from "../src/crawler/load.ts";
import { freshMemoryDb } from "../src/db/db.ts";

const json = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));

// Hades — a fully localized, feature-complete listing.
const hades = json("steam_appdetails_1145360.json")["1145360"].data;
const hadesSpy = json("steamspy_1145360.json");
const hadesReviews = json("steam_reviews_1145360.json").query_summary;
// A minimal real capture whose payload carries neither `categories` nor `supported_languages`.
const sparse = json("steam_appdetails_2950790.json")["2950790"].data;

describe("parseSupportedLanguages", () => {
  it("strips Steam's markup and drops the full-audio footnote from the count", () => {
    const langs = parseSupportedLanguages(hades.supported_languages);
    expect(langs).toContain("english");
    expect(langs).toContain("simplified chinese");
    // 11 languages in the fixture; the "*languages with full audio support" note is prose.
    expect(langs).toHaveLength(11);
    expect(langs.join(",")).not.toMatch(/full audio/i);
  });

  it("parses SteamSpy's plain comma list to the same set", () => {
    expect(parseSupportedLanguages(hadesSpy.languages).sort()).toEqual(
      parseSupportedLanguages(hades.supported_languages).sort(),
    );
  });

  it("counts a single-language listing as 1, and an absent field as none", () => {
    expect(parseSupportedLanguages("English")).toEqual(["english"]);
    expect(parseSupportedLanguages(undefined)).toEqual([]);
    expect(parseSupportedLanguages("")).toEqual([]);
    expect(parseSupportedLanguages(",  , ")).toEqual([]);
  });

  it("dedupes rather than double-counting a repeated name", () => {
    expect(parseSupportedLanguages("English, English, French")).toHaveLength(2);
  });
});

describe("detectSimplifiedChinese", () => {
  it("matches both spellings and does not match Traditional", () => {
    expect(detectSimplifiedChinese(["simplified chinese"])).toBe(true);
    expect(detectSimplifiedChinese(["chinese (simplified)"])).toBe(true);
    expect(detectSimplifiedChinese(["traditional chinese", "english"])).toBe(false);
  });
});

describe("parseStoreFeatures", () => {
  it("extracts the four features from real appdetails categories", () => {
    // Hades carries achievements (22), cloud (23) and full controller (28) but no workshop (30).
    expect(parseStoreFeatures(hades)).toEqual(["achievements", "cloud", "controller"]);
  });

  it("returns an EMPTY array — not null — when categories are present but carry none", () => {
    const none = parseStoreFeatures({ categories: [{ id: 2, description: "Single-player" }] });
    expect(none).toEqual([]);
    expect(none).not.toBeNull();
  });

  it("ignores partial controller support (18), which is a weaker claim than full (28)", () => {
    expect(
      parseStoreFeatures({ categories: [{ id: 18, description: "Partial Controller Support" }] }),
    ).toEqual([]);
  });

  it("falls back to the description when the id is missing", () => {
    expect(parseStoreFeatures({ categories: [{ description: "Steam Workshop" }] })).toEqual([
      "workshop",
    ]);
  });

  it("returns null when the payload carries no categories at all (not measured)", () => {
    expect(parseStoreFeatures(sparse)).toBeNull();
    expect(parseStoreFeatures({})).toBeNull();
    expect(parseStoreFeatures(null)).toBeNull();
  });
});

describe("parseSteamGame carries store-page completeness", () => {
  it("populates all three fields from the joined payloads", () => {
    const g = parseSteamGame(1145360, hades, hadesReviews, hadesSpy);
    expect(g.languageCount).toBe(11);
    expect(g.hasSimplifiedChinese).toBe(true);
    expect(g.storeFeatures).toEqual(["achievements", "cloud", "controller"]);
  });

  it("reports NOT MEASURED (null), never a zero, when the payloads are silent", () => {
    const g = parseSteamGame(2950790, sparse, {}, {});
    expect(g.languageCount).toBeNull();
    expect(g.hasSimplifiedChinese).toBeNull();
    expect(g.storeFeatures).toBeNull();
  });
});

describe("browser sources stay null-safe", () => {
  it("a CrazyGames game parses and loads with all three columns NULL, without throwing", async () => {
    const html = readFileSync(
      fileURLToPath(new URL("./fixtures/crazygames_game.html", import.meta.url)),
      "utf8",
    );
    const g = crazygames.parseGame(html, "https://www.crazygames.com/game/final-drop");
    expect(g.languageCount).toBeUndefined();
    expect(g.storeFeatures).toBeUndefined();

    const db = await freshMemoryDb();
    await loadGames(db, "crazygames", "https://www.crazygames.com", [g], "2026-06-26");
    const [row] = await db.query(
      "SELECT language_count, has_simplified_chinese, store_features FROM game_snapshots",
    );
    expect(row.language_count).toBeNull();
    expect(row.has_simplified_chinese).toBeNull();
    expect(row.store_features).toBeNull();
  });

  it("round-trips a measured empty feature set as an empty array, distinct from NULL", async () => {
    const db = await freshMemoryDb();
    const g = parseSteamGame(1, { categories: [], supported_languages: "English" }, {}, {});
    await loadGames(db, "steam", "https://store.steampowered.com", [g], "2026-06-26");
    const [row] = await db.query(
      "SELECT language_count, has_simplified_chinese, store_features FROM game_snapshots",
    );
    expect(row.language_count).toBe(1);
    expect(row.has_simplified_chinese).toBe(false);
    expect(row.store_features).toEqual([]); // measured "carries none", not "not measured"
  });
});
