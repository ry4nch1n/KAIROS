// Browser ad-revenue projection — the Route 2/3 counterpart to the Steam premium model. Splits
// portal income into the levers a browser SKU is planned on: audience (new players → retention
// → DAU), engagement (sessions/day, session length, ads/session) and portal terms (gross eCPM ×
// rev-share). These are ASSUMPTIONS, never measurements — the UI must label them so. Every
// default is a sourced claim, set at the CONSERVATIVE end of a thin public record:
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
//  [8] https://docs.crazygames.com/requirements/ads/ — the SDK paces midgame video itself at
//      "max 1 every 3 minutes", and midgame + rewarded are the only two video formats a
//      developer triggers (there is no prestitial: an ad "should not appear before the user has
//      experienced a reasonable amount of gameplay"). Impressions per session are therefore
//      BOUNDED BY SESSION LENGTH, not chosen — a 4-minute loop carries one midgame ad whatever
//      the dial says. Rewarded is player-initiated and sits outside that pacing rule.
//  [9] https://docs.crazygames.com/resources/ad-monetization-guide/ — "The SDK handles ad pacing
//      automatically (max 1 every 3 minutes)", and conversion "relates directly to the
//      percentage of players that contribute to your impressions-per-play" — which is exactly
//      where conversion enters the ceiling below.
// [10] https://docs.crazygames.com/resources/basic-launch-metrics/ — the portal's own KPI bar:
//      conversion is "the percentage of players who play for at least one minute after starting
//      the game" and top performers clear 80%; "10+ minutes" of average play time marks a
//      success; strong games see 10–15% D1. (Note the tension with d1Retention below: 0.25 sits
//      above the portal's own strong band and predates [10]. Left alone here — recalibrating the
//      audience defaults would move the [7] anchor, which is a separate question.)

export interface BrowserAdInputs {
  newPlayersPerDay: number;
  d1Retention: number; // 0..1, share still playing the next day
  sessionsPerUser: number; // sessions per active user per day
  sessionMinutes: number; // minutes of play in a session — sets the impression ceiling [8]
  oneMinuteConversion: number; // 0..1, share of players reaching one minute of play [9][10]
  adsPerSession: number; // monetised impressions per session, CLAMPED to the ceiling
  rewardedPerSession: number; // player-initiated rewarded video, outside the pacing cap [8]
  ecpmUsd: number; // GROSS revenue per 1,000 impressions, before the portal's cut
  revShare: number; // 0..1, developer's share of that gross
  eurPerUsd: number;
}

const nn = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);
const frac = (x: number) => (Number.isFinite(x) && x > 0 ? Math.min(x, 1) : 0);

/** The portal's SDK serves at most one midgame ad per this many minutes, and paces it for you —
 *  so session length, not the developer, decides how many midgame impressions a session can
 *  hold [8][9]. */
export const MIDGAME_CAP_MINUTES = 3;

/** Published spread behind each default, shown in the UI so no field reads as a measurement. */
export const HINTS: Record<string, string> = {
  newPlayersPerDay: "your audience lever — set it from a portal's own traffic estimate",
  d1Retention: "0.15–0.40 · portal casual traffic is largely one-and-done",
  sessionsPerUser: "1.0–2.5 · session count rises with loop depth",
  sessionMinutes: "10+ min average play marks a portal success [10]; 9 sits just under that bar",
  oneMinuteConversion: "share reaching one minute of play [9] · top performers clear 80% [10]",
  adsPerSession: "1–3 · midgame on death or level end — clamped to what the session permits [8]",
  rewardedPerSession: "player-initiated, outside the 3-minute pacing cap [8] · 0 until offered",
  ecpmUsd: "gross eCPM $2–6 tier-3 markets → $12–30 tier-1 [6]",
  revShare: "40% standard / 60% with launch exclusivity [4] — no official rate published [2]",
  eurPerUsd: "portals pay in EUR [3]; eCPM benchmarks are quoted in USD",
};

// revShare 0.50 = midpoint of [4]'s 40/60; Poki's 100%-own-traffic term [1] is the better case,
// so 0.50 under-promises rather than over. ecpmUsd 2.50 sits near the floor of [6]'s cheap-tier
// band because portal audiences are worldwide. Cross-check: 2.50 × 1.6 × 0.50 = $2.00 developer
// RPM/1,000 sessions, bracketing the realised ≈€1.23 [5]; audience defaults → ≈12,000 DAU and
// ≈€31/day, anchor [7]. sessionMinutes 9 and oneMinuteConversion 0.60 both sit UNDER the portal's
// published success bars [10], and together they leave a ceiling of 1.80 — above the 1.60 dial,
// so the defaults are NOT clamped and the [7] calibration survives untouched. The ceiling bites
// exactly where it should: on a short loop toy.
export const BROWSER_AD_DEFAULTS: BrowserAdInputs = {
  newPlayersPerDay: 9000,
  d1Retention: 0.25,
  sessionsPerUser: 1.4,
  sessionMinutes: 9,
  oneMinuteConversion: 0.6,
  adsPerSession: 1.6,
  rewardedPerSession: 0,
  ecpmUsd: 2.5,
  revShare: 0.5,
  eurPerUsd: 0.92,
};

export interface BrowserAdProjection {
  dau: number;
  sessionsPerDay: number;
  midgamePerPlay: number; // whole midgame ads the pacing rule permits in one session [8]
  adCeiling: number; // expected monetised impressions per session, conversion-weighted
  effectiveAdsPerSession: number; // min(dial, ceiling) — what actually drives the revenue
  capBinds: boolean; // true when the dial sat above the ceiling and was clamped down to it
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

/** Most monetised impressions a session can actually serve. Midgame counts WHOLE ads only — the
 *  SDK will not serve the next one before the interval elapses [8], so a 4-minute session carries
 *  one however deep the loop is. Rewarded is player-initiated and adds on top of that cap [8].
 *  Both terms are then weighted by conversion: a player who never reaches the first minute never
 *  reaches the first ad either, which is why the portal scores conversion as the gate on
 *  impressions-per-play [9]. */
export function adCeilingPerSession(
  i: Pick<BrowserAdInputs, "sessionMinutes" | "oneMinuteConversion" | "rewardedPerSession">,
): { midgamePerPlay: number; adCeiling: number } {
  const midgamePerPlay = Math.floor(nn(i.sessionMinutes) / MIDGAME_CAP_MINUTES);
  return {
    midgamePerPlay,
    adCeiling: (midgamePerPlay + nn(i.rewardedPerSession)) * frac(i.oneMinuteConversion),
  };
}

export function browserAdProjection(i: BrowserAdInputs): BrowserAdProjection {
  const dau = projectedDau(i.newPlayersPerDay, i.d1Retention);
  const sessionsPerDay = dau * nn(i.sessionsPerUser);
  const { midgamePerPlay, adCeiling } = adCeilingPerSession(i);
  const effectiveAdsPerSession = Math.min(nn(i.adsPerSession), adCeiling);
  const impressionsPerDay = sessionsPerDay * effectiveAdsPerSession;
  const netUsdPerDay = (impressionsPerDay / 1000) * nn(i.ecpmUsd) * frac(i.revShare);
  return {
    dau,
    sessionsPerDay,
    midgamePerPlay,
    adCeiling,
    effectiveAdsPerSession,
    capBinds: adCeiling < nn(i.adsPerSession) - 1e-9,
    netUsdPerDay,
    netEurPerDay: netUsdPerDay * nn(i.eurPerUsd),
    netUsdPerYear: netUsdPerDay * 365,
    netRpmUsd: sessionsPerDay > 0 ? (netUsdPerDay / sessionsPerDay) * 1000 : 0,
  };
}
