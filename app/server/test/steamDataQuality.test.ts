import { describe, it, expect } from "vitest";
import {
  assessSteamDataQuality,
  DEFAULT_STEAM_QUALITY,
  assessCaptureYield,
  MIN_CAPTURE_COHORT,
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

// #54 / #158: a wholesale-failing enrichment fetch used to pass green — fetchFollowers swallows
// every error, so 451 consecutive HTTP 429s across four crawls looked identical to "no data".
// The assertion is now table-driven so the NEXT optional fetch inherits it instead of re-deriving it.
describe("DQ assessCaptureYield — the 0%-capture gate (#54, generalised #158)", () => {
  const row = (over: Partial<Parameters<typeof assessCaptureYield>[0][number]>) => ({
    key: "followers",
    eligible: 28,
    captured: 0,
    why: "follower velocity cannot start (#54).",
    ...over,
  });

  it("fails loudly on 0% capture over a real eligible cohort", () => {
    const r = assessCaptureYield([row({})]);
    expect(r.ok).toBe(false);
    expect(r.failures.join(" ")).toMatch(/followers capture 0% over 28 eligible/);
    expect(r.failures.join(" ")).toMatch(/#54/);
  });

  it("passes when even one eligible title carried a value (the velocity clock started)", () => {
    const r = assessCaptureYield([row({ captured: 1 })]);
    expect(r.ok).toBe(true);
    expect(r.lines.join(" ")).toMatch(/followers 1\/28 eligible \(4%\)/);
  });

  it("stays silent on a small / CRAWL_LIMIT-capped cohort — no false alarm", () => {
    expect(assessCaptureYield([row({ eligible: MIN_CAPTURE_COHORT - 1 })]).ok).toBe(true);
    // a run with no coming-soon titles at all
    const empty = assessCaptureYield([row({ eligible: 0 })]);
    expect(empty.ok).toBe(true);
    expect(empty.lines.join(" ")).toMatch(/not asserted/);
  });

  it("fires exactly at the cohort floor, and honours a per-enrichment floor", () => {
    expect(assessCaptureYield([row({ eligible: MIN_CAPTURE_COHORT })]).ok).toBe(false);
    // a raised floor makes the same cohort un-assertable rather than red
    expect(assessCaptureYield([row({ eligible: MIN_CAPTURE_COHORT, minCohort: 50 })]).ok).toBe(
      true,
    );
  });

  it("evaluates every enrichment in one pass — a quiet one never hides the others", () => {
    const r = assessCaptureYield([
      row({ key: "followers", captured: 12 }),
      row({ key: "ai_disclosure", eligible: 40, captured: 0, why: "readings collapse (#110)." }),
      row({ key: "release_state", eligible: 200, captured: 200, minCohort: 50, why: "x." }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/ai_disclosure/);
    // reported whether or not they passed — the visibility half of #158
    expect(r.lines).toHaveLength(3);
    expect(r.lines.join(" ")).toMatch(/release_state 200\/200 eligible \(100%\)/);
  });

  it("reports nothing and passes on an empty table", () => {
    expect(assessCaptureYield([])).toEqual({ ok: true, failures: [], lines: [] });
  });
});
