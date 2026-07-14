import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { seedRealShape } from "./fixtures.ts";
import * as q from "../src/queries/index.ts";

let db: Querier;
beforeAll(async () => {
  db = await freshMemoryDb();
  await seedRealShape(db);
}, 60000);

describe("real-shape fixture mirrors production", () => {
  it("featured is false everywhere", async () => {
    const r = await db.query(
      "SELECT count(*) FILTER (WHERE featured)::int AS f, count(*)::int AS n FROM game_snapshots",
    );
    expect(r[0].f).toBe(0);
    expect(r[0].n).toBeGreaterThan(0);
  });
  it("has at least 3 distinct capture days", async () => {
    const r = await db.query("SELECT count(DISTINCT captured_at)::int AS d FROM game_snapshots");
    expect(r[0].d).toBe(3);
  });
  it("votes rise across days for a sample game", async () => {
    const r = await db.query(
      "SELECT votes FROM game_snapshots WHERE game_id=1 ORDER BY captured_at",
    );
    expect(r[r.length - 1].votes).toBeGreaterThan(r[0].votes);
  });
});

describe("real-shape: gems are relative & named", () => {
  it("gem set is a small minority and points carry titles", async () => {
    const pts = await q.getScatter(db, "all");
    expect(pts.every((p) => p.title.length > 0)).toBe(true);
    expect(pts.filter((p) => p.gem).length).toBeLessThan(pts.length * 0.25);
  });
});

describe("real-shape: honest labels & no silent zeros", () => {
  it("momentum uses real dates, never W## tokens", async () => {
    const m = await q.getGenreMomentum(db, "all");
    expect(m.dates.every((d) => !/^W\d+$/.test(d))).toBe(true);
  });
  it("overview KPIs are populated from real data (no featured dependency)", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.kpi.risingGenre.length).toBeGreaterThan(0);
    expect(ov.landscape.length).toBeGreaterThan(0);
    expect(ov.heatmap.cells.some((c) => c.value > 0)).toBe(true);
  });
});
