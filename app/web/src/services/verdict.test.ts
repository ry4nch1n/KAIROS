import { describe, it, expect } from "vitest";
import type { LibraryItem, PrototypeVerdict } from "shared";
import { verdictChips, verdictsBySlug } from "./Library.tsx";

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

  it("distinguishes passed, failed, and unasked kill-gate questions", () => {
    const chips = verdictChips(v({ goalGrasped: true, secondRun: false }));
    expect(chips.map((c) => c.ok)).toEqual([true, false, false]);
    expect(chips[2].label).toMatch(/no compelling moment/);
    expect(verdictChips(v({}))[0].label).toMatch(/not asked/);
  });

  it("names the compelling moment when the play-test found one", () => {
    expect(verdictChips(v({ moment: "the last-second wall" }))[2]).toEqual({
      label: "moment: the last-second wall",
      ok: true,
    });
  });
});
