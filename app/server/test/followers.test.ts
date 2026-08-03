// Steam follower capture (#54). Followers = the app community group's member count — the
// closest public proxy to wishlists. Pure-parser coverage over two REAL captured responses,
// plus a round-trip proving the snapshot column stores it (and stores absence as NULL).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFollowerCount } from "../src/crawler/steam.ts";
import { loadGames } from "../src/crawler/load.ts";
import { freshMemoryDb } from "../src/db/db.ts";
import type { RawGame } from "../src/crawler/base.ts";

const fixture = (name: string) =>
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

describe("parseFollowerCount", () => {
  it("real memberslistxml → the <groupDetails> count, NOT the inflated top-level one", () => {
    // Landmine: the document carries TWO <memberCount> elements. The groupDetails one (112742)
    // is the follower number third-party trackers agree with; the top-level one (115551) is
    // 2–9% higher because it counts limited/banned accounts. Picking the wrong one is silent.
    const xml = fixture("steam_members_2379780.xml");
    expect(parseFollowerCount(xml)).toBe(112742);
    expect(parseFollowerCount(xml)).not.toBe(115551);
  });

  it("HTML 'Steam Community :: Error' page served at HTTP 200 → null, never 0", () => {
    // THE regression that matters: apps with no community group (DLC, bogus appids, Spacewar
    // 480) return a 23 KB HTML error page with a 200 status, so the status code proves nothing.
    // A 0 here would be read downstream as "measured, nobody follows it" — a real signal.
    expect(parseFollowerCount(fixture("steam_members_error_480.html"))).toBeNull();
  });

  it("empty / malformed input → null", () => {
    expect(parseFollowerCount("")).toBeNull();
    expect(parseFollowerCount(null)).toBeNull();
    // Envelope present but no groupDetails block — still unknown, not zero.
    expect(
      parseFollowerCount("<memberList><memberCount>999</memberCount></memberList>"),
    ).toBeNull();
  });

  it("a genuine zero-member group is preserved as 0 (measured), distinct from null", () => {
    const frag =
      "<memberList><groupDetails><memberCount>0</memberCount></groupDetails></memberList>";
    expect(parseFollowerCount(frag)).toBe(0);
  });
});

describe("followers round-trip into game_snapshots", () => {
  it("stores a measured count and writes NULL when not measured", async () => {
    const db = await freshMemoryDb();
    await loadGames(
      db,
      "steam",
      "https://store.steampowered.com",
      [
        game({ sourceGameId: "a", title: "Measured", followers: 112742 }),
        game({ sourceGameId: "b", title: "Unmeasured" }), // AAA / no group / fetch failed
      ],
      "2026-08-03",
    );
    const rows = await db.query(
      `SELECT g.title, s.followers FROM game_snapshots s JOIN games g ON g.id = s.game_id ORDER BY g.title`,
    );
    expect(Number(rows[0].followers)).toBe(112742);
    expect(rows[1].followers).toBeNull();
  });
});
