// #192 — the displayed rate and the trajectory chip sit in the same row, so they must never
// contradict. The bug they shipped from: `votesPerDay` was rounded to an integer, Hidden Gems
// is the low-vote cohort BY CONSTRUCTION, and 28 of 30 live rows rendered "0" — four of them
// beside "▲ rising". A blank axis that looks measured is worse than no axis at all.
import { describe, expect, it } from "vitest";
import { portalTag, trendChip, voteRateText, voteRateTip } from "./Radar.tsx";

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

describe("a window-basis row reads as signed engagement change (#204)", () => {
  it("signs the change with a true minus, one decimal, per week", () => {
    expect(voteRateText(null, "decaying", -7.9)).toBe("−7.9%/wk");
    expect(voteRateText(null, "rising", 32.6)).toBe("+32.6%/wk");
    expect(voteRateText(null, "plateau", 0)).toBe("0.0%/wk");
  });
  it("no series or no measurable level is 'no data', never a fake zero", () => {
    expect(voteRateText(null, "new", null)).toBe("no data");
    expect(voteRateText(null, "plateau", null)).toBe("no data");
  });
  it("the cell tooltip names the unit and why it differs from votes/day", () => {
    expect(voteRateTip(null, "decaying", -19.3)).toMatch(/engagement down 19\.3% a week/);
    expect(voteRateTip(null, "rising", 4.2)).toMatch(/engagement up 4\.2% a week/);
    expect(voteRateTip(null, "plateau", -1)).toMatch(/recent window, not all time/);
    expect(voteRateTip(null, "new", null)).toMatch(/not the same as zero/);
  });
});

describe("a trend chip only appears once the series has earned one", () => {
  it("fewer than three captures is an early read, on either basis", () => {
    expect(trendChip("plateau", 2)).toBe("early");
    expect(trendChip("plateau", 3)).toBe("plateau");
    expect(trendChip("decaying", 5)).toBe("decaying");
    expect(trendChip("rising", 4)).toBe("rising");
  });
  it("no series stays 'new' — early read is for a measured figure without a verdict", () => {
    expect(trendChip("new", 0)).toBe("new");
    expect(trendChip("new", 1)).toBe("new");
  });
});

describe("portal marker", () => {
  it("maps known portals to a compact tag with the full name, and degrades for unknown ones", () => {
    expect(portalTag("crazygames")).toEqual(["CG", "CrazyGames"]);
    expect(portalTag("poki")).toEqual(["PK", "Poki"]);
    expect(portalTag("itch")).toEqual(["IT", "itch"]);
  });
});
