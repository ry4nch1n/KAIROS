import { describe, it, expect } from "vitest";
import {
  assessSteamDataQuality,
  DEFAULT_STEAM_QUALITY,
  assessFollowerCapture,
  MIN_FOLLOWER_COHORT,
} from "../src/checks/steamDataQuality.ts";

// A healthy latest-crawl cohort: enough games, dates parsed, a real indie cohort, and the
// all-live comparables set populated.
const healthy = { crawled: 200, withDate: 190, rated: 180, indie: 130, comparables: 12 };

describe("DQ assessSteamDataQuality — recency/accuracy invariants", () => {
  it("passes a healthy sample", () => {
    const r = assessSteamDataQuality(healthy);
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.metrics.dateFillPct).toBeCloseTo(0.95, 2);
  });

  it("flags a broken date parser (fresh cohort all release_date null)", () => {
    const r = assessSteamDataQuality({ ...healthy, withDate: 0 });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/release_date fill too low/);
  });

  it("flags an all-AAA fresh cohort (indie seed empty / over-classification)", () => {
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
    const r = assessSteamDataQuality({
      crawled: 5,
      withDate: 5,
      rated: 5,
      indie: 5,
      comparables: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/latest crawl too small/);
  });

  it("thresholds are conservative (won't fire on normal variance)", () => {
    // borderline-but-acceptable: 60% dated, 40% rated, 20 indie, 3 comparables
    const r = assessSteamDataQuality({
      crawled: 120,
      withDate: 72,
      rated: 48,
      indie: 20,
      comparables: 3,
    });
    expect(r.ok).toBe(true);
    expect(DEFAULT_STEAM_QUALITY.minComparables).toBe(3);
  });
});

// #54: a wholesale-failing follower fetch used to pass green — fetchFollowers swallows every
// error, so 451 consecutive HTTP 429s across four crawls looked identical to "no data".
describe("DQ assessFollowerCapture — the 0%-capture gate (#54)", () => {
  it("fails loudly on 0% capture over a real eligible cohort", () => {
    const msg = assessFollowerCapture(28, 0);
    expect(msg).toMatch(/follower capture 0% over 28 eligible/);
    expect(msg).toMatch(/#54/);
  });

  it("passes when even one eligible title carried a value (the velocity clock started)", () => {
    expect(assessFollowerCapture(28, 1)).toBeNull();
  });

  it("stays silent on a small / CRAWL_LIMIT-capped cohort — no false alarm", () => {
    expect(assessFollowerCapture(MIN_FOLLOWER_COHORT - 1, 0)).toBeNull();
    expect(assessFollowerCapture(0, 0)).toBeNull(); // a run with no coming-soon titles at all
  });

  it("fires exactly at the cohort floor", () => {
    expect(assessFollowerCapture(MIN_FOLLOWER_COHORT, 0)).not.toBeNull();
  });
});
