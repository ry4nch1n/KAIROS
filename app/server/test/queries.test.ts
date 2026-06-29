import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { seed } from "../src/db/seed.ts";
import * as q from "../src/queries/index.ts";

let db: Querier;

beforeAll(async () => {
  db = await freshMemoryDb();
  await seed(db);
}, 60000);

describe("A2 seed integrity", () => {
  it("has games, sources, tags", async () => {
    const games = await db.query("SELECT count(*)::int n FROM games");
    expect(games[0].n).toBeGreaterThan(50);
    const srcs = await db.query("SELECT name FROM sources ORDER BY name");
    expect(srcs.map((r) => r.name)).toEqual(["crazygames", "poki"]);
    const tags = await db.query("SELECT count(*)::int n FROM tags");
    expect(tags[0].n).toBeGreaterThan(0);
  });

  it("every game has at least one snapshot", async () => {
    const orphans = await db.query(
      "SELECT count(*)::int n FROM games g WHERE NOT EXISTS (SELECT 1 FROM game_snapshots s WHERE s.game_id = g.id)"
    );
    expect(orphans[0].n).toBe(0);
  });
});

describe("A3 overview", () => {
  it("returns KPI block per platform and platforms differ", async () => {
    const all = await q.getOverview(db, "all");
    expect(all.kpi.gamesTracked).toBeGreaterThan(0);
    expect(all.kpi.avgRating).toBeGreaterThan(0);
    expect(all.kpi.avgRating).toBeLessThanOrEqual(5);
    expect(typeof all.kpi.risingGenre).toBe("string");
    expect(all.kpi.avgRatingP90).toBeGreaterThanOrEqual(all.kpi.avgRating);
    expect(all.kpi.risingGenre.length).toBeGreaterThan(0);
    expect(typeof all.kpi.newGames).toBe("number");
    expect(all.kpi.newGames).toBeGreaterThanOrEqual(0);

    const poki = await q.getOverview(db, "poki");
    const cg = await q.getOverview(db, "crazygames");
    expect(all.kpi.gamesTracked).toBe(poki.kpi.gamesTracked + cg.kpi.gamesTracked);
    expect(poki.kpi.gamesTracked).toBeGreaterThan(0);
    expect(cg.kpi.gamesTracked).toBeGreaterThan(0);
  });
});

describe("A4 momentum (median votes over dates)", () => {
  it("series align to real dates; building flag reflects history depth", async () => {
    const m = await q.getGenreMomentum(db, "all");
    expect(Array.isArray(m.dates)).toBe(true);
    expect(typeof m.building).toBe("boolean");
    for (const s of m.series) expect(s.values.length).toBe(m.dates.length);
    expect(m.dates.every((d) => !/^W\d+$/.test(d))).toBe(true); // no fake "W15" labels
  });
});

describe("A5 tag frequency", () => {
  it("sorted desc with positive counts", async () => {
    const t = await q.getTagFrequency(db, "all");
    expect(t.length).toBeGreaterThan(0);
    for (let i = 1; i < t.length; i++) expect(t[i - 1].count).toBeGreaterThanOrEqual(t[i].count);
    expect(t[0].count).toBeGreaterThan(0);
  });
});

describe("A6 hidden gems (percentile)", () => {
  it("is a selective minority, not ~half the catalogue", async () => {
    const all = (await db.query("SELECT count(*)::int n FROM v_latest"))[0].n;
    const g = await q.getHiddenGems(db, "all");
    expect(g.length).toBeGreaterThan(0);
    expect(g.length).toBeLessThanOrEqual(Math.ceil(all * 0.15)); // < 15% of catalogue
  });
});

describe("A7 market gaps (interpretable)", () => {
  it("rows carry absolute numbers and rank by score", async () => {
    const gaps = await q.getMarketGaps(db, "all");
    expect(gaps.length).toBeGreaterThan(0);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i - 1].score).toBeGreaterThanOrEqual(gaps[i].score);
    for (const c of gaps) {
      expect(c.supplyN).toBeGreaterThanOrEqual(2);
      expect(c.appetite).toBeGreaterThanOrEqual(0);
      expect(c.qualityCeil).toBeGreaterThan(0);
      expect(c.qualityCeil).toBeLessThanOrEqual(5);
    }
  });
});

describe("A8 scatter", () => {
  it("carries title+genre and flags a small gem minority", async () => {
    const pts = await q.getScatter(db, "all");
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.every((p) => typeof p.title === "string" && typeof p.genre === "string")).toBe(true);
    const gems = pts.filter((p) => p.gem).length;
    expect(gems).toBeGreaterThan(0);
    expect(gems).toBeLessThan(pts.length * 0.25);
  });
});

describe("A8b feature heatmap", () => {
  it("returns genres x weeks cells", async () => {
    const h = await q.getFeatureHeatmap(db, "all");
    expect(h.weeks.length).toBeGreaterThan(0);
    expect(h.genres.length).toBeGreaterThan(0);
    expect(h.cells.length).toBe(h.weeks.length * h.genres.length);
  });
});

describe("A10 brief editions", () => {
  it("lists editions desc and fetches one with structured payload", async () => {
    const list = await q.getBriefEditions(db);
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < list.length; i++)
      expect(list[i - 1].editionDate >= list[i].editionDate).toBe(true);
    const ed = await q.getBriefEdition(db, list[0].editionDate);
    expect(ed).not.toBeNull();
    expect(Array.isArray(ed!.payload.top_signals)).toBe(true);
    expect(Array.isArray(ed!.payload.new_notable)).toBe(true);
  });
});

describe("A_explorer queries", () => {
  it("genres rollup has counts + ratings", async () => {
    const genres = await q.getGenres(db, "all");
    expect(genres.length).toBeGreaterThan(0);
    expect(genres[0].games).toBeGreaterThan(0);
    expect(genres[0].avgRating).toBeGreaterThan(0);
  });
  it("developers rollup (mode genre) runs", async () => {
    const devs = await q.getDevelopers(db, "all");
    expect(Array.isArray(devs)).toBe(true);
    if (devs.length) expect(devs[0].games).toBeGreaterThan(0);
  });
  it("new releases returns rows", async () => {
    const nr = await q.getNewReleases(db, "all");
    expect(Array.isArray(nr)).toBe(true);
  });
});

describe("A_insights", () => {
  it("generates natural-language insights from real stats", async () => {
    const ins = await q.getInsights(db, "all");
    expect(ins.length).toBeGreaterThan(0);
    for (const i of ins) {
      expect(i.text.length).toBeGreaterThan(0);
      expect(["up", "down", "gap", "gem"]).toContain(i.kind);
    }
  });
});

describe("A_landscape quality-saturation", () => {
  it("one point per genre with supply, p75 rating, total votes", async () => {
    const pts = await q.getGenreLandscape(db, "all");
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(p.supply).toBeGreaterThan(0);
      expect(p.p75Rating).toBeGreaterThan(0);
      expect(p.p75Rating).toBeLessThanOrEqual(5);
      expect(p.totalVotes).toBeGreaterThanOrEqual(0);
    }
  });
});
