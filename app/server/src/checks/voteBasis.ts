// Vote-basis invariant (#204 S5). FAILS THE GATE.
//
// Every browser vote read depends on each portal's declared VOTE_BASIS (queries/shared.ts): a
// `cumulative` portal's delta is audience growth in votes/day, a `window` portal's is a signed
// %/wk change in recent engagement, and on `all` levels become within-portal percentiles. Nothing
// on either portal's page says which kind of count it serves, so the basis is a measurement, and a
// portal that silently changes what its count means would corrupt every momentum read without any
// query erroring. This assertion re-measures the basis from the capture-to-capture step profile on
// every gate run.
//
// The measured shapes it guards (check-data run 34811253184, captures ~1 day apart):
//   · Poki (cumulative):       18,183 steps (17,953 moving), 0 down.
//   · CrazyGames (window):     down on 49% / 54% / 62% of MOVING steps at peak <1k / 1k–10k / ≥10k,
//                              53.2% pooled over 14,651 moving steps.
//
// Thresholds sit far from both: a cumulative portal fails above 2% down (a real running total
// never falls, so this only tolerates the odd moderation purge), a window portal fails below 20%
// down (well under half its lowest measured bucket). The share is over MOVING steps (up + down),
// never all steps: a flat step says nothing about direction, and a capture that freezes or a
// crawl cadence that doubles would otherwise move the share without the basis changing — frozen
// counts are the freshness report's job. Steps are pooled per portal across size buckets.
import type { VoteBasis } from "shared";
import { voteBasisOf } from "../queries/shared.ts";
import type { VoteStepProfile } from "./voteFreshness.ts";

/** A cumulative portal's down share of moving steps above this means it is no longer a running total. */
export const CUMULATIVE_MAX_DOWN_SHARE = 0.02;
/** A window portal's down share of moving steps below this means old votes have stopped ageing out. */
export const WINDOW_MIN_DOWN_SHARE = 0.2;
/**
 * Moving steps a portal needs before its share is asserted. At the measured 53% a window portal
 * cannot read under 20% over this many steps by chance, and a cumulative one needs 20 down steps
 * to fail. A daily production crawl clears it in about a day; the synthetic local seed (~560 steps
 * per portal) stays under it.
 */
export const MIN_BASIS_STEPS = 1000;

export interface VoteBasisResult {
  ok: boolean;
  failures: string[];
  /** One line per portal, reported whether or not it passed. */
  lines: string[];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Assert each browser portal's step profile still matches its declared vote basis. */
export function assessVoteBasis(
  steps: VoteStepProfile[],
  basisOf: (source: string) => VoteBasis = voteBasisOf,
  minSteps = MIN_BASIS_STEPS,
): VoteBasisResult {
  const failures: string[] = [];
  const lines: string[] = [];
  const bySource = new Map<string, { up: number; down: number }>();
  for (const p of steps) {
    const acc = bySource.get(p.source) ?? { up: 0, down: 0 };
    acc.up += p.up;
    acc.down += p.down;
    bySource.set(p.source, acc);
  }

  for (const [source, { up, down }] of [...bySource].sort(([a], [b]) => a.localeCompare(b))) {
    const basis = basisOf(source);
    const moving = up + down;
    const share = moving ? down / moving : 0;
    const bound =
      basis === "cumulative"
        ? `≤ ${pct(CUMULATIVE_MAX_DOWN_SHARE)}`
        : `≥ ${pct(WINDOW_MIN_DOWN_SHARE)}`;
    const thin = moving < minSteps;
    lines.push(
      `${source} (${basis}): down ${down} of ${moving} moving steps` +
        (moving ? ` (${pct(share)}, expected ${bound})` : "") +
        (thin ? ` — under the ${minSteps}-step floor, not asserted` : ""),
    );
    if (thin) continue;

    if (basis === "cumulative" && share > CUMULATIVE_MAX_DOWN_SHARE)
      failures.push(
        `vote basis: ${source}'s vote count has started falling (${pct(share)} of ${moving} moving ` +
          `steps went down, expected ${bound}) — it may no longer be a running total. VOTE_BASIS ` +
          `declares it cumulative, and its votes/day momentum, gem selection and every level read ` +
          `depend on that; re-measure the step profile and update VOTE_BASIS if the count is now a window (#204).`,
      );
    if (basis === "window" && share < WINDOW_MIN_DOWN_SHARE)
      failures.push(
        `vote basis: ${source}'s vote count has almost stopped falling (${pct(share)} of ${moving} ` +
          `moving steps went down, expected ${bound}) — it may now be a running total rather than a ` +
          `recent window. VOTE_BASIS declares it window, so its momentum reads as %/wk engagement ` +
          `change; re-measure the step profile and update VOTE_BASIS if the count now only accumulates (#204).`,
      );
  }

  return { ok: failures.length === 0, failures, lines };
}
