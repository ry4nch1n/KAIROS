// Steering as a scoring term (#12b). The load-bearing property is the NEGATIVE one: with no
// standing flags set the ranking is identical to the market-data one — scores, order, keys.
import { describe, expect, it } from "vitest";
import type { SteamGap } from "shared";
import { matchSteering, steerRow, steeringLens, STEERING_WEIGHT } from "../src/queries/shared.ts";

const gap = (genre: string, tag: string, score: number): SteamGap => ({
  label: `${genre} × ${tag}`,
  genre,
  tag,
  supplyN: 4,
  medianOwners: 20000,
  qualityCeil: 4.2,
  medianPriceCents: 999,
  score,
  components: { demand: score, quality: 0, supply: 0 },
  examples: [],
  supplyRising: false,
});

// The production chain: steer every row, then sort — exactly what getSteamOpportunity does.
const rank = (flags: string[]) =>
  [gap("Puzzle", "Cozy", 1.5), gap("Action", "Survivor-Like", 1.2)]
    .map((g) => steerRow(g, flags))
    .sort((a, b) => b.score - a.score);

describe("matchSteering", () => {
  it("matches on the market's own labels, whole-word", () => {
    expect(matchSteering(["cozy games"], { genre: "Puzzle", tag: "Cozy" })).toEqual(["cozy games"]);
    // "cozy" must not be found inside an unrelated longer word.
    expect(matchSteering(["cozy"], { genre: "Action", tag: "Cozywumpus" })).toEqual([]);
    // …and "survivors" reaches the same loop family without naming the tag.
    expect(matchSteering(["survivors"], { genre: "Action", tag: "Survivor-Like" })).toEqual([
      "survivors",
    ]);
  });

  it("makes no claim on a flag that fits nothing", () => {
    const m = { genre: "Puzzle", tag: "Cozy" };
    expect(matchSteering(["submarine documentaries"], m)).toEqual([]);
    expect(matchSteering(["", "   "], m)).toEqual([]);
  });
});

describe("steerRow", () => {
  it("no flags set → the ranking is untouched (scores, components, order, keys)", () => {
    const unsteered = rank([]);
    for (const flags of [[], ["", "  "]]) {
      const after = rank(flags);
      expect(after).toEqual(unsteered);
      expect(after.some((r) => r.steering)).toBe(false);
      expect(after.some((r) => r.components.steering !== undefined)).toBe(false);
    }
    expect(unsteered.map((r) => r.label)).toEqual(["Puzzle × Cozy", "Action × Survivor-Like"]);
  });

  it("lifts and re-sorts a matched market, and records which flag did it", () => {
    const out = rank(["survivors"]);
    expect(out[0].label).toBe("Action × Survivor-Like"); // 1.2 + lift overtook the 1.5 leader
    expect(out[0].score).toBeCloseTo(1.2 + STEERING_WEIGHT, 5);
    expect(out[0].steering).toEqual({ flags: ["survivors"], delta: STEERING_WEIGHT });
    expect(out[0].components.steering).toBe(STEERING_WEIGHT);
    // The unmatched market keeps its exact market-data score — steering never demotes.
    expect(out[1].score).toBe(1.5);
    expect(out[1].steering).toBeUndefined();
  });

  it("stacks per matching flag, and a flag matching nothing changes nothing", () => {
    const g = steerRow(gap("Puzzle", "Cozy", 0), ["cozy", "puzzle"]);
    expect(g.steering?.flags).toEqual(["cozy", "puzzle"]);
    expect(g.score).toBeCloseTo(2 * STEERING_WEIGHT, 5);
    expect(rank(["submarine documentaries"])).toEqual(rank([]));
  });
});

describe("steeringLens", () => {
  it("is undefined when nothing is steering", () => {
    expect(steeringLens([], rank([]))).toBeUndefined();
  });

  it("reports applied vs matched-nothing honestly", () => {
    const flags = ["survivors", "submarine documentaries"];
    expect(steeringLens(flags, rank(flags))).toEqual({
      flags,
      applied: ["survivors"],
      unmatched: ["submarine documentaries"],
      steered: 1,
      weight: STEERING_WEIGHT,
    });
  });
});
