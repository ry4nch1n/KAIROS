import { describe, it, expect } from "vitest";
import { assessSteamDataQuality, DEFAULT_STEAM_QUALITY } from "../src/checks/steamDataQuality.ts";

// A healthy crawl: plenty of games, dates parsed, a real indie cohort, populated comparables.
const healthy = { total: 200, withDate: 190, rated: 180, indie: 130, comparables: 12 };

describe("DQ assessSteamDataQuality — recency/accuracy invariants", () => {
  it("passes a healthy sample", () => {
    const r = assessSteamDataQuality(healthy);
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.metrics.dateFillPct).toBeCloseTo(0.95, 2);
  });

  it("flags a broken date parser (all release_date null)", () => {
    const r = assessSteamDataQuality({ ...healthy, withDate: 0 });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/release_date fill too low/);
  });

  it("flags an all-AAA sample (indie seed empty / over-classification)", () => {
    const r = assessSteamDataQuality({ ...healthy, indie: 2 });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/indie cohort too small/);
  });

  it("flags collapsed comparables (recency window regression)", () => {
    const r = assessSteamDataQuality({ ...healthy, comparables: 1 });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/comparables too sparse/);
  });

  it("flags a near-empty crawl", () => {
    const r = assessSteamDataQuality({ total: 5, withDate: 5, rated: 5, indie: 5, comparables: 0 });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/too few Steam games/);
  });

  it("thresholds are conservative (won't fire on normal variance)", () => {
    // borderline-but-acceptable: 60% dated, 40% rated, 20 indie, 3 comparables
    const r = assessSteamDataQuality({ total: 120, withDate: 72, rated: 48, indie: 20, comparables: 3 });
    expect(r.ok).toBe(true);
    expect(DEFAULT_STEAM_QUALITY.minComparables).toBe(3);
  });
});
