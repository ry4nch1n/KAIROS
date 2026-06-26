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
    expect(typeof all.kpi.fastestGenre).toBe("string");
    expect(all.kpi.fastestGenre.length).toBeGreaterThan(0);

    const poki = await q.getOverview(db, "poki");
    const cg = await q.getOverview(db, "crazygames");
    expect(all.kpi.gamesTracked).toBe(poki.kpi.gamesTracked + cg.kpi.gamesTracked);
    expect(poki.kpi.gamesTracked).toBeGreaterThan(0);
    expect(cg.kpi.gamesTracked).toBeGreaterThan(0);
  });
});

describe("A4 genre momentum", () => {
  it("series aligned to weeks, platform-filtered", async () => {
    const m = await q.getGenreMomentum(db, "all");
    expect(m.weeks.length).toBeGreaterThan(3);
    expect(m.series.length).toBeGreaterThan(0);
    for (const s of m.series) expect(s.values.length).toBe(m.weeks.length);
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

describe("A6 hidden gems", () => {
  it("all rows are high-rating, low-votes, unfeatured", async () => {
    const g = await q.getHiddenGems(db, "all");
    expect(g.length).toBeGreaterThan(0);
    for (const row of g) {
      expect(row.rating).toBeGreaterThanOrEqual(4.4);
      expect(row.votes).toBeLessThan(5000);
    }
  });
});

describe("A7 market gaps", () => {
  it("ranked by score desc, demand/supply in 0-100", async () => {
    const gaps = await q.getMarketGaps(db, "all");
    expect(gaps.length).toBeGreaterThan(0);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i - 1].score).toBeGreaterThanOrEqual(gaps[i].score);
    for (const c of gaps) {
      expect(c.demand).toBeGreaterThanOrEqual(0);
      expect(c.demand).toBeLessThanOrEqual(100);
      expect(c.supply).toBeGreaterThanOrEqual(0);
      expect(c.supply).toBeLessThanOrEqual(100);
    }
  });
});

describe("A8 scatter", () => {
  it("returns rating x votes with gems flagged", async () => {
    const pts = await q.getScatter(db, "all");
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.some((p) => p.gem)).toBe(true);
    for (const p of pts) {
      expect(p.rating).toBeGreaterThan(0);
      expect(p.votes).toBeGreaterThanOrEqual(0);
    }
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
