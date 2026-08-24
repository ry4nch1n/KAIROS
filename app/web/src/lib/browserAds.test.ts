import { describe, it, expect } from "vitest";
import {
  projectedDau,
  browserAdProjection,
  adCeilingPerSession,
  BROWSER_AD_DEFAULTS,
  MIDGAME_CAP_MINUTES,
  HINTS,
} from "./browserAds.ts";

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

  // The defaults are the file's calibration against the one realised figure on record, so the
  // cap must NOT bite there — otherwise adding it would have silently re-anchored the model.
  it("leaves the default assumptions unclamped, so the published anchor still holds", () => {
    const p = browserAdProjection(BROWSER_AD_DEFAULTS);
    expect(p.midgamePerPlay).toBe(3); // 9 minutes / one ad per 3
    expect(p.adCeiling).toBeCloseTo(1.8, 10); // × 0.60 conversion
    expect(p.capBinds).toBe(false);
    expect(p.effectiveAdsPerSession).toBeCloseTo(BROWSER_AD_DEFAULTS.adsPerSession, 10);
  });
});

// The portal's SDK paces midgame video at one per three minutes, so impressions per session are
// bounded by how long a session lasts rather than chosen. The dial stays editable — other portals
// publish other terms — but it is clamped to the ceiling, and the clamp is reported.
describe("the 3-minute midgame pacing cap", () => {
  const base = {
    ...BROWSER_AD_DEFAULTS,
    newPlayersPerDay: 1000,
    d1Retention: 0,
    sessionsPerUser: 1,
  };

  it("counts whole midgame ads only, at one per three minutes", () => {
    expect(MIDGAME_CAP_MINUTES).toBe(3);
    const at = (sessionMinutes: number) =>
      adCeilingPerSession({ sessionMinutes, oneMinuteConversion: 1, rewardedPerSession: 0 })
        .midgamePerPlay;
    expect([at(0), at(2.9), at(3), at(4), at(5.9), at(9)]).toEqual([0, 0, 1, 1, 1, 3]);
  });

  it("clamps a short session to what it can actually serve, and says the clamp bound", () => {
    // a ~4-minute loop toy: one midgame ad, not the 1.6 the dial asks for
    const p = browserAdProjection({ ...base, sessionMinutes: 4, oneMinuteConversion: 1 });
    expect(p.midgamePerPlay).toBe(1);
    expect(p.adCeiling).toBeCloseTo(1, 10);
    expect(p.capBinds).toBe(true);
    expect(p.effectiveAdsPerSession).toBeCloseTo(1, 10);
    // and the revenue moves by exactly that ratio, nothing else
    const uncapped = browserAdProjection({ ...base, sessionMinutes: 99, oneMinuteConversion: 1 });
    expect(p.netUsdPerDay).toBeCloseTo(uncapped.netUsdPerDay / 1.6, 10);
  });

  it("leaves a dial that sits under the ceiling exactly where the user set it", () => {
    const p = browserAdProjection({
      ...base,
      sessionMinutes: 30,
      oneMinuteConversion: 1,
      adsPerSession: 2,
    });
    expect(p.adCeiling).toBeCloseTo(10, 10);
    expect(p.capBinds).toBe(false);
    expect(p.effectiveAdsPerSession).toBe(2);
    expect(p.netUsdPerDay).toBeCloseTo((1000 * 2 * 2.5 * 0.5) / 1000, 10);
  });

  it("serves no midgame ad under three minutes — only player-initiated rewarded video", () => {
    const short = { ...base, sessionMinutes: 2, oneMinuteConversion: 1 };
    const p = browserAdProjection(short);
    expect([p.midgamePerPlay, p.adCeiling, p.netUsdPerDay]).toEqual([0, 0, 0]);
    // rewarded sits outside the pacing rule, so it still counts on a sub-3-minute session
    const withRewarded = browserAdProjection({ ...short, rewardedPerSession: 0.5 });
    expect(withRewarded.midgamePerPlay).toBe(0);
    expect(withRewarded.adCeiling).toBeCloseTo(0.5, 10);
    expect(withRewarded.effectiveAdsPerSession).toBeCloseTo(0.5, 10);
    expect(withRewarded.netUsdPerDay).toBeGreaterThan(0);
  });

  it("gates impressions on the players who reach one minute of play", () => {
    // conversion is the portal's own definition of a converted play, and a player who never
    // reaches the first minute never reaches the first ad either
    const p = browserAdProjection({ ...base, sessionMinutes: 6, oneMinuteConversion: 0.5 });
    expect(p.midgamePerPlay).toBe(2);
    expect(p.adCeiling).toBeCloseTo(1, 10); // 2 × 0.50
    const full = browserAdProjection({ ...base, sessionMinutes: 6, oneMinuteConversion: 1 });
    expect(full.adCeiling).toBeCloseTo(2, 10);
    expect(p.netUsdPerDay).toBeCloseTo(full.netUsdPerDay / 1.6, 10); // 1.0 vs the 1.6 dial
  });
});
