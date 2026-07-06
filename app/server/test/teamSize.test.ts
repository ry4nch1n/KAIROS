import { describe, it, expect } from "vitest";
import { teamSizeFor, normalizeDev, isSoloReachable } from "../src/data/teamSize.ts";

describe("normalizeDev", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeDev("  Supergiant   Games ")).toBe("supergiant games");
    expect(normalizeDev(null)).toBe("");
    expect(normalizeDev(undefined)).toBe("");
  });
});

describe("teamSizeFor — curated estimates carry provenance", () => {
  it("returns a bucket + source for a researched studio", () => {
    const s = teamSizeFor("Supergiant Games");
    expect(s?.bucket).toBe("mid");
    expect(s?.source).toMatch(/^https?:\/\//);
    expect(s?.confidence).toBeDefined();
  });
  it("matches case- and whitespace-insensitively", () => {
    expect(teamSizeFor("supergiant games")?.bucket).toBe("mid");
    expect(teamSizeFor("  ConcernedApe ")?.bucket).toBe("solo");
  });
  it("returns null for an untagged studio (never guesses)", () => {
    expect(teamSizeFor("Some Unknown Studio")).toBeNull();
    expect(teamSizeFor(null)).toBeNull();
    expect(teamSizeFor("")).toBeNull();
  });
});

describe("isSoloReachable — the #9 cohort predicate", () => {
  it("solo and small are reachable; mid and large are not", () => {
    expect(isSoloReachable("solo")).toBe(true);
    expect(isSoloReachable("small")).toBe(true);
    expect(isSoloReachable("mid")).toBe(false);
    expect(isSoloReachable("large")).toBe(false);
  });
  it("puts the studios from #9 on the right side of the line", () => {
    // wanted IN: solo/near-solo breakouts
    for (const dev of ["ConcernedApe", "poncle", "TVGS", "Nokta Games", "Team Cherry"])
      expect(isSoloReachable(teamSizeFor(dev)!.bucket)).toBe(true);
    // wanted OUT: the "noise" the issue flagged
    for (const dev of ["Supergiant Games", "Sandfall Interactive", "11 bit studios"])
      expect(isSoloReachable(teamSizeFor(dev)!.bucket)).toBe(false);
  });
});
