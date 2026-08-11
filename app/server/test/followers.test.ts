// Steam follower capture (#54). Followers = the app community group's member count — the
// closest public proxy to wishlists. Pure-parser coverage over two REAL captured responses,
// plus a round-trip proving the snapshot column stores it (and stores absence as NULL).
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseFollowerCount,
  wantsFollowers,
  fetchFollowers,
  resetFollowerRun,
  followerRunState,
  FOLLOWER_MAX_CONSECUTIVE_FAILURES,
} from "../src/crawler/steam.ts";
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

// #54 (reopened): the follower cohort was every coming-soon OR non-AAA title (~113 fetches/run)
// and CI got 429 on all of them. It is now coming-soon only — the cohort where followers are the
// ONLY demand signal.
describe("wantsFollowers — the coming-soon cohort", () => {
  it("fetches for coming-soon titles at any tier", () => {
    expect(wantsFollowers(game({ comingSoon: true, scaleTier: "hobby" }))).toBe(true);
    expect(wantsFollowers(game({ comingSoon: true, scaleTier: "aaa" }))).toBe(true);
  });

  it("skips released titles — followers there largely restate the review count", () => {
    expect(wantsFollowers(game({ comingSoon: false, scaleTier: "small_indie" }))).toBe(false);
    expect(wantsFollowers(game({ scaleTier: "est_indie" }))).toBe(false); // comingSoon undefined
    expect(wantsFollowers(game({ comingSoon: null, scaleTier: "hobby" }))).toBe(false);
  });
});

const XML = "<memberList><groupDetails><memberCount>4242</memberCount></groupDetails></memberList>";
const NO_DELAYS: number[] = []; // no retries: keeps the breaker tests instant

describe("fetchFollowers — backoff + per-run circuit breaker", () => {
  beforeEach(() => resetFollowerRun());

  it("never throws; a rejecting host yields null", async () => {
    const boom = async () => {
      throw new Error("fetch … -> 429");
    };
    await expect(fetchFollowers(1, boom, NO_DELAYS)).resolves.toBeNull();
  });

  it("retries on failure, then succeeds — one attempt, one capture", async () => {
    let calls = 0;
    const flaky = async () => {
      if (++calls === 1) throw new Error("fetch … -> 429");
      return XML;
    };
    expect(await fetchFollowers(1, flaky, [0])).toBe(4242);
    expect(calls).toBe(2);
    expect(followerRunState()).toMatchObject({ attempts: 1, captured: 1, consecutiveFailures: 0 });
  });

  it("opens the breaker after N consecutive failures and stops fetching for the run", async () => {
    let calls = 0;
    const boom = async () => {
      calls++;
      throw new Error("fetch … -> 429");
    };
    for (let i = 0; i < FOLLOWER_MAX_CONSECUTIVE_FAILURES; i++)
      expect(await fetchFollowers(i, boom, NO_DELAYS)).toBeNull();
    expect(followerRunState().tripped).toBe(true);

    const callsWhenTripped = calls;
    for (let i = 0; i < 50; i++) expect(await fetchFollowers(i, boom, NO_DELAYS)).toBeNull();
    expect(calls).toBe(callsWhenTripped); // not one more request to a host that said no
    expect(followerRunState().attempts).toBe(FOLLOWER_MAX_CONSECUTIVE_FAILURES);
  });

  it("a 200 with no community group is 'unknown', not a breaker failure", async () => {
    const noGroup = async () => "<html>Steam Community :: Error</html>";
    for (let i = 0; i < FOLLOWER_MAX_CONSECUTIVE_FAILURES * 3; i++)
      expect(await fetchFollowers(i, noGroup, NO_DELAYS)).toBeNull();
    expect(followerRunState()).toMatchObject({ tripped: false, captured: 0 });
  });

  it("an intervening success resets the consecutive-failure run", async () => {
    const boom = async () => {
      throw new Error("fetch … -> 429");
    };
    const ok = async () => XML;
    for (let i = 0; i < FOLLOWER_MAX_CONSECUTIVE_FAILURES - 1; i++)
      await fetchFollowers(i, boom, NO_DELAYS);
    await fetchFollowers(99, ok, NO_DELAYS);
    for (let i = 0; i < FOLLOWER_MAX_CONSECUTIVE_FAILURES - 1; i++)
      await fetchFollowers(i, boom, NO_DELAYS);
    expect(followerRunState().tripped).toBe(false);
  });

  it("resetFollowerRun closes the breaker for the next crawl", async () => {
    const boom = async () => {
      throw new Error("fetch … -> 429");
    };
    for (let i = 0; i < FOLLOWER_MAX_CONSECUTIVE_FAILURES; i++)
      await fetchFollowers(i, boom, NO_DELAYS);
    expect(followerRunState().tripped).toBe(true);
    resetFollowerRun();
    expect(await fetchFollowers(1, async () => XML, NO_DELAYS)).toBe(4242);
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
