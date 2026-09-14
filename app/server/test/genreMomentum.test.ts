import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import {
  classifyTrajectory,
  getGenreMomentum,
  getGenres,
  getGenreVelocityBars,
  getOverview,
} from "../src/queries/index.ts";

// #204 S3 — genre-level momentum reads follow each portal's vote basis and are never pooled.
// Four titles per genre per portal (the mover volume floor), four daily captures at FIXED instants
// so every title of a portal shares each capture (a per-statement now() would split them).
const T0 = Date.UTC(2026, 8, 10, 12);
const at = (daysAgo: number) => new Date(T0 - daysAgo * 86400000).toISOString();

// Per title i (0..3) the votes are (i + 1) × level, so the genre median is 2.5 × level.
const LEVELS: Record<string, Record<string, number[]>> = {
  // Poki (running total): Racing accelerates, Board is flat.
  poki: { Racing: [1000, 1050, 1200, 1450], Board: [500, 500, 500, 500] },
  // CrazyGames (recent window): Racing's engagement falls, Word's grows.
  crazygames: { Racing: [1000, 950, 900, 850], Word: [1000, 1100, 1200, 1300] },
};

async function seed(db: Querier) {
  const one = async (sql: string, p: unknown[]) => (await db.query(sql, p))[0];
  for (const [name, genres] of Object.entries(LEVELS)) {
    const sid = (
      await one(`INSERT INTO sources(name, base_url) VALUES ($1, $2) RETURNING id`, [
        name,
        `https://${name}.com`,
      ])
    ).id;
    const crawls: number[] = [];
    for (const d of [3, 2, 1, 0])
      crawls.push(
        (
          await one(
            `INSERT INTO crawls(source_id, started_at, finished_at, status, games_seen)
             VALUES ($1, $2, $2, 'ok', 0) RETURNING id`,
            [sid, at(d)],
          )
        ).id,
      );
    for (const [genre, level] of Object.entries(genres))
      for (let i = 0; i < 4; i++) {
        const title = `${name}-${genre}-${i}`;
        const gid = (
          await one(
            `INSERT INTO games(source_id, source_game_id, url, title, first_seen_at)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [sid, title, `https://${name}.com/g/${title}`, title, at(40)],
          )
        ).id;
        for (let k = 0; k < 4; k++)
          await db.query(
            `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre)
             VALUES ($1,$2,$3, 4.0, $4, $5)`,
            [gid, crawls[k], at(3 - k), (i + 1) * level[k], genre],
          );
      }
  }
}

// The genre estimator as it stood before #204 S3, kept here as the oracle Poki must still match.
const medians = (level: number[]) => level.map((l) => 2.5 * l);
const preS3VotesPerDay = (s: number[], span: number) => Math.round((s[s.length - 1] - s[0]) / span);

let db: Querier;
beforeAll(async () => {
  db = await freshMemoryDb();
  await seed(db);
}, 60000);

describe("G1 genre rows read momentum in each portal's unit", () => {
  it("Poki is the pre-S3 estimator, number for number", async () => {
    const racing = (await getGenres(db, "poki")).find((r) => r.genre === "Racing")!;
    const s = medians(LEVELS.poki.Racing);
    expect(racing.votesPerDay).toBe(preS3VotesPerDay(s, 3));
    expect(racing.votesPerDay).toBe(375);
    expect(racing.trajectory).toBe(classifyTrajectory(s, 3).trajectory);
    expect(racing.trajectory).toBe("rising");
    expect(racing.momentum).toEqual([
      {
        source: "poki",
        voteBasis: "cumulative",
        votesPerDay: 375,
        engagementPctPerWeek: null,
        trajectory: "rising",
        captures: 4,
      },
    ]);
  });
  it("CrazyGames reads signed engagement %/wk, never votes/day", async () => {
    const rows = await getGenres(db, "crazygames");
    const by = (g: string) => rows.find((r) => r.genre === g)!;
    for (const r of rows) expect(r.votesPerDay).toBeNull();
    expect(by("Racing").trajectory).toBe("decaying");
    expect(by("Racing").momentum[0]).toMatchObject({
      voteBasis: "window",
      engagementPctPerWeek: -37.8,
      captures: 4,
    });
    expect(by("Word").momentum[0]).toMatchObject({
      engagementPctPerWeek: 60.9,
      trajectory: "rising",
    });
  });
  it("on `all` a genre carries one read per portal and no pooled number", async () => {
    const racing = (await getGenres(db, "all")).find((r) => r.genre === "Racing")!;
    expect(racing.votesPerDay).toBeNull();
    expect(racing.trajectory).toBeNull();
    expect(racing.momentum.map((m) => [m.source, m.votesPerDay, m.engagementPctPerWeek])).toEqual([
      ["crazygames", null, -37.8],
      ["poki", 375, null],
    ]);
    // A portal that does not carry the genre is absent, not "new".
    const word = (await getGenres(db, "all")).find((r) => r.genre === "Word")!;
    expect(word.momentum.map((m) => m.source)).toEqual(["crazygames"]);
  });
});

describe("G2 bars and the momentum chart never share an axis across bases", () => {
  it("bars are grouped per portal and ranked on that portal's unit", async () => {
    expect(await getGenreVelocityBars(db, "poki")).toEqual([
      {
        genre: "Racing",
        source: "poki",
        voteBasis: "cumulative",
        votesPerDay: 375,
        engagementPctPerWeek: null,
      },
      {
        genre: "Board",
        source: "poki",
        voteBasis: "cumulative",
        votesPerDay: 0,
        engagementPctPerWeek: null,
      },
    ]);
    const all = await getGenreVelocityBars(db, "all");
    expect(all.map((b) => [b.source, b.genre, b.votesPerDay ?? b.engagementPctPerWeek])).toEqual([
      ["crazygames", "Word", 60.9],
      ["crazygames", "Racing", -37.8],
      ["poki", "Racing", 375],
      ["poki", "Board", 0],
    ]);
  });
  it("momentum is one level series per portal, on its own dates", async () => {
    const m = await getGenreMomentum(db, "all");
    expect(m.map((p) => [p.source, p.voteBasis, p.dates.length])).toEqual([
      ["crazygames", "window", 4],
      ["poki", "cumulative", 4],
    ]);
    expect(m[1].series[0]).toEqual({ genre: "Racing", values: medians(LEVELS.poki.Racing) });
    expect((await getGenreMomentum(db, "poki")).map((p) => p.source)).toEqual(["poki"]);
  });
});

describe("G3 KPI, read and RISING insight name the unit, and the portal on `all`", () => {
  const moverLine = (read: string[]) => read.find((l) => /mover/.test(l)) ?? "";
  const rising = (ov: Awaited<ReturnType<typeof getOverview>>) =>
    ov.insights.filter((i) => i.tag === "RISING");

  it("Poki keeps its votes/day wording and numbers", async () => {
    const ov = await getOverview(db, "poki");
    expect(ov.kpi).toMatchObject({ risingGenre: "Racing", risingVotesPerDay: 375 });
    expect(ov.kpi.risingByPortal).toHaveLength(1);
    expect(moverLine(ov.read)).toBe(
      "<b>Racing</b> is the biggest mover at +375 votes/day and accelerating. → Demand is shifting toward it — weight new pitches accordingly.",
    );
    expect(rising(ov)).toEqual([
      {
        kind: "up",
        tag: "RISING",
        meta: "+375 votes/day",
        text: "<b>Racing</b> is gaining the most votes/day across the window.",
        implication: "demand is shifting toward Racing — weight new loop tests accordingly",
      },
    ]);
  });
  it("CrazyGames speaks engagement %/wk and never votes/day", async () => {
    const ov = await getOverview(db, "crazygames");
    expect(ov.kpi).toMatchObject({ risingGenre: "Word", risingVotesPerDay: null });
    expect(ov.kpi.risingByPortal[0]).toMatchObject({ genre: "Word", engagementPctPerWeek: 60.9 });
    expect(moverLine(ov.read)).toBe(
      "<b>Word</b> is the biggest mover at +60.9%/wk in recent engagement and climbing. → Demand is shifting toward it — weight new pitches accordingly.",
    );
    const [ins] = rising(ov);
    expect(ins.meta).toBe("+60.9%/wk recent engagement");
    expect(ins.text).toBe(
      "<b>Word</b> shows the strongest growth in recent engagement across the window.",
    );
    const said = [...ov.read, ...ov.insights.map((i) => i.text + i.meta)].join(" ");
    expect(said).not.toMatch(/votes\/day/);
  });
  it("`all` names each portal with its unit and pools nothing", async () => {
    const ov = await getOverview(db, "all");
    expect(ov.kpi.risingGenre).toBeNull();
    expect(ov.kpi.risingVotesPerDay).toBeNull();
    expect(ov.kpi.risingByPortal.map((r) => [r.source, r.genre])).toEqual([
      ["crazygames", "Word"],
      ["poki", "Racing"],
    ]);
    expect(moverLine(ov.read)).toBe(
      "Biggest movers, each in its portal's own unit — CrazyGames: <b>Word</b> at +60.9%/wk in recent engagement and climbing; Poki: <b>Racing</b> at +375 votes/day and accelerating. → Demand is shifting toward them — weight new pitches accordingly.",
    );
    expect(ov.read.length).toBeLessThanOrEqual(3);
    expect(rising(ov).map((i) => [i.meta, i.text])).toEqual([
      [
        "CrazyGames · +60.9%/wk recent engagement",
        "On CrazyGames, <b>Word</b> shows the strongest growth in recent engagement across the window.",
      ],
      [
        "Poki · +375 votes/day",
        "On Poki, <b>Racing</b> is gaining the most votes/day across the window.",
      ],
    ]);
    expect(ov.momentum.map((m) => m.source)).toEqual(["crazygames", "poki"]);
  });
});
