// #192 — the displayed rate and the trajectory chip sit in the same row, so they must never
// contradict. The bug they shipped from: `votesPerDay` was rounded to an integer, Hidden Gems
// is the low-vote cohort BY CONSTRUCTION, and 28 of 30 live rows rendered "0" — four of them
// beside "▲ rising". A blank axis that looks measured is worse than no axis at all.
import { describe, expect, it } from "vitest";
import { voteRateText, voteRateTip } from "./Radar.tsx";

describe("voteRateText keeps a fractional rate legible", () => {
  it("renders a fraction of a vote per day instead of rounding it away", () => {
    expect(voteRateText(0.4, "rising")).toBe("+0.40");
    expect(voteRateText(0.01, "rising")).toBe("+0.01");
    expect(voteRateText(2.5, "plateau")).toBe("+2.50");
  });
  it("drops to whole numbers on the high-traffic rows New Releases carries", () => {
    expect(voteRateText(1234.56, "rising")).toBe("+1,235");
    expect(voteRateText(42.37, "rising")).toBe("+42.4");
  });
  it("separates 'measured, and flat' from 'nothing measured yet'", () => {
    expect(voteRateText(0, "plateau")).toBe("0");
    expect(voteRateText(0, "new")).toBe("no data");
    expect(voteRateTip(0, "new")).toMatch(/not the same as zero/);
  });
  it("cannot print a zero or an empty reading beside a rising chip", () => {
    for (const v of [0.01, 0.07, 0.4, 3, 91.2, 5000])
      expect(["0", "no data", "—"]).not.toContain(voteRateText(v, "rising"));
  });
  it("translates the daily fraction into the weekly rate a reader can feel", () => {
    expect(voteRateTip(0.4, "rising")).toContain("2.8 votes/week");
    expect(voteRateTip(0, "decaying")).toMatch(/no votes gained/);
  });
});
