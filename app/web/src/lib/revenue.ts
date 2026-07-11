// Browser-game revenue model — turns the SGD income goal into a dial each concept
// can be tested against. Ad-funded browser platforms (Poki / CrazyGames) pay on a
// rev-share: you keep ~100% of ad revenue on traffic you bring yourself (direct),
// but players the platform sends you are a 50-50 split. The Jun 26 brief hand-computed
// "$0.15 ARPDAU × ~900 DAU"; this makes that math live and adjustable.

export interface RevenueInputs {
  dau: number; // daily active users
  arpdau: number; // avg revenue per daily active user, USD
  directShare: number; // 0..1 fraction of DAU from your own (direct) traffic
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const nonNeg = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

/** Poki reality: direct traffic keeps 100% of ad revenue, platform-sourced is 50-50. */
export const POKI_DIRECT_KEEP = 1.0;
export const POKI_SOURCED_KEEP = 0.5;

/** Blended payout multiplier across the direct / platform-sourced traffic mix. */
export function payoutMultiplier(directShare: number): number {
  const d = clamp01(directShare);
  return d * POKI_DIRECT_KEEP + (1 - d) * POKI_SOURCED_KEEP;
}

export function dailyRevenue(i: RevenueInputs): number {
  return nonNeg(i.dau) * nonNeg(i.arpdau) * payoutMultiplier(i.directShare);
}

/** Average days per month, so a monthly figure isn't 30 or 31 dependent. */
export const DAYS_PER_MONTH = 30.4;
export function monthlyRevenue(i: RevenueInputs): number {
  return dailyRevenue(i) * DAYS_PER_MONTH;
}

export interface GenrePreset {
  id: string;
  label: string;
  arpdau: number; // typical ad ARPDAU (USD) for the genre — an editable starting point
}

// Ad ARPDAU rises with session count / session length. Idle & automation loops keep
// players returning; hypercasual monetises thinnest. Starting points, not gospel.
export const GENRE_PRESETS: GenrePreset[] = [
  { id: "idle", label: "Idle / Tycoon", arpdau: 0.18 },
  { id: "automation", label: "Automation / Logistics", arpdau: 0.15 },
  { id: "cozy", label: "Cozy / Management", arpdau: 0.12 },
  { id: "puzzle", label: "Puzzle / Arcade", arpdau: 0.1 },
  { id: "hyper", label: "Hypercasual", arpdau: 0.06 },
];

// ── Monthly target (user-set, private) ──
// The income goal is personal — the real P&L targets live in Notion, and KAIROS may be
// shown to people outside the team — so NO target ships in the bundle. The band is set
// on the widget and persisted per-browser in localStorage; until then it's null and the
// verdict honestly reads "no target set". The model works in USD (the currency of
// ARPDAU market data), so the SGD band converts at the editable FX rate.
export interface TargetBand {
  low: number; // SGD/month — the floor the verdict is judged against
  high: number; // SGD/month — top of the band
}

export const DEFAULT_SGD_PER_USD = 1.35;

const TARGET_KEY = "kairos.targetSgd";

/** Read the locally-stored target band; null when unset, malformed, or storage-less. */
export function loadTargetSgd(): TargetBand | null {
  try {
    const raw = globalThis.localStorage?.getItem(TARGET_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (typeof t?.low !== "number" || !(t.low > 0)) return null;
    const high = typeof t.high === "number" && t.high >= t.low ? t.high : t.low;
    return { low: t.low, high };
  } catch {
    return null;
  }
}

/** Persist (or clear, with null) the target band in this browser only. */
export function saveTargetSgd(t: TargetBand | null): void {
  try {
    if (!t) globalThis.localStorage?.removeItem(TARGET_KEY);
    else globalThis.localStorage?.setItem(TARGET_KEY, JSON.stringify(t));
  } catch {
    // storage unavailable — the target just won't survive a reload
  }
}

export function targetBandUsd(sgdPerUsd: number, target: TargetBand): { low: number; high: number } {
  const rate = sgdPerUsd > 0 ? sgdPerUsd : DEFAULT_SGD_PER_USD;
  return { low: target.low / rate, high: target.high / rate };
}

export type TargetVerdict = "no-target" | "below" | "in-band" | "above";

/** Where a projected monthly USD figure lands versus the user's SGD target band. */
export function verdict(monthlyUsd: number, sgdPerUsd: number, target: TargetBand | null): TargetVerdict {
  if (!target) return "no-target";
  const band = targetBandUsd(sgdPerUsd, target);
  if (monthlyUsd < band.low) return "below";
  if (monthlyUsd > band.high) return "above";
  return "in-band";
}

/** How many months of the target floor a lump sum (e.g. a Steam net projection) covers. */
export function monthsOfTarget(netSgd: number, target: TargetBand | null): number | null {
  if (!target || !(target.low > 0)) return null;
  return Math.max(0, netSgd) / target.low;
}
