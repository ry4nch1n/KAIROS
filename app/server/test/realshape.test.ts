import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { seedRealShape } from "./fixtures.ts";

let db: Querier;
beforeAll(async () => { db = await freshMemoryDb(); await seedRealShape(db); }, 60000);

describe("real-shape fixture mirrors production", () => {
  it("featured is false everywhere", async () => {
    const r = await db.query("SELECT count(*) FILTER (WHERE featured)::int AS f, count(*)::int AS n FROM game_snapshots");
    expect(r[0].f).toBe(0);
    expect(r[0].n).toBeGreaterThan(0);
  });
  it("has at least 3 distinct capture days", async () => {
    const r = await db.query("SELECT count(DISTINCT captured_at)::int AS d FROM game_snapshots");
    expect(r[0].d).toBe(3);
  });
  it("votes rise across days for a sample game", async () => {
    const r = await db.query("SELECT votes FROM game_snapshots WHERE game_id=1 ORDER BY captured_at");
    expect(r[r.length - 1].votes).toBeGreaterThan(r[0].votes);
  });
});
