// Steam premium revenue model — the paid-launch counterpart to the browser ad dial.
// It's a *forward projection*: wishlists → units → gross → net, after the three things
// that actually shave a premium game's take — Steam's cut, refunds, and the game engine's
// licensing terms. No goal/break-even line here (that lives in the Notion Studio P&L); this
// just shows honestly what a given sales scenario nets you.
//
// Engine terms (the three we model, as of 2026 — all editable in the UI so drift is harmless):
//   • Godot  — MIT/free. No royalty, no seat fee. Nothing to subtract.
//   • Unreal — 5% royalty on GROSS revenue above US$1,000,000 lifetime per title.
//   • Unity  — no revenue cut at all; above US$200,000 revenue Unity Pro becomes mandatory
//              (~US$2,200/yr per seat). That's a fixed licence COST, not a split — so it's
//              subtracted as a lump, not a percentage.
// Thresholds are officially measured on GROSS revenue (total sales), so we test them against
// gross-net-of-refunds, not against your post-Steam receipts.

export type EngineId = "godot" | "unity" | "unreal";

export interface Engine {
  id: EngineId;
  label: string;
  /** Royalty as a fraction of gross revenue above `royaltyThresholdUsd` (Unreal only). */
  royaltyRate: number;
  royaltyThresholdUsd: number;
  /** Fixed licence cost (per seat-year) once gross revenue clears `seatThresholdUsd` (Unity only). */
  seatCostUsdPerYear: number;
  seatThresholdUsd: number;
  note: string;
}

export const ENGINES: Engine[] = [
  {
    id: "godot",
    label: "Godot",
    royaltyRate: 0,
    royaltyThresholdUsd: Infinity,
    seatCostUsdPerYear: 0,
    seatThresholdUsd: Infinity,
    note: "MIT / open-source — no royalty and no seat fee. You keep the full post-Steam take.",
  },
  {
    id: "unity",
    label: "Unity",
    royaltyRate: 0,
    royaltyThresholdUsd: Infinity,
    seatCostUsdPerYear: 2200,
    seatThresholdUsd: 200_000,
    note: "No revenue cut. Above US$200k revenue Unity Pro is required (~US$2,200/yr per seat) — a fixed licence cost, not a split.",
  },
  {
    id: "unreal",
    label: "Unreal",
    royaltyRate: 0.05,
    royaltyThresholdUsd: 1_000_000,
    seatCostUsdPerYear: 0,
    seatThresholdUsd: Infinity,
    note: "5% royalty on gross revenue above US$1,000,000 lifetime per title. Below that, nothing.",
  },
];

export function engine(id: EngineId): Engine {
  return ENGINES.find((e) => e.id === id) ?? ENGINES[0];
}

export interface SteamInputs {
  wishlists: number;
  conversion: number; // wishlist → sale ratio, e.g. 0.10
  priceUsd: number; // list price
  refundRate: number; // fraction of sales refunded, e.g. 0.07
  storeCut: number; // Steam's cut, e.g. 0.30
  engineId: EngineId;
  seats: number; // Unity Pro seats (for the licence cost)
  licenseYears: number; // years the Unity licence is held
  sgdPerUsd: number;
}

export interface SteamProjection {
  units: number; // wishlists × conversion
  grossList: number; // units × price (before refunds)
  grossRevenue: number; // after refunds — the figure engine thresholds are measured on
  storeFee: number; // Steam's cut
  engineRoyalty: number; // Unreal's 5%-above-$1M
  engineLicense: number; // Unity's Pro-seat cost
  engineCost: number; // royalty + licence
  netUsd: number; // what you actually keep
  netSgd: number;
  netPerUnitUsd: number;
  takeRate: number; // net ÷ gross revenue (0..1)
}

const nn = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);
const frac = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function steamProjection(i: SteamInputs): SteamProjection {
  const e = engine(i.engineId);
  const units = nn(i.wishlists) * frac(i.conversion);
  const grossList = units * nn(i.priceUsd);
  const grossRevenue = grossList * (1 - frac(i.refundRate));
  const storeFee = grossRevenue * frac(i.storeCut);
  const afterStore = grossRevenue - storeFee;

  const engineRoyalty = e.royaltyRate * Math.max(0, grossRevenue - e.royaltyThresholdUsd);
  const engineLicense =
    grossRevenue > e.seatThresholdUsd ? e.seatCostUsdPerYear * nn(i.seats) * nn(i.licenseYears) : 0;
  const engineCost = engineRoyalty + engineLicense;

  const netUsd = afterStore - engineCost;
  return {
    units,
    grossList,
    grossRevenue,
    storeFee,
    engineRoyalty,
    engineLicense,
    engineCost,
    netUsd,
    netSgd: netUsd * nn(i.sgdPerUsd),
    netPerUnitUsd: units > 0 ? netUsd / units : 0,
    takeRate: grossRevenue > 0 ? netUsd / grossRevenue : 0,
  };
}

// Sensible defaults, anchored to the Studio P&L (US$9.99 list, 0.10× conversion, Steam 30%).
// Refund rate ~7% is a common indie figure (Steam's ~2-hour/14-day policy). All editable.
export const STEAM_DEFAULTS: Omit<SteamInputs, "engineId"> = {
  wishlists: 30_000,
  conversion: 0.1,
  priceUsd: 9.99,
  refundRate: 0.07,
  storeCut: 0.3,
  seats: 1,
  licenseYears: 2,
  sgdPerUsd: 1.292,
};
