import { describe, expect, it } from "vitest";
import {
  assessVoteBasis,
  CUMULATIVE_MAX_DOWN_SHARE,
  MIN_BASIS_STEPS,
  WINDOW_MIN_DOWN_SHARE,
} from "../src/checks/voteBasis.ts";
import type { VoteStepProfile } from "../src/checks/voteFreshness.ts";

// #204 S5 — the gate asserts each browser portal still behaves like its declared vote basis.

const step = (
  source: string,
  up: number,
  down: number,
  flat = 0,
  size = "<1k",
): VoteStepProfile => ({
  source,
  size,
  up,
  down,
  flat,
  medianDownPct: null,
  medianUpPct: null,
  medianGapDays: null,
});

/** The production step profile from check-data run 34811253184. */
const PRODUCTION: VoteStepProfile[] = [
  step("crazygames", 2909, 2795, 649, "<1k"),
  step("crazygames", 3194, 3798, 110, "1k-10k"),
  step("crazygames", 747, 1208, 4, ">=10k"),
  step("poki", 310, 0, 116, "<1k"),
  step("poki", 5325, 0, 82, "1k-10k"),
  step("poki", 12318, 0, 32, ">=10k"),
];

describe("assessVoteBasis (#204 S5)", () => {
  it("passes the measured production profile under the real VOTE_BASIS", () => {
    const r = assessVoteBasis(PRODUCTION);
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual([
      "crazygames (window): down 7801 of 14651 moving steps (53.2%, expected ≥ 20.0%)",
      "poki (cumulative): down 0 of 17953 moving steps (0.0%, expected ≤ 2.0%)",
    ]);
  });

  it("fails a cumulative portal whose count starts falling, and says what it means", () => {
    const down = Math.ceil(MIN_BASIS_STEPS * (CUMULATIVE_MAX_DOWN_SHARE + 0.01));
    const r = assessVoteBasis([step("poki", MIN_BASIS_STEPS - down, down)]);
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("poki's vote count has started falling");
    expect(r.failures[0]).toContain("may no longer be a running total");
    expect(r.failures[0]).toContain("VOTE_BASIS");
  });

  it("tolerates a cumulative portal's rare purge at the bound", () => {
    const down = MIN_BASIS_STEPS * CUMULATIVE_MAX_DOWN_SHARE;
    expect(assessVoteBasis([step("poki", MIN_BASIS_STEPS - down, down)]).ok).toBe(true);
  });

  it("fails a window portal whose count stops falling", () => {
    const down = Math.floor(MIN_BASIS_STEPS * (WINDOW_MIN_DOWN_SHARE - 0.05));
    const r = assessVoteBasis([step("crazygames", MIN_BASIS_STEPS - down, down)]);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("crazygames's vote count has almost stopped falling");
    expect(r.failures[0]).toContain("running total rather than a recent window");
  });

  it("passes a window portal at the bound", () => {
    const down = MIN_BASIS_STEPS * WINDOW_MIN_DOWN_SHARE;
    expect(assessVoteBasis([step("crazygames", MIN_BASIS_STEPS - down, down)]).ok).toBe(true);
  });

  it("never asserts a thin cohort on either basis, but still reports it", () => {
    const n = MIN_BASIS_STEPS - 1;
    const r = assessVoteBasis([step("crazygames", n, 0), step("poki", 0, n)]);
    expect(r.ok).toBe(true);
    expect(r.lines.every((l) => l.includes("not asserted"))).toBe(true);
  });

  it("pools size buckets per portal and ignores flat steps", () => {
    // Each bucket alone is thin; together they clear the floor. A mass of flat steps (a frozen
    // capture, or a faster cadence) must not dilute the share into a false window failure.
    const half = MIN_BASIS_STEPS / 2;
    const r = assessVoteBasis([
      step("crazygames", half / 2, half / 2, 50_000, "<1k"),
      step("crazygames", half / 2, half / 2, 50_000, ">=10k"),
    ]);
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toContain(`of ${MIN_BASIS_STEPS} moving steps (50.0%`);
  });

  it("an undeclared portal is held to cumulative, so a new window portal fails until declared", () => {
    const r = assessVoteBasis([step("newportal", MIN_BASIS_STEPS / 2, MIN_BASIS_STEPS / 2)]);
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toContain("newportal (cumulative)");
  });

  it("an empty profile passes with nothing to report", () => {
    expect(assessVoteBasis([])).toEqual({ ok: true, failures: [], lines: [] });
  });
});
