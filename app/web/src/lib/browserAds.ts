// Browser ad-revenue projection — the Route 2/3 counterpart to the Steam premium model. Splits
// portal income into the levers a browser SKU is planned on: audience (new players → retention
// → DAU), engagement (sessions/day, ads/session) and portal terms (gross eCPM × rev-share).
// These are ASSUMPTIONS, never measurements — the UI must label them so. Every default is a
// sourced claim, set at the CONSERVATIVE end of a thin public record:
//  [1] https://sdk.poki.com/deals.html — Poki Web Exclusive: dev keeps 100% of ad revenue on
//      traffic they bring, 50% on Poki-sourced players. (Official.)
//  [2] https://files.crazygames.com/documents/developer_terms_20240802.pdf — CrazyGames
//      publishes NO fixed %; §5.5 grants a 50% uplift during 2-month launch exclusivity.
//  [3] https://docs.crazygames.com/payouts/ — payouts in EUR, €100 floor. Hence €/day here.
//  [4] https://www.html5gamedevs.com/topic/40362-monetising-html5-games/ — firsthand report of
//      40% standard / 60% exclusive (consistent with [2]'s 1.5× uplift on a 40% base).
//  [5] https://donislawdev.com/earnings-and-statistics-from-my-8-games-android-ios-webgl/ —
//      €556.92 over 451,327 CrazyGames plays ⇒ ≈€1.23 developer RPM per 1,000 plays.
//  [6] https://www.applixir.com/blog/whats-the-highest-paying-ad-format-for-html5-games-right-now/
//      GROSS eCPM/1,000 impressions: tier-1 $12–30, W-EU $6–15, E-EU/LatAm/Asia $2–6. A portal's
//      worldwide mix is dominated by the cheap tiers, so a blend sits near that floor.
//  [7] ANCHOR https://www.reddit.com/r/gamedev/comments/1uol4p2/ — solo dev, six weeks on
//      CrazyGames, ≈€31/day (~$12.9k/yr). His FOURTH game after three failures: a realistic
//      OUTCOME anchor, not a first-game expectation. Defaults land on it — it is the only
//      concrete realised figure on record.

export interface BrowserAdInputs {
  newPlayersPerDay: number;
  d1Retention: number; // 0..1, share still playing the next day
  sessionsPerUser: number; // sessions per active user per day
  adsPerSession: number; // monetised impressions per session
  ecpmUsd: number; // GROSS revenue per 1,000 impressions, before the portal's cut
  revShare: number; // 0..1, developer's share of that gross
  eurPerUsd: number;
}

const nn = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);
const frac = (x: number) => (Number.isFinite(x) && x > 0 ? Math.min(x, 1) : 0);

/** Published spread behind each default, shown in the UI so no field reads as a measurement. */
export const HINTS: Record<string, string> = {
  newPlayersPerDay: "your audience lever — set it from a portal's own traffic estimate",
  d1Retention: "0.15–0.40 · portal casual traffic is largely one-and-done",
  sessionsPerUser: "1.0–2.5 · session count rises with loop depth",
  adsPerSession: "1–3 · interstitial on death/level, plus optional rewarded",
  ecpmUsd: "gross eCPM $2–6 tier-3 markets → $12–30 tier-1 [6]",
  revShare: "40% standard / 60% with launch exclusivity [4] — no official rate published [2]",
  eurPerUsd: "portals pay in EUR [3]; eCPM benchmarks are quoted in USD",
};

// revShare 0.50 = midpoint of [4]'s 40/60; Poki's 100%-own-traffic term [1] is the better case,
// so 0.50 under-promises rather than over. ecpmUsd 2.50 sits near the floor of [6]'s cheap-tier
// band because portal audiences are worldwide. Cross-check: 2.50 × 1.6 × 0.50 = $2.00 developer
// RPM/1,000 sessions, bracketing the realised ≈€1.23 [5]; audience defaults → ≈12,000 DAU and
// ≈€31/day, anchor [7].
export const BROWSER_AD_DEFAULTS: BrowserAdInputs = {
  newPlayersPerDay: 9000,
  d1Retention: 0.25,
  sessionsPerUser: 1.4,
  adsPerSession: 1.6,
  ecpmUsd: 2.5,
  revShare: 0.5,
  eurPerUsd: 0.92,
};

export interface BrowserAdProjection {
  dau: number;
  sessionsPerDay: number;
  netUsdPerDay: number;
  netEurPerDay: number; // the unit portals actually report [3]
  netUsdPerYear: number;
  netRpmUsd: number; // developer revenue per 1,000 sessions — directly comparable to [5]
}

/** Steady-state DAU: each day's cohort keeps contributing for 1/(1−r) days under geometric
 *  decay at the D1 rate (r=0 → 1 day, 0.25 → 1.33, 0.5 → 2). Capped at r=0.95 so a maxed
 *  slider can't project an infinite audience. */
export function projectedDau(newPlayersPerDay: number, d1Retention: number): number {
  return nn(newPlayersPerDay) / (1 - Math.min(frac(d1Retention), 0.95));
}

export function browserAdProjection(i: BrowserAdInputs): BrowserAdProjection {
  const dau = projectedDau(i.newPlayersPerDay, i.d1Retention);
  const sessionsPerDay = dau * nn(i.sessionsPerUser);
  const impressionsPerDay = sessionsPerDay * nn(i.adsPerSession);
  const netUsdPerDay = (impressionsPerDay / 1000) * nn(i.ecpmUsd) * frac(i.revShare);
  return {
    dau,
    sessionsPerDay,
    netUsdPerDay,
    netEurPerDay: netUsdPerDay * nn(i.eurPerUsd),
    netUsdPerYear: netUsdPerDay * 365,
    netRpmUsd: sessionsPerDay > 0 ? (netUsdPerDay / sessionsPerDay) * 1000 : 0,
  };
}
