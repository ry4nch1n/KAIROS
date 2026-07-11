import { describe, it, expect } from "vitest";
import { steamProjection, engine, ENGINES, type SteamInputs } from "./steamRevenue.ts";

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
