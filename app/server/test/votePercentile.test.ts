import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import {
  getGenreLandscape,
  getGenreQuadrant,
  getGenres,
  getHiddenGems,
  getLoopFamilyMarket,
  getMarketGaps,
  getNewReleases,
  getOverview,
  getScatter,
  interleaveByPortal,
  levelUnitOf,
  voteLevel,
} from "../src/queries/index.ts";

// #204 S4 — vote LEVELS on `all` use within-portal percentiles. Two portals whose raw counts differ
// by two orders of magnitude (Poki ×4000, CrazyGames ×40) but share one within-portal shape: on
// `all` every level read must treat them as equals, and each single portal must read as before.
const T0 = Date.UTC(2026, 8, 10, 12);
const at = (minutesAgo: number) => new Date(T0 - minutesAgo * 60000).toISOString();

const UNIT: Record<string, number> = { poki: 4000, crazygames: 40 };
// Each portal's high-rated, low-vote title per genre. CrazyGames' ratings run higher, as measured.
const GEM_RATING: Record<string, Record<string, number>> = {
  poki: { Puzzle: 4.6, Racing: 4.55 },
  crazygames: { Puzzle: 4.9, Racing: 4.85 },
};
const GENRE_TAG: Record<string, string> = { Puzzle: "Merge", Racing: "Drift" };

type One = (sql: string, p?: unknown[]) => Promise<Record<string, any>>;
const oneOf =
  (db: Querier): One =>
  async (sql, p = []) =>
    (await db.query(sql, p))[0];

async function source(db: Querier, name: string) {
  const one = oneOf(db);
  const sid = (
    await one(`INSERT INTO sources(name, base_url) VALUES ($1,$2) RETURNING id`, [
      name,
      `https://${name}.com`,
    ])
  ).id;
  const cid = (
    await one(
      `INSERT INTO crawls(source_id, started_at, finished_at, status, games_seen) VALUES ($1,$2,$2,'ok',0) RETURNING id`,
      [sid, at(0)],
    )
  ).id;
  return { sid, cid };
}
async function title(
  db: Querier,
  s: { sid: number; cid: number },
  t: { name: string; votes: number | null; rating?: number; genre?: string; seen?: number },
  tags: string[] = [],
) {
  const one = oneOf(db);
  const gid = (
    await one(
      `INSERT INTO games(source_id, source_game_id, url, title, first_seen_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [s.sid, t.name, `https://x.com/${t.name}`, t.name, at(t.seen ?? 60 * 24 * 40)],
    )
  ).id;
  await db.query(
    `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre) VALUES ($1,$2,$3,$4,$5,$6)`,
    [gid, s.cid, at(0), t.rating ?? 4.0, t.votes, t.genre ?? "Puzzle"],
  );
  for (const tag of tags) {
    const tid = (
      await one(
        `INSERT INTO tags(name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [tag],
      )
    ).id;
    await db.query(`INSERT INTO game_tags(game_id, tag_id) VALUES ($1,$2)`, [gid, tid]);
  }
}

// 8 titles per genre per portal. Puzzle i = (i+1)·U, Racing i = (i+1)·U + U/2, so within a portal
// the 16 counts interleave with no ties: Puzzle i ranks 2i, Racing i ranks 2i+1 (of 0..15).
async function seed(db: Querier) {
  for (const name of ["poki", "crazygames"]) {
    const s = await source(db, name);
    for (const [genre, off] of [
      ["Puzzle", 0],
      ["Racing", 0.5],
    ] as const)
      for (let i = 0; i < 8; i++)
        await title(
          db,
          s,
          {
            name: `${name}-${genre}-${i}`,
            votes: (i + 1 + off) * UNIT[name],
            rating: i === 0 ? GEM_RATING[name][genre] : 4.0,
            genre,
          },
          [GENRE_TAG[genre], "Casual"],
        );
  }
}

let db: Querier;
beforeAll(async () => {
  db = await freshMemoryDb();
  await seed(db);
}, 60000);

describe("P1 the percentile building block", () => {
  it("one portal (and Steam) keeps the raw count; `all` joins the within-portal percentile", () => {
    expect(voteLevel("poki")).toEqual({
      join: "",
      level: "l.votes",
      order: "l.votes DESC NULLS LAST",
    });
    expect(voteLevel("steam").level).toBe("l.votes");
    expect(voteLevel("all").level).toBe("vl.pct");
    expect(voteLevel("all").join).toContain("PARTITION BY src.name");
    expect([levelUnitOf("all"), levelUnitOf("poki"), levelUnitOf("crazygames")]).toEqual([
      "votePercentile",
      "votes",
      "votes",
    ]);
  });
  it("ranks within each portal: ties share the lowest rank, a null count has no level", async () => {
    const t = await freshMemoryDb();
    const cg = await source(t, "crazygames");
    for (const [name, votes] of [
      ["a", 10],
      ["b", 10],
      ["c", 20],
      ["d", null],
    ] as const)
      await title(t, cg, { name, votes });
    await title(t, await source(t, "poki"), { name: "solo", votes: 900000 });
    const lv = voteLevel("all");
    const rows = await t.query(
      `SELECT g.title, ${lv.level} AS lvl FROM v_latest l JOIN games g ON g.id = l.game_id ${lv.join} ORDER BY g.title`,
    );
    expect(rows.map((r) => [r.title, r.lvl == null ? null : Number(r.lvl)])).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 100],
      ["d", null],
      ["solo", 0], // a portal's only title is its own floor — 900k raw votes buy nothing across portals
    ]);
  });
});

describe("P2 Hidden Gems on `all` select and rank within each portal", () => {
  it("draws from both portals and interleaves their own rankings", async () => {
    // Pooled, every CrazyGames count sat below every Poki one, so only CrazyGames could be "low votes".
    const all = await getHiddenGems(db, "all");
    expect(all.map((g) => g.title)).toEqual([
      "crazygames-Racing-0", // Bayesian 4.69 > its Puzzle gem's 4.67 — CrazyGames' own order
      "poki-Puzzle-0",
      "crazygames-Puzzle-0",
      "poki-Racing-0",
    ]);
  });
  it("the `all` gem set is exactly the union of each portal's; one portal is unchanged", async () => {
    const poki = (await getHiddenGems(db, "poki")).map((g) => g.title);
    const cg = (await getHiddenGems(db, "crazygames")).map((g) => g.title);
    expect(poki).toEqual(["poki-Puzzle-0", "poki-Racing-0"]);
    expect(cg).toEqual(["crazygames-Racing-0", "crazygames-Puzzle-0"]);
    const all = (await getHiddenGems(db, "all")).map((g) => g.title);
    expect([...all].sort()).toEqual([...poki, ...cg].sort());
  });
  it("interleaveByPortal keeps each portal's order and lets a longer list fill", () => {
    const r = (source: string, id: number) => ({ source, id });
    const rows = [r("poki", 1), r("poki", 2), r("poki", 3), r("crazygames", 9)];
    expect(interleaveByPortal(rows, 3).map((x) => x.id)).toEqual([9, 1, 2]);
    expect(interleaveByPortal(rows, 10).map((x) => x.id)).toEqual([9, 1, 2, 3]);
  });
  it("the scatter's x on `all` is that same within-portal percentile; one portal has none", async () => {
    const pts = await getScatter(db, "all");
    const pk = pts.find((p) => p.title === "poki-Puzzle-3")!;
    const cg = pts.find((p) => p.title === "crazygames-Puzzle-3")!;
    expect([pk.votePct, cg.votePct]).toEqual([40, 40]); // rank 6 of 0..15, on both portals
    expect([pk.votes, cg.votes]).toEqual([16000, 160]);
    expect((await getScatter(db, "poki")).every((p) => p.votePct === null)).toBe(true);
  });
});

describe("P3 appetite on `all` is a within-portal percentile; one portal keeps raw votes", () => {
  it("market gaps", async () => {
    const byLabel = async (p: "all" | "poki" | "crazygames") =>
      new Map((await getMarketGaps(db, p)).map((g) => [g.label, g]));
    const poki = await byLabel("poki");
    expect(poki.get("Puzzle × Merge")).toMatchObject({ appetite: 18000, appetiteUnit: "votes" });
    expect(poki.get("Racing × Drift")).toMatchObject({ appetite: 20000, appetiteUnit: "votes" });
    expect((await byLabel("crazygames")).get("Puzzle × Merge")?.appetite).toBe(180);
    const all = await byLabel("all");
    // Median of {2i/15}·100 over both portals: (6/15 + 8/15)/2 → 46.7 → 47; Racing 8/15 → 53.
    expect(all.get("Puzzle × Merge")).toMatchObject({
      appetite: 47,
      appetiteUnit: "votePercentile",
      supplyN: 16,
    });
    expect(all.get("Racing × Drift")?.appetite).toBe(53);
    for (const g of all.values()) expect(g.appetite).toBeLessThanOrEqual(100);
  });
  it("quadrant appetite and weight", async () => {
    const q = async (p: "all" | "poki") =>
      new Map((await getGenreQuadrant(db, p)).map((x) => [x.genre, x]));
    const poki = await q("poki");
    expect(poki.get("Puzzle")).toMatchObject({ appetite: 18000, weight: 144000 });
    expect(poki.get("Racing")).toMatchObject({ appetite: 20000, weight: 160000 });
    const all = await q("all");
    // weight = Σ percentile ÷ 100: Puzzle 2·Σ2i/15 = 7.47 → 7.5; Racing 2·Σ(2i+1)/15 = 8.53 → 8.5.
    expect(all.get("Puzzle")).toMatchObject({ appetite: 47, weight: 7.5 });
    expect(all.get("Racing")).toMatchObject({ appetite: 53, weight: 8.5 });
  });
  it("loop-family appetite (supply-weighted)", async () => {
    const poki = await getLoopFamilyMarket(db, "poki");
    const all = await getLoopFamilyMarket(db, "all");
    expect([poki.appetiteUnit, all.appetiteUnit]).toEqual(["votes", "votePercentile"]);
    const fam = (m: typeof all) => m.rows.find((r) => r.genres.includes("Puzzle"))!;
    expect(fam(poki).appetite).toBe(19000); // (18000·8 + 20000·8) / 16
    expect(fam(all).appetite).toBe(50); // (46.7·16 + 53.3·16) / 32
  });
  it("genre table levels and the landscape weight", async () => {
    const all = (await getGenres(db, "all")).find((r) => r.genre === "Puzzle")!;
    expect(all).toMatchObject({
      medianVotes: null,
      p90Votes: null,
      medianVotePct: 47,
      p90VotePct: 87,
    });
    const poki = (await getGenres(db, "poki")).find((r) => r.genre === "Puzzle")!;
    expect(poki).toMatchObject({
      medianVotes: 18000,
      p90Votes: 29200,
      medianVotePct: null,
      p90VotePct: null,
    });
    const land = async (p: "all" | "poki") =>
      (await getGenreLandscape(db, p)).find((x) => x.genre === "Puzzle")!;
    expect(await land("all")).toMatchObject({ totalVotes: null, voteWeight: 7.5 });
    expect(await land("poki")).toMatchObject({ totalVotes: 144000, voteWeight: null });
  });
});

describe("P4 read, insights and examples speak the unit", () => {
  it("`all` quotes a median vote percentile, never median votes", async () => {
    const ov = await getOverview(db, "all");
    expect(ov.levelUnit).toBe("votePercentile");
    expect(ov.read[0]).toMatch(
      /is the top gap — P\d{1,3} median vote percentile \(within each portal\) across only 16 games\./,
    );
    const opp = ov.insights.find((i) => i.tag === "OPPORTUNITY")!;
    expect(opp.meta).toMatch(/^16 games · P\d{1,3} median vote percentile$/);
    expect([...ov.read, opp.meta].join(" ")).not.toMatch(/median votes/);
    expect(ov.insights.find((i) => i.tag === "HIDDEN GEMS")?.text).toContain(
      "within their own portal",
    );
  });
  it("one portal keeps its wording and numbers", async () => {
    const ov = await getOverview(db, "poki");
    expect(ov.levelUnit).toBe("votes");
    expect(ov.read[0]).toMatch(/is the top gap — \d{2},\d{3} median votes across only 8 games\./);
    expect(ov.insights.find((i) => i.tag === "OPPORTUNITY")?.meta).toMatch(
      /^8 games · \d+ median votes$/,
    );
    expect(ov.insights.find((i) => i.tag === "HIDDEN GEMS")?.text).not.toContain("portal");
  });
  it("examples on `all` come from both portals, not only the larger counts", async () => {
    const ov = await getOverview(db, "all");
    const ex = ov.gaps.find((g) => g.label === "Puzzle × Merge")?.examples ?? [];
    // Both portals' top Puzzle titles sit at P93; by raw count all three would be Poki's.
    expect(ex.some((t) => t.startsWith("crazygames-"))).toBe(true);
    expect(ex.some((t) => t.startsWith("poki-"))).toBe(true);
  });
});

describe("P5 New Releases on `all` alternate portals", () => {
  it("a portal listing faster no longer crowds the other out of the 60 rows", async () => {
    const t = await freshMemoryDb();
    const cg = await source(t, "crazygames");
    const pk = await source(t, "poki");
    for (let k = 0; k < 70; k++) await title(t, cg, { name: `cg-${k}`, votes: 10, seen: 60 + k });
    for (let k = 0; k < 10; k++)
      await title(t, pk, { name: `pk-${k}`, votes: 5000, seen: 60 * 24 * 5 + k });
    const all = await getNewReleases(t, "all");
    expect(all).toHaveLength(60);
    const count = (s: string) => all.filter((r) => r.source === s).length;
    expect([count("poki"), count("crazygames")]).toEqual([10, 50]);
    // Still newest first, and each portal's rows are its own newest.
    expect(all.slice(0, 50).map((r) => r.title)).toEqual(
      Array.from({ length: 50 }, (_, k) => `cg-${k}`),
    );
    const solo = await getNewReleases(t, "crazygames");
    expect(solo.map((r) => r.title)).toEqual(Array.from({ length: 60 }, (_, k) => `cg-${k}`));
  }, 60000);
});
