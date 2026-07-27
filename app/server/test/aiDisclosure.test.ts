// AI-content disclosure parsing + gating (#110). Pure-function coverage — the load-bearing
// proof that the parser survives Steam's duplicate-id "Mature Content Description" sibling and
// that the store-page fetch is bounded to the recent non-AAA cohort.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAiDisclosure, wantsAiDisclosure } from "../src/crawler/steam.ts";
import type { RawGame } from "../src/crawler/base.ts";

const html = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const game = (over: Partial<RawGame>): RawGame => ({
  sourceGameId: "1",
  url: "https://store.steampowered.com/app/1",
  title: "t",
  thumbnailUrl: null,
  developer: null,
  description: null,
  engine: null,
  orientation: null,
  mobile: false,
  genre: null,
  tags: [],
  rating: null,
  votes: null,
  featured: false,
  ...over,
});

describe("parseAiDisclosure", () => {
  it("positive fixture: reports the AI note, NOT the mature-content sibling (duplicate-id edge case)", () => {
    const r = parseAiDisclosure(html("steam_store_ai_1304930.html"));
    expect(r.aiDisclosure).toBe(true);
    // The note must be the AI-tools text, and must NOT bleed into the sibling block that reuses
    // id="game_area_content_descriptors" for the Mature Content Description.
    expect(r.aiDisclosureNote).toContain("AI-based tools");
    expect(r.aiDisclosureNote).not.toContain("Violence or Gore");
    expect(r.aiDisclosureNote).not.toMatch(/mature content/i);
    // whitespace was collapsed (no runs of spaces / newlines)
    expect(r.aiDisclosureNote).not.toMatch(/\s{2,}/);
  });

  it("negative fixture with no disclosure block → {false, null}", () => {
    expect(parseAiDisclosure(html("steam_store_noai_2379780.html"))).toEqual({
      aiDisclosure: false,
      aiDisclosureNote: null,
    });
  });

  it("empty string → {false, null}", () => {
    expect(parseAiDisclosure("")).toEqual({ aiDisclosure: false, aiDisclosureNote: null });
  });

  it("heading present but no <i> note → {true, null}", () => {
    const frag = `<div><h2>AI Generated Content Disclosure</h2><p>uses AI like this:</p></div>`;
    expect(parseAiDisclosure(frag)).toEqual({ aiDisclosure: true, aiDisclosureNote: null });
  });
});

describe("wantsAiDisclosure", () => {
  const now = Date.parse("2026-07-27T00:00:00Z");

  it("recent non-AAA title → true", () => {
    expect(
      wantsAiDisclosure(game({ scaleTier: "small_indie", releaseDate: "2026-06-01" }), now),
    ).toBe(true);
  });

  it("AAA title → false (excluded from indie benchmarks anyway)", () => {
    expect(wantsAiDisclosure(game({ scaleTier: "aaa", releaseDate: "2026-06-01" }), now)).toBe(
      false,
    );
  });

  it("released ~2 years ago → false (predates the disclosure cohort)", () => {
    expect(
      wantsAiDisclosure(game({ scaleTier: "est_indie", releaseDate: "2024-07-01" }), now),
    ).toBe(false);
  });

  it("no releaseDate → false", () => {
    expect(wantsAiDisclosure(game({ scaleTier: "small_indie", releaseDate: null }), now)).toBe(
      false,
    );
  });
});
