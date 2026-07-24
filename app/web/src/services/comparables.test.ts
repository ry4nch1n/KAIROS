import { describe, expect, it } from "vitest";
import type { ComparableTeamSize, SteamComparable } from "shared";
import { hasTeamCoverage, TEAM_COVERAGE_MIN } from "./Radar.tsx";

const size: ComparableTeamSize = {
  bucket: "small",
  headcount: "3-10",
  source: "https://example.com",
  confidence: "medium",
};

// Only `teamSize` matters to hasTeamCoverage; the rest are nulled.
function comp(hasSize: boolean): SteamComparable {
  return {
    title: "x",
    tier: "indie",
    genre: "Action",
    rating: null,
    votes: null,
    owners: null,
    priceCents: null,
    developer: null,
    releaseDate: null,
    teamSize: hasSize ? size : null,
    reviewVelocity: null,
  };
}

const rows = (resolved: number, total: number): SteamComparable[] => [
  ...Array.from({ length: resolved }, () => comp(true)),
  ...Array.from({ length: total - resolved }, () => comp(false)),
];

describe("hasTeamCoverage", () => {
  it("hides the column on an empty set", () => {
    expect(hasTeamCoverage([])).toBe(false);
  });

  it("hides the column when coverage is negligible (1 of 14, the live case)", () => {
    expect(hasTeamCoverage(rows(1, 14))).toBe(false);
  });

  it("shows the column at exactly the threshold", () => {
    // TEAM_COVERAGE_MIN of 10 rows = the flip point.
    const atThreshold = Math.ceil(TEAM_COVERAGE_MIN * 10);
    expect(hasTeamCoverage(rows(atThreshold, 10))).toBe(true);
    expect(hasTeamCoverage(rows(atThreshold - 1, 10))).toBe(false);
  });

  it("shows the column when every visible row resolves (the Solo-reachable cohort)", () => {
    expect(hasTeamCoverage(rows(6, 6))).toBe(true);
  });
});
