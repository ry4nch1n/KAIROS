import { describe, it, expect } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { getHiddenGems, bayesianGemScore, classifyTrajectory } from "../src/queries/index.ts";

// issue #8 — sample-size gate on Hidden Gems.

describe("H1 bayesianGemScore shrinks thin-sample ratings toward the mean", () => {
  it("a 1-vote 5.0 scores below a well-supported 4.8", () => {
    expect(bayesianGemScore(5.0, 1)).toBeLessThan(bayesianGemScore(4.8, 1000));
  });
  it("with many votes it converges to the raw rating", () => {
    expect(bayesianGemScore(4.8, 100000)).toBeCloseTo(4.8, 2);
  });
  it("with zero votes it equals the prior mean", () => {
    expect(bayesianGemScore(5.0, 0)).toBeCloseTo(4.2, 6);
  });
});

async function seed(db: Querier) {
  const one = async (sql: string, p: unknown[]) => (await db.query(sql, p))[0];
  const sid = (
    await one(
      "INSERT INTO sources(name, base_url) VALUES ('poki','https://poki.com') RETURNING id",
      [],
    )
  ).id;
  const cid = (
    await one(
      "INSERT INTO crawls(source_id, started_at, finished_at, status, games_seen) VALUES ($1, now(), now(), 'ok', 0) RETURNING id",
      [sid],
    )
  ).id;
  const add = async (title: string, rating: number, votes: number) => {
    const gid = (
      await one(
        "INSERT INTO games(source_id, source_game_id, url, title) VALUES ($1,$2,$3,$4) RETURNING id",
        [sid, title, `https://poki.com/g/${title}`, title],
      )
    ).id;
    await db.query(
      "INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre) VALUES ($1,$2, now(), $3,$4,'Puzzle')",
      [gid, cid, rating, votes],
    );
  };
  // a "crowd" of well-supported, mid-rated games (neither top-rating nor bottom-votes)
  for (let i = 0; i < 12; i++) await add(`Crowd${i}`, 3.9 + (i % 5) * 0.1, 200 + i * 200);
  await add("Flukey", 5.0, 1); // perfect score, 1 vote — must be excluded by the floor
  await add("TrueGem", 4.9, 35); // high rating, low visibility, ABOVE the floor — a real gem
}

describe("H2 getHiddenGems gates on the minimum-vote floor", () => {
  it("excludes a 1-vote 5.0 fluke but keeps a real low-visibility gem", async () => {
    const db = await freshMemoryDb();
    await seed(db);
    const titles = (await getHiddenGems(db, "poki")).map((g) => g.title);
    expect(titles).not.toContain("Flukey");
    expect(titles).toContain("TrueGem");
  });
});

// issue #176 — the discovery axis. High rating × low votes is ONE axis, and on it a game
// the audience is only now finding is indistinguishable from one that shipped years ago
// and stalled. These two seeds are identical on rating and cumulative votes and differ
// only in age + vote momentum, so nothing but the new fields can tell them apart.
async function seedDiscovery(db: Querier) {
  const one = async (sql: string, p: unknown[]) => (await db.query(sql, p))[0];
  const sid = (
    await one(
      "INSERT INTO sources(name, base_url) VALUES ('poki','https://poki.com') RETURNING id",
      [],
    )
  ).id;
  // One crawl per capture day — game_snapshots is UNIQUE(game_id, crawl_id), which is
  // exactly the append-only "one row per game per crawl" rule the real loader obeys.
  const crawls = new Map<number, number>();
  const crawlFor = async (daysAgo: number): Promise<number> => {
    let id = crawls.get(daysAgo);
    if (id === undefined) {
      id = (
        await one(
          `INSERT INTO crawls(source_id, started_at, finished_at, status, games_seen)
           VALUES ($1, now() - ($2 || ' days')::interval, now() - ($2 || ' days')::interval, 'ok', 0) RETURNING id`,
          [sid, String(daysAgo)],
        )
      ).id;
      crawls.set(daysAgo, id!);
    }
    return id!;
  };
  const add = async (
    title: string,
    rating: number,
    series: [number, number][],
    ageDays: number,
  ) => {
    const gid = (
      await one(
        `INSERT INTO games(source_id, source_game_id, url, title, first_seen_at)
         VALUES ($1,$2,$3,$4, now() - ($5 || ' days')::interval) RETURNING id`,
        [sid, title, `https://poki.com/g/${title}`, title, String(ageDays)],
      )
    ).id;
    for (const [daysAgo, votes] of series)
      await db.query(
        `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre)
         VALUES ($1,$2, now() - ($3 || ' days')::interval, $4,$5,'Puzzle')`,
        [gid, await crawlFor(daysAgo), String(daysAgo), rating, votes],
      );
  };
  for (let i = 0; i < 12; i++) await add(`Crowd${i}`, 3.9 + (i % 5) * 0.1, [[0, 200 + i * 200]], 0);
  // Same rating, same 60 cumulative votes, same gem classification — opposite stories.
  await add(
    "BeingFound",
    4.9,
    [
      [8, 10],
      [4, 20],
      [0, 60],
    ],
    30,
  );
  await add(
    "Stalled",
    4.9,
    [
      [8, 60],
      [4, 60],
      [0, 60],
    ],
    800,
  );
  // #192: the cohort's REAL shape — a gem climbing at a fraction of a vote per day. Three
  // votes over thirty days is under-discovered AND improving, and integer rounding printed it
  // as "+0" beside a "rising" chip, which is the panel lying about its own new axis.
  await add(
    "Trickle",
    4.9,
    [
      [30, 100],
      [15, 101],
      [0, 103],
    ],
    60,
  );
}

describe("H3 getHiddenGems annotates discovery age and vote momentum (#176)", () => {
  it("separates a gem still being found from one that stalled years ago", async () => {
    const db = await freshMemoryDb();
    await seedDiscovery(db);
    const gems = await getHiddenGems(db, "poki");
    const found = gems.find((g) => g.title === "BeingFound");
    const stalled = gems.find((g) => g.title === "Stalled");
    expect(found, "BeingFound must qualify as a gem").toBeTruthy();
    expect(stalled, "Stalled must qualify as a gem").toBeTruthy();
    // Identical on the old one-axis read...
    expect(found!.rating).toBeCloseTo(stalled!.rating, 6);
    expect(found!.votes).toBe(stalled!.votes);
    // ...and separated only by the added axis.
    expect(found!.votesPerDay).toBeGreaterThan(0);
    expect(stalled!.votesPerDay).toBe(0);
    expect(found!.trajectory).toBe("rising");
    expect(stalled!.trajectory).toBe("plateau");
    expect(stalled!.daysTracked).toBeGreaterThan(found!.daysTracked);
    expect(found!.daysTracked).toBeGreaterThanOrEqual(29);
    expect(found!.daysTracked).toBeLessThanOrEqual(31);
  });
});

describe("H4 the discovery rate survives the low-vote cohort it was built for (#192)", () => {
  it("a gem gaining a fraction of a vote per day reports that fraction, not 0", async () => {
    const db = await freshMemoryDb();
    await seedDiscovery(db);
    const gems = await getHiddenGems(db, "poki");
    const trickle = gems.find((g) => g.title === "Trickle");
    expect(trickle, "Trickle must qualify as a gem").toBeTruthy();
    // 3 votes over 30 days = 0.1/day. The old integer rounding reported this as 0.
    expect(trickle!.votesPerDay).toBeCloseTo(0.1, 6);
    expect(trickle!.trajectory).toBe("rising");
  });
  it("no row can pair a rising chip with a zero rate — the two are derived to agree", async () => {
    const db = await freshMemoryDb();
    await seedDiscovery(db);
    for (const g of await getHiddenGems(db, "poki"))
      if (g.trajectory === "rising") expect(g.votesPerDay).toBeGreaterThan(0);
  });
  it("classifyTrajectory keeps two decimals, floors a real gain at 0.01, and never calls a net-flat window rising", () => {
    expect(classifyTrajectory([100, 101, 103], 30).votesPerDay).toBeCloseTo(0.1, 6);
    // A gain too small even for two decimals still reports something rather than nothing.
    const tiny = classifyTrajectory([1000, 1000, 1001], 400);
    expect(tiny.votesPerDay).toBe(0.01);
    expect(tiny.trajectory).toBe("rising");
    // A mid-window recount can leave `late > early` on a window that netted nothing; the label
    // follows the number rather than contradicting it.
    const dipped = classifyTrajectory([100, 50, 60], 10);
    expect(dipped.votesPerDay).toBe(0);
    expect(dipped.trajectory).not.toBe("rising");
    // High-traffic rows are unchanged in the reading that matters: still whole-number scale.
    expect(classifyTrajectory([100, 20000, 167000], 14).votesPerDay).toBeGreaterThan(1000);
  });
});
