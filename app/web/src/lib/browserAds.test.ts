import { describe, it, expect } from "vitest";
import { projectedDau, browserAdProjection, BROWSER_AD_DEFAULTS, HINTS } from "./browserAds.ts";

describe("browserAdProjection", () => {
  it("turns retention into DAU by geometric decay, and stays finite at a maxed slider", () => {
    expect(projectedDau(1000, 0)).toBe(1000); // one-and-done
    expect(projectedDau(1000, 0.5)).toBeCloseTo(2000, 6);
    expect(projectedDau(9000, 0.25)).toBeCloseTo(12_000, 6);
    expect(projectedDau(1000, 1)).toBeCloseTo(20_000, 1); // capped, never infinite
    expect(projectedDau(0, 0.5)).toBe(0);
  });

  it("chains sessions → impressions → gross → developer net", () => {
    const i = { ...BROWSER_AD_DEFAULTS, newPlayersPerDay: 1000, d1Retention: 0 };
    const p = browserAdProjection({ ...i, sessionsPerUser: 2, adsPerSession: 1, ecpmUsd: 10 });
    expect(p.sessionsPerDay).toBe(2000); // 2000 impressions → $20 gross → 50% share
    expect(p.netUsdPerDay).toBeCloseTo(10, 10);
    expect(p.netUsdPerYear).toBeCloseTo(3650, 6);
    expect(p.netRpmUsd).toBeCloseTo(5, 10);
  });

  it("degrades to zero rather than NaN on empty or invalid inputs", () => {
    const p = browserAdProjection({
      ...BROWSER_AD_DEFAULTS,
      newPlayersPerDay: -5,
      d1Retention: Number.NaN,
      revShare: 2, // clamped to 1
    });
    expect([p.dau, p.netUsdPerDay, p.netRpmUsd]).toEqual([0, 0, 0]);
    expect(Number.isFinite(p.netUsdPerYear)).toBe(true);
  });

  // The one realised public figure: a solo dev's FOURTH CrazyGames game, ≈€31/day (~$12.9k/yr)
  // six weeks in. Defaults must land on it — a model whose out-of-the-box projection sits far
  // above the only outcome on record is not defensible.
  it("reproduces the ≈€31/day published anchor at its default assumptions", () => {
    const p = browserAdProjection(BROWSER_AD_DEFAULTS);
    expect(p.dau).toBeCloseTo(12_000, 6);
    expect(p.netEurPerDay).toBeGreaterThan(28);
    expect(p.netEurPerDay).toBeLessThan(34);
    expect(p.netUsdPerYear).toBeGreaterThan(11_000);
    expect(p.netUsdPerYear).toBeLessThan(14_000);
    // the implied RPM stays inside the realised €1.23–$3.33 range of published reports
    expect(p.netRpmUsd).toBeGreaterThanOrEqual(1.2);
    expect(p.netRpmUsd).toBeLessThanOrEqual(3.4);
    // and no assumption ships without the published basis the UI shows beneath it
    for (const k of Object.keys(BROWSER_AD_DEFAULTS)) expect(HINTS[k], k).toBeTruthy();
  });
});
