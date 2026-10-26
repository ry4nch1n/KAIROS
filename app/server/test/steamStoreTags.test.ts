// #264: coming-soon titles get their user tags from the Steam store page (SteamSpy has none
// pre-release), so game_tags fills and the upcoming baseline's tag scope stops being empty.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freshMemoryDb } from "../src/db/db.ts";
import { loadGames } from "../src/crawler/load.ts";
import {
  fetchStoreTags,
  parseStoreTags,
  resetStoreTagRun,
  STORE_TAG_MAX_CONSECUTIVE_FAILURES,
  storeTagRunState,
  wantsStoreTags,
} from "../src/crawler/steam.ts";
import type { RawGame } from "../src/crawler/base.ts";

const html = readFileSync(
  fileURLToPath(new URL("./fixtures/steam_store_tags_comingsoon_2295170.html", import.meta.url)),
  "utf8",
);
const TOP10 = [
  "Early Access",
  "Action RPG",
  "Pixel Graphics",
  "Action-Adventure",
  "RPG",
  "Indie",
  "Exploration",
  "PvE",
  "Dark Fantasy",
  "Character Customization",
];

describe("#264 parseStoreTags (real coming-soon store page)", () => {
  it("reads the popular user tags in page order, capped at 10 like SteamSpy's top tags", () => {
    expect(parseStoreTags(html)).toEqual(TOP10);
    const all = parseStoreTags(html, 50);
    expect(all).toHaveLength(20);
    expect(all.at(-1)).toBe("Farming");
    expect(all).not.toContain("+"); // the add_button is never a tag
  });

  it("no glance block → [] (nothing captured), and entities decode", () => {
    expect(parseStoreTags("<html>age gate</html>")).toEqual([]);
    expect(parseStoreTags(null)).toEqual([]);
    const tiny = `<div class="glance_tags popular_tags"><a class="app_tag" href="#">
      Beat &#39;em up </a><a class="app_tag">Hack &amp; Slash</a><div class="app_tag add_button">+</div>`;
    expect(parseStoreTags(tiny)).toEqual(["Beat 'em up", "Hack & Slash"]);
  });
});

const game = (over: Partial<RawGame>): RawGame => ({
  sourceGameId: "2295170",
  url: "https://store.steampowered.com/app/2295170",
  title: "Emberville",
  thumbnailUrl: null,
  developer: null,
  description: null,
  engine: null,
  orientation: null,
  mobile: false,
  genre: "Action",
  tags: [],
  rating: null,
  votes: null,
  featured: false,
  releaseDate: null,
  plays: null,
  comingSoon: true,
  ...over,
});

describe("#264 store-tag fetch: gating, yield counters, breaker", () => {
  beforeEach(() => resetStoreTagRun());

  it("only coming-soon rows that SteamSpy left untagged are eligible", () => {
    expect(wantsStoreTags(game({}))).toBe(true);
    expect(wantsStoreTags(game({ tags: ["Indie"] }))).toBe(false);
    expect(wantsStoreTags(game({ comingSoon: false }))).toBe(false);
  });

  it("counts captured/attempted for the `tags captured k/m` log line", async () => {
    expect(await fetchStoreTags(1, async () => html)).toEqual(TOP10);
    expect(await fetchStoreTags(2, async () => "<html>no tags</html>")).toEqual([]);
    expect(storeTagRunState()).toMatchObject({ attempts: 2, captured: 1, tripped: false });
  });

  it("fails soft, and stops asking after consecutive failures", async () => {
    const boom = async () => {
      throw new Error("429");
    };
    for (let i = 0; i < STORE_TAG_MAX_CONSECUTIVE_FAILURES; i++) {
      expect(await fetchStoreTags(i, boom)).toEqual([]);
    }
    let called = false;
    expect(
      await fetchStoreTags(99, async () => {
        called = true;
        return html;
      }),
    ).toEqual([]);
    expect(called).toBe(false);
    expect(storeTagRunState()).toMatchObject({ tripped: true });
  });

  it("captured tags land in game_tags for the coming-soon row", async () => {
    const db = await freshMemoryDb();
    const g = game({});
    g.tags = await fetchStoreTags(2295170, async () => html);
    await loadGames(db, "steam", "https://store.steampowered.com", [g], "2026-10-26");
    const r = await db.query(
      `SELECT t.name FROM games g JOIN game_tags gt ON gt.game_id = g.id
         JOIN tags t ON t.id = gt.tag_id WHERE g.source_game_id = '2295170' ORDER BY t.name`,
    );
    expect(r.map((x) => x.name)).toEqual([...TOP10].sort());
  });
});
