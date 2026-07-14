import { describe, it, expect } from "vitest";
import {
  payoutMultiplier,
  dailyRevenue,
  monthlyRevenue,
  targetBandUsd,
  verdict,
  monthsOfTarget,
  loadTargetSgd,
  saveTargetSgd,
  DAYS_PER_MONTH,
  type TargetBand,
} from "./revenue.ts";

describe("payoutMultiplier — Poki rev-share", () => {
  it("keeps 100% on all-direct traffic, 50% on all-sourced, blends in between", () => {
    expect(payoutMultiplier(1)).toBe(1);
    expect(payoutMultiplier(0)).toBe(0.5);
    expect(payoutMultiplier(0.5)).toBe(0.75);
  });
  it("clamps out-of-range shares", () => {
    expect(payoutMultiplier(2)).toBe(1);
    expect(payoutMultiplier(-1)).toBe(0.5);
  });
});

describe("revenue — anchored to the brief's hand calc", () => {
  // Brief: "$0.15 ARPDAU × ~900 DAU", all direct traffic.
  const brief = { dau: 900, arpdau: 0.15, directShare: 1 };
  it("daily matches ARPDAU × DAU when all traffic is direct", () => {
    expect(dailyRevenue(brief)).toBeCloseTo(135, 5);
  });
  it("monthly = daily × avg days/month", () => {
    expect(monthlyRevenue(brief)).toBeCloseTo(135 * DAYS_PER_MONTH, 5);
    expect(monthlyRevenue(brief)).toBeGreaterThan(4000);
  });
  it("halves platform-sourced revenue", () => {
    expect(dailyRevenue({ ...brief, directShare: 0 })).toBeCloseTo(67.5, 5);
  });
  it("treats non-finite / negative inputs as zero", () => {
    expect(dailyRevenue({ dau: NaN, arpdau: 0.15, directShare: 1 })).toBe(0);
    expect(dailyRevenue({ dau: 900, arpdau: -1, directShare: 1 })).toBe(0);
  });
});

describe("target band + verdict — user-set, nothing ships in the bundle", () => {
  // Sample band for tests only — the real target is personal, set on the widget.
  const t: TargetBand = { low: 3000, high: 4500 };

  it("converts the SGD band to USD at the given rate", () => {
    const b = targetBandUsd(1.35, t);
    expect(b.low).toBeCloseTo(3000 / 1.35, 5);
    expect(b.high).toBeCloseTo(4500 / 1.35, 5);
  });
  it("classifies below / in-band / above against the user's band", () => {
    expect(verdict(1000, 1.35, t)).toBe("below");
    expect(verdict(2500, 1.35, t)).toBe("in-band"); // ~SGD 3.4k
    expect(verdict(9000, 1.35, t)).toBe("above");
  });
  it("without a target the verdict is honestly no-target, never a default judgment", () => {
    expect(verdict(9000, 1.35, null)).toBe("no-target");
  });
});

describe("monthsOfTarget — a Steam lump sum expressed against the monthly floor", () => {
  const t: TargetBand = { low: 3000, high: 4500 };
  it("divides net SGD by the target floor", () => {
    expect(monthsOfTarget(30_000, t)).toBeCloseTo(10, 5);
    expect(monthsOfTarget(-5, t)).toBe(0);
  });
  it("null without a target", () => {
    expect(monthsOfTarget(30_000, null)).toBeNull();
  });
});

describe("target persistence — per-browser localStorage, cleared with null", () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  it("round-trips a band and clears it", () => {
    saveTargetSgd({ low: 3000, high: 4500 });
    expect(loadTargetSgd()).toEqual({ low: 3000, high: 4500 });
    saveTargetSgd(null);
    expect(loadTargetSgd()).toBeNull();
  });
  it("rejects malformed or non-positive stored values", () => {
    store.set("kairos.targetSgd", '{"low":-2}');
    expect(loadTargetSgd()).toBeNull();
    store.set("kairos.targetSgd", "not json");
    expect(loadTargetSgd()).toBeNull();
  });
  it("normalizes high < low up to the floor", () => {
    store.set("kairos.targetSgd", JSON.stringify({ low: 4000, high: 100 }));
    expect(loadTargetSgd()).toEqual({ low: 4000, high: 4000 });
  });
});
