import { beforeAll, describe, expect, it } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { seed, seedVoteSeries } from "../src/db/seed.ts";
import { assessVoteBasis } from "../src/checks/voteBasis.ts";
import { browserVoteSeries, browserVoteSteps } from "../src/checks/voteFreshness.ts";

// #244 — the local seed must follow each portal's declared VOTE_BASIS, or window-basis momentum
// (signed %/wk, falling chips, early reads) can never be seen or e2e-tested locally.

const rng = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

describe("seedVoteSeries (#244)", () => {
  it("a cumulative series only rises", () => {
    const s = seedVoteSeries("cumulative", 1000, 12, 0, 0, rng(7));
    expect(s).toHaveLength(12);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
  });

  it("a window series mixes small drops and gains", () => {
    const s = seedVoteSeries("window", 5000, 12, 2, 0, rng(11));
    expect(s).toHaveLength(10);
    const drops = s.slice(1).filter((v, i) => v < s[i]).length;
    const gains = s.slice(1).filter((v, i) => v > s[i]).length;
    expect(drops).toBeGreaterThan(0);
    expect(gains).toBeGreaterThan(0);
    for (let i = 1; i < s.length; i++) expect(Math.abs(s[i] / s[i - 1] - 1)).toBeLessThan(0.05);
  });

  it("is deterministic for a given RNG", () => {
    expect(seedVoteSeries("window", 800, 12, 0, 0.01, rng(3))).toEqual(
      seedVoteSeries("window", 800, 12, 0, 0.01, rng(3)),
    );
  });
});

describe("seeded snapshots agree with VOTE_BASIS (#244)", () => {
  let db: Querier;
  beforeAll(async () => {
    db = await freshMemoryDb();
    await seed(db);
  }, 60000);

  it("passes the vote-basis invariant with the step floor lowered", async () => {
    const r = assessVoteBasis(await browserVoteSteps(db), undefined, 100);
    expect(r.failures).toEqual([]);
    expect(r.lines.some((l) => l.includes("under the"))).toBe(false);
    expect(r.lines.map((l) => l.split(":")[0])).toEqual([
      "crazygames (window)",
      "poki (cumulative)",
    ]);
  });

  it("gives CrazyGames titles that fall, rise, and read early", async () => {
    const cg = (await browserVoteSeries(db)).filter((s) => s.source === "crazygames");
    expect(cg.some((s) => s.netChange < 0)).toBe(true);
    expect(cg.some((s) => s.netChange > 0)).toBe(true);
    expect(cg.some((s) => s.captures < 3)).toBe(true);
    const poki = (await browserVoteSeries(db)).filter((s) => s.source === "poki");
    expect(poki.every((s) => s.netChange >= 0)).toBe(true);
  });
});
