import { describe, it, expect } from "vitest";
import { steamProjection, scenarioBand, engine, ENGINES, type SteamInputs } from "./steamRevenue.ts";

const base: SteamInputs = {
  wishlists: 10_000,
  conversion: 0.1,
  priceUsd: 9.99,
  refundRate: 0.07,
  storeCut: 0.3,
  engineId: "godot",
  seats: 1,
  licenseYears: 2,
  sgdPerUsd: 1.292,
};

describe("steamProjection — gross → net funnel", () => {
  it("runs wishlists → units → gross → net after refunds and Steam's cut", () => {
    const p = steamProjection(base);
    expect(p.units).toBeCloseTo(1000, 6);
    expect(p.grossList).toBeCloseTo(9990, 4);
    expect(p.grossRevenue).toBeCloseTo(9290.7, 4); // after 7% refunds
    expect(p.storeFee).toBeCloseTo(2787.21, 4); // 30% of gross
    expect(p.netUsd).toBeCloseTo(6503.49, 4);
    expect(p.netSgd).toBeCloseTo(6503.49 * 1.292, 3);
    expect(p.netPerUnitUsd).toBeCloseTo(6.50349, 5);
  });

  it("take-rate on Godot is exactly (1 − storeCut) — Steam is the only skim", () => {
    expect(steamProjection(base).takeRate).toBeCloseTo(0.7, 6);
    expect(steamProjection(base).engineCost).toBe(0);
  });

  it("refunds shrink gross revenue", () => {
    const noRefund = steamProjection({ ...base, refundRate: 0 });
    expect(noRefund.grossRevenue).toBeCloseTo(9990, 4);
    expect(noRefund.netUsd).toBeGreaterThan(steamProjection(base).netUsd);
  });

  it("treats non-finite / negative inputs as zero", () => {
    expect(steamProjection({ ...base, wishlists: NaN }).units).toBe(0);
    expect(steamProjection({ ...base, wishlists: 0 }).netUsd).toBe(0);
    expect(steamProjection({ ...base, conversion: -1 }).units).toBe(0);
  });
});

describe("engine terms — the real differences", () => {
  // 300k units at $9.99, no refunds → ~$3M gross, comfortably over Unreal's $1M line.
  const big: SteamInputs = { ...base, wishlists: 3_000_000, conversion: 0.1, refundRate: 0 };

  it("Godot never charges a royalty or licence, at any scale", () => {
    const p = steamProjection({ ...big, engineId: "godot" });
    expect(p.engineRoyalty).toBe(0);
    expect(p.engineLicense).toBe(0);
  });

  it("Unreal takes 5% of gross ABOVE $1M only", () => {
    const p = steamProjection({ ...big, engineId: "unreal" });
    // gross = 300,000 × 9.99 = 2,997,000 → 5% × (2,997,000 − 1,000,000)
    expect(p.grossRevenue).toBeCloseTo(2_997_000, 2);
    expect(p.engineRoyalty).toBeCloseTo(0.05 * (2_997_000 - 1_000_000), 2);
    expect(p.engineLicense).toBe(0);
  });

  it("Unreal charges nothing below the $1M threshold", () => {
    const small = steamProjection({ ...base, engineId: "unreal", refundRate: 0 }); // ~$10k gross
    expect(small.engineRoyalty).toBe(0);
  });

  it("Unity charges a fixed Pro-seat cost above $200k gross, not a revenue split", () => {
    const p = steamProjection({ ...big, engineId: "unity", seats: 1, licenseYears: 2 });
    expect(p.engineRoyalty).toBe(0); // never a percentage
    expect(p.engineLicense).toBe(2200 * 1 * 2); // seats × years × annual
  });

  it("Unity charges nothing below the $200k threshold", () => {
    const p = steamProjection({ ...base, engineId: "unity", refundRate: 0 }); // ~$10k gross
    expect(p.engineLicense).toBe(0);
  });

  it("Unity licence scales with seats and years", () => {
    const p = steamProjection({ ...big, engineId: "unity", seats: 2, licenseYears: 3 });
    expect(p.engineLicense).toBe(2200 * 2 * 3);
  });
});

describe("engine registry", () => {
  it("exposes exactly the three engines", () => {
    expect(ENGINES.map((e) => e.id)).toEqual(["godot", "unity", "unreal"]);
  });
  it("engine() falls back to Godot on an unknown id", () => {
    // @ts-expect-error — deliberately bad id
    expect(engine("cryengine").id).toBe("godot");
  });
});

describe("scenarioBand — the conversion spread is the message (evaluation Phase A2)", () => {
  it("brackets the base conversion with a pessimistic half and an optimistic double", () => {
    const b = scenarioBand(base);
    expect(b.base.units).toBeCloseTo(1000, 6);
    expect(b.pessimistic.units).toBeCloseTo(500, 6);
    expect(b.optimistic.units).toBeCloseTo(2000, 6);
    expect(b.pessimistic.netUsd).toBeLessThan(b.base.netUsd);
    expect(b.optimistic.netUsd).toBeGreaterThan(b.base.netUsd);
  });

  it("optimistic scenario clamps conversion at 1.0 — can't outsell the wishlist count", () => {
    const b = scenarioBand({ ...base, conversion: 0.8 });
    expect(b.optimistic.units).toBeCloseTo(10_000, 6); // 1.6× clamped to 1.0
  });

  it("keeps engine terms per scenario — a big optimistic gross can cross a threshold the base doesn't", () => {
    const b = scenarioBand({ ...base, wishlists: 1_500_000, refundRate: 0, engineId: "unreal" });
    expect(b.base.engineRoyalty).toBeGreaterThan(0); // ~$1.5M gross
    expect(b.pessimistic.engineRoyalty).toBe(0); // ~$750K gross, under the $1M line
  });
});
