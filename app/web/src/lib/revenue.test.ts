import { describe, it, expect } from "vitest";
import {
  payoutMultiplier,
  dailyRevenue,
  monthlyRevenue,
  targetBandUsd,
  verdict,
  DAYS_PER_MONTH,
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
  it("monthly ≈ $4.1k, in the ballpark of the SGD 4–5k goal", () => {
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

describe("target band + verdict", () => {
  it("converts the SGD band to USD at the given rate", () => {
    const b = targetBandUsd(1.35);
    expect(b.low).toBeCloseTo(4000 / 1.35, 5);
    expect(b.high).toBeCloseTo(5000 / 1.35, 5);
  });
  it("classifies below / in-band / above", () => {
    expect(verdict(1000, 1.35)).toBe("below");
    expect(verdict(3200, 1.35)).toBe("in-band"); // ~SGD 4.3k
    expect(verdict(9000, 1.35)).toBe("above");
  });
});
