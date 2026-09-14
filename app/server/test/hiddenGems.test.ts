import { describe, it, expect } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import {
  getHiddenGems,
  getInsights,
  getNewReleases,
  bayesianGemScore,
  classifyEngagement,
  classifyTrajectory,
  voteBasisOf,
  voteMomentumOf,
  VOTE_BASIS,
} from "../src/queries/index.ts";

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
  // #204: the portal revised its first count down (103 → 100), then the gem climbed back.
  // Last − first nets the whole window to 0; every capture in between says it is gaining.
  await add(
    "Revised",
    4.9,
    [
      [12, 103],
      [9, 100],
      [6, 101],
      [3, 102],
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

describe("H5 the discovery rate is a least-squares slope, not two endpoints (#204)", () => {
  it("a downward portal revision no longer nets a gaining window to 0", () => {
    // Net delta 103 − 103 = 0 was the old reading; the fit over all five points is +0.2/day.
    const r = classifyTrajectory([103, 100, 101, 102, 103], 4);
    expect(r.votesPerDay).toBeCloseTo(0.2, 6);
    expect(r.trajectory).toBe("rising");
  });
  it("the seeded revised gem reports a positive rate end to end", async () => {
    const db = await freshMemoryDb();
    await seedDiscovery(db);
    const revised = (await getHiddenGems(db, "poki")).find((g) => g.title === "Revised");
    expect(revised, "Revised must qualify as a gem").toBeTruthy();
    // 0.2 votes per 3-day capture step = 1/15 per day.
    expect(revised!.votesPerDay).toBeCloseTo(0.07, 6);
    expect(revised!.trajectory).toBe("rising");
  });
  it("a flat series reads 0 and plateau", () => {
    expect(classifyTrajectory([50, 50, 50, 50], 9)).toEqual({
      votesPerDay: 0,
      trajectory: "plateau",
    });
  });
  it("fewer than two usable points is 'new' (no data), never a measured rate", () => {
    expect(classifyTrajectory([500], 5)).toEqual({ votesPerDay: 0, trajectory: "new" });
    expect(classifyTrajectory([Number.NaN, 500], 5).trajectory).toBe("new");
    expect(classifyTrajectory([500, 510], 3, [2, 2]).trajectory).toBe("new"); // no time span
  });
  it("uses real capture instants when given, so an uneven cadence can't bend the slope", () => {
    // t = 0, 1, 11 days: fit = 70 / 74 votes/day (evenly spaced would read 10 / 11).
    expect(classifyTrajectory([100, 100, 110], 11, [0, 1, 11]).votesPerDay).toBeCloseTo(0.95, 6);
  });
  it("a rising chip never sits beside a flat or falling rate, across noisy series", () => {
    let seed = 204;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647; // Park–Miller: deterministic, exact in doubles
      return seed / 2147483647;
    };
    for (let k = 0; k < 500; k++) {
      const len = 2 + Math.floor(rnd() * 7);
      const series: number[] = [];
      let v = 100;
      for (let i = 0; i < len; i++) {
        v += Math.round((rnd() - 0.45) * 6);
        series.push(v);
      }
      const r = classifyTrajectory(series, len * 2);
      if (r.trajectory === "rising") expect(r.votesPerDay).toBeGreaterThan(0);
      expect(r.votesPerDay).toBeGreaterThanOrEqual(0);
    }
  });
});

// #204 — CrazyGames' vote count is a rolling window of recent engagement (it falls a little most
// days); Poki's is a running total. Each row is read in its own portal's unit.
describe("H6 vote basis: one mapping, and a window series reads as signed engagement change", () => {
  it("maps each portal to its measured basis; an unmeasured source stays cumulative", () => {
    expect(VOTE_BASIS).toEqual({ poki: "cumulative", crazygames: "window" });
    expect(voteBasisOf("poki")).toBe("cumulative");
    expect(voteBasisOf("crazygames")).toBe("window");
    expect(voteBasisOf("steam")).toBe("cumulative");
    expect(voteBasisOf("some-new-portal")).toBe("cumulative");
  });
  it("a production-shaped falling window reads as negative %/wk with no votes/day", () => {
    // Daily captures 500 → 490 → 480 → 485: slope −5.5/day over a 488.75 mean = −7.9%/wk.
    const r = voteMomentumOf("window", [500, 490, 480, 485], 3, [0, 1, 2, 3]);
    expect(r).toEqual({ votesPerDay: null, engagementPctPerWeek: -7.9, trajectory: "decaying" });
  });
  it("deadband: small moves plateau, and one capture pair reports its % but mints no chip", () => {
    expect(classifyEngagement([1000, 1003, 1002, 1004], 3).trajectory).toBe("plateau");
    expect(classifyEngagement([400, 420, 440, 460], 3)).toEqual({
      engagementPctPerWeek: 32.6,
      trajectory: "rising",
    });
    expect(classifyEngagement([300, 290], 1)).toEqual({
      engagementPctPerWeek: -23.7,
      trajectory: "plateau",
    });
  });
  it("no measurable series is null and 'new' — never a measured 0", () => {
    const none = { engagementPctPerWeek: null, trajectory: "new" };
    expect(classifyEngagement([500], 5)).toEqual(none);
    expect(classifyEngagement([500, 510], 3, [2, 2])).toEqual(none); // no time span
    expect(classifyEngagement([0, 0, 0], 2)).toEqual(none); // mean level ≤ 0
    expect(classifyEngagement([500, 500, 500], 2)).toEqual({
      engagementPctPerWeek: 0,
      trajectory: "plateau",
    });
  });
  it("the cumulative path is exactly classifyTrajectory, with no engagement figure", () => {
    for (const s of [[100, 101, 103], [50, 50, 50], [500], [103, 100, 101, 102, 103]])
      expect(voteMomentumOf("cumulative", s, 4)).toEqual({
        ...classifyTrajectory(s, 4),
        engagementPctPerWeek: null,
      });
  });
  it("a window chip never contradicts its signed change, across noisy series", () => {
    let seed = 2041;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let k = 0; k < 500; k++) {
      const len = 2 + Math.floor(rnd() * 7);
      const series: number[] = [];
      let v = 50 + Math.floor(rnd() * 5000);
      for (let i = 0; i < len; i++) {
        v = Math.max(1, v + Math.round((rnd() - 0.5) * v * 0.08));
        series.push(v);
      }
      const r = voteMomentumOf("window", series, len - 1);
      expect(r.votesPerDay).toBeNull();
      if (r.trajectory === "rising") expect(r.engagementPctPerWeek).toBeGreaterThan(0);
      if (r.trajectory === "decaying") expect(r.engagementPctPerWeek).toBeLessThan(0);
    }
  });
});

/** Two portals, each with a crowd and a few gems whose vote series are shaped like production. */
async function seedPortals(db: Querier) {
  const one = async (sql: string, p: unknown[]) => (await db.query(sql, p))[0];
  type Title = [string, number, [number, number][], number]; // title, rating, [daysAgo, votes][], age
  const portal = async (name: string, titles: Title[]) => {
    const sid = (
      await one(`INSERT INTO sources(name, base_url) VALUES ($1, $2) RETURNING id`, [
        name,
        `https://${name}.com`,
      ])
    ).id;
    const crawls = new Map<number, number>();
    const crawlFor = async (daysAgo: number) => {
      if (!crawls.has(daysAgo))
        crawls.set(
          daysAgo,
          (
            await one(
              `INSERT INTO crawls(source_id, started_at, finished_at, status, games_seen)
               VALUES ($1, now() - ($2 || ' days')::interval, now(), 'ok', 0) RETURNING id`,
              [sid, String(daysAgo)],
            )
          ).id,
        );
      return crawls.get(daysAgo)!;
    };
    const crowd: Title[] = Array.from({ length: 12 }, (_, i) => [
      `${name}Crowd${i}`,
      3.9 + (i % 5) * 0.1,
      [[0, 1000 + i * 500]],
      0,
    ]);
    for (const [title, rating, series, age] of [...crowd, ...titles]) {
      const gid = (
        await one(
          `INSERT INTO games(source_id, source_game_id, url, title, first_seen_at)
           VALUES ($1,$2,$3,$4, now() - ($5 || ' days')::interval) RETURNING id`,
          [sid, title, `https://${name}.com/g/${title}`, title, String(age)],
        )
      ).id;
      for (const [daysAgo, votes] of series)
        await db.query(
          `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre)
           VALUES ($1,$2, now() - ($3 || ' days')::interval, $4,$5,'Puzzle')`,
          [gid, await crawlFor(daysAgo), String(daysAgo), rating, votes],
        );
    }
  };
  await portal("crazygames", [
    [
      "CgFading",
      4.9,
      [
        [3, 500],
        [2, 490],
        [1, 480],
        [0, 485],
      ],
      40,
    ],
    [
      "CgClimbing",
      4.8,
      [
        [3, 400],
        [2, 420],
        [1, 440],
        [0, 460],
      ],
      5,
    ],
    [
      "CgTwoCaps",
      4.85,
      [
        [1, 300],
        [0, 290],
      ],
      40,
    ],
  ]);
  await portal("poki", [
    [
      "PkGem",
      4.9,
      [
        [2, 100],
        [1, 101],
        [0, 103],
      ],
      5,
    ],
  ]);
}

describe("H7 Hidden Gems and New Releases carry each row's source, basis and unit (#204)", () => {
  it("CrazyGames gems read engagement %/wk with null votes/day; Poki gems are unchanged", async () => {
    const db = await freshMemoryDb();
    await seedPortals(db);
    const cg = await getHiddenGems(db, "crazygames");
    const by = (t: string) => cg.find((g) => g.title === t);
    for (const g of cg) {
      expect(g.source).toBe("crazygames");
      expect(g.voteBasis).toBe("window");
      expect(g.votesPerDay).toBeNull();
    }
    expect(by("CgFading")).toMatchObject({ engagementPctPerWeek: -7.9, trajectory: "decaying" });
    expect(by("CgClimbing")).toMatchObject({ engagementPctPerWeek: 32.6, trajectory: "rising" });
    expect(by("CgTwoCaps")).toMatchObject({ engagementPctPerWeek: -23.7, trajectory: "plateau" });
    const pk = (await getHiddenGems(db, "poki")).find((g) => g.title === "PkGem");
    expect(pk).toMatchObject({
      source: "poki",
      voteBasis: "cumulative",
      votesPerDay: 1.5,
      engagementPctPerWeek: null,
      trajectory: "rising",
    });
    // On `all` each row still keeps its own portal's unit.
    const all = await getHiddenGems(db, "all");
    expect(all.find((g) => g.title === "PkGem")?.voteBasis).toBe("cumulative");
    expect(all.find((g) => g.title === "CgFading")?.voteBasis).toBe("window");
  });
  it("New Releases apply the same split, including rows with no series yet", async () => {
    const db = await freshMemoryDb();
    await seedPortals(db);
    const cg = await getNewReleases(db, "crazygames");
    expect(cg.find((r) => r.title === "CgClimbing")).toMatchObject({
      source: "crazygames",
      voteBasis: "window",
      votesPerDay: null,
      engagementPctPerWeek: 32.6,
    });
    expect(cg.find((r) => r.title === "crazygamesCrowd0")).toMatchObject({
      votesPerDay: null,
      engagementPctPerWeek: null,
      trajectory: "new",
    });
    const pk = await getNewReleases(db, "poki");
    expect(pk.find((r) => r.title === "PkGem")).toMatchObject({
      voteBasis: "cumulative",
      votesPerDay: 1.5,
      engagementPctPerWeek: null,
    });
    expect(pk.find((r) => r.title === "pokiCrowd0")).toMatchObject({
      votesPerDay: 0,
      trajectory: "new",
    });
  });
  it("the Hidden Gems insight counts a gem as climbing only on a positive read in its own unit", async () => {
    const db = await freshMemoryDb();
    await seedPortals(db);
    const gem = (await getInsights(db, "crazygames")).find((i) => i.kind === "gem");
    // Only CgClimbing: CgFading and CgTwoCaps are losing engagement.
    expect(gem?.meta).toBe("3 found · 1 still climbing");
  });
});
