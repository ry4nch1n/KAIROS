// The user-facing half of #12(b): a steered ranking must SAY it was steered, and an unsteered
// one must say nothing at all. steeringNote is that sentence.
import { describe, expect, it } from "vitest";
import type { SteeringLens } from "shared";
import { steeringNote } from "./Radar.tsx";

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

  it("calls out flags that matched nothing here rather than hiding them", () => {
    const s = steeringNote(lens({ flags: ["cozy", "submarines"], unmatched: ["submarines"] }))!;
    expect(s).toContain("No match here for submarines");
  });

  it("is explicit when flags are set but the order is unsteered", () => {
    const s = steeringNote(lens({ applied: [], unmatched: ["cozy"], steered: 0 }))!;
    expect(s).toContain("none matched");
    expect(s).toContain("unsteered");
  });
});
