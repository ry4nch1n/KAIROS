import { describe, it, expect } from "vitest";
import type { LibraryItem, PrototypeVerdict } from "shared";
import { verdictChips, verdictProvenance, verdictsBySlug } from "./Library.tsx";

// The pitch card renders the verdict recorded on the prototype card that tests it (#55).
const v = (over: Partial<PrototypeVerdict>): PrototypeVerdict => ({
  goalGrasped: null,
  secondRun: null,
  moment: null,
  recordedAt: "2026-08-01T00:00:00.000Z",
  source: null,
  ...over,
});
const card = (id: number, pitchSlug: string | null, verdict: PrototypeVerdict | null) =>
  ({ id, kind: "prototype", title: "toy", pitchSlug, verdict }) as LibraryItem;

describe("verdict → pitch join", () => {
  it("keys verdicts by the pitch they evidence, ignoring unlinked and untested cards", () => {
    const map = verdictsBySlug([
      card(1, "vigil", v({ goalGrasped: true })),
      card(2, "hearthspeak", null), // linked but never play-tested
      card(3, null, v({ goalGrasped: false })), // no pitch to evidence
    ]);
    expect(Object.keys(map)).toEqual(["vigil"]);
    expect(map.vigil.goalGrasped).toBe(true);
  });

  it("keeps the most recent verdict when a concept was play-tested twice", () => {
    const map = verdictsBySlug([
      card(1, "vigil", v({ recordedAt: "2026-07-01T00:00:00.000Z", moment: "old" })),
      card(2, "vigil", v({ recordedAt: "2026-08-02T00:00:00.000Z", moment: "new" })),
    ]);
    expect(map.vigil.moment).toBe("new");
  });
});

describe("verdictChips", () => {
  it("renders no chips for an untested prototype (absence is not a failed gate)", () => {
    expect(verdictChips(null)).toEqual([]);
  });

  it("keeps a measured no apart from a question nobody asked", () => {
    // goal cleared · second run measurably did not happen · no moment was named
    const chips = verdictChips(v({ goalGrasped: true, secondRun: false }));
    expect(chips.map((c) => c.state)).toEqual(["pass", "fail", "fail"]);
    expect(chips[1].label).toBe("no second run");
    // A null answer is neither: it must never render with the failure treatment.
    const unasked = verdictChips(v({}));
    expect(unasked[0]).toEqual({ label: "30s goal: not asked", state: "unasked" });
    expect(unasked.map((c) => c.state)).not.toContain("pass");
  });

  it("passes the third tooth when the play-test named a moment", () => {
    const chips = verdictChips(v({ moment: "the last-second wall" }));
    expect(chips[2]).toEqual({ label: "named a compelling moment", state: "pass" });
    expect(verdictChips(v({}))[2].label).toMatch(/no compelling moment/);
  });
});

// #199: provenance is rendered, not hidden in a tooltip — and a verdict reconstructed weeks
// later must not read as one written at the table. Every verdict on file today is retrospective.
describe("verdictProvenance", () => {
  it("surfaces the recorded date and the source verbatim", () => {
    const p = verdictProvenance(
      v({ recordedAt: "2026-07-17T00:00:00.000Z", source: "human play-test · 3 first-timers" }),
    );
    expect(p).toEqual({
      recordedOn: "2026-07-17",
      source: "human play-test · 3 first-timers",
      retrospective: false,
    });
  });

  it("flags a retrospective verdict, and claims nothing when no source was recorded", () => {
    expect(
      verdictProvenance(v({ source: "recorded retrospectively 2026-09-08" })).retrospective,
    ).toBe(true);
    expect(verdictProvenance(v({ source: null })).retrospective).toBe(false);
  });
});
