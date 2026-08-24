// The user-facing half of #12(b): a steered ranking must SAY it was steered, and an unsteered
// one must say nothing at all. steeringNote is that sentence.
import { describe, expect, it } from "vitest";
import type { SteeringLens } from "shared";
import { steeringNote } from "./Radar.tsx";

// A matched-but-unlisted market (#167) — only its label and rank reach the sentence.
const unl = (label: string, rank: number) => ({
  label,
  genre: label.split(" × ")[0],
  tag: label.split(" × ")[1],
  rank,
  delta: 0.5,
  flags: ["cozy"],
});

const lens = (o: Partial<SteeringLens>): SteeringLens => ({
  flags: ["cozy"],
  applied: ["cozy"],
  unmatched: [],
  steered: 2,
  weight: 0.5,
  ...o,
});

describe("steeringNote", () => {
  it("says nothing when nothing is steering", () => {
    expect(steeringNote(undefined)).toBeNull();
    expect(steeringNote(lens({ flags: [], applied: [], steered: 0 }))).toBeNull();
  });

  it("names the flags that landed, the rows moved, the weight — and singularizes", () => {
    const s = steeringNote(lens({ flags: ["cozy", "survivors"], applied: ["cozy", "survivors"] }))!;
    expect(s).toContain("cozy, survivors");
    expect(s).toContain("2 markets lifted");
    expect(s).toContain("+0.50");
    expect(steeringNote(lens({ steered: 1 }))).toContain("1 market lifted");
  });

  it("calls out flags that matched nothing rather than hiding them", () => {
    const s = steeringNote(lens({ flags: ["cozy", "submarines"], unmatched: ["submarines"] }))!;
    expect(s).toContain("No ranked market matched submarines");
  });

  it("is explicit when flags are set but the order is unsteered", () => {
    const s = steeringNote(lens({ applied: [], unmatched: ["cozy"], steered: 0 }))!;
    expect(s).toContain("none matched");
    expect(s).toContain("unsteered");
  });

  // #167 — the sentence has to hold apart two readings the old copy collapsed into one:
  // "nothing you care about is in this market" (a verdict) vs "it IS here, it just didn't outrank
  // the list" (an artefact of the cut). Opposite calls on which prototype to escalate.
  it("distinguishes matched-nothing from matched-but-below-the-cut", () => {
    const nothing = steeringNote(lens({ applied: [], unmatched: ["cozy"], steered: 0 }))!;
    expect(nothing).toContain("none matched any ranked market");
    expect(nothing).not.toContain("rank ");

    const below = steeringNote(
      lens({ steered: 2, steeredShown: 0, unlisted: [unl("Puzzle × Deckbuilding", 14)] }),
    )!;
    expect(below).toContain("cozy matched 2 markets");
    expect(below).toContain("none climbed into the list below");
    expect(below).toContain("Puzzle × Deckbuilding (rank 14)");
    expect(below).not.toContain("none matched");
  });

  it("names the near misses even when steering did reach the list", () => {
    const s = steeringNote(
      lens({ steered: 3, steeredShown: 2, unlisted: [unl("Action × Roguelike", 11)] }),
    )!;
    expect(s).toContain("3 markets lifted");
    expect(s).toContain("Also matched below the list: Action × Roguelike (rank 11)");
  });
});
