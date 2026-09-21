# 2026-09-21 — The steering band is clamped to the ranking's robust spread; one seat per genre

**Decision.** `steeringScale` (`app/server/src/queries/shared.ts`) still sizes the standing-flag
lift from the unsteered visible band (`top − cutoff`, #200/#210), but clamps that band to
`[1, 3] × robustSd` of the whole ranking (1.4826 × MAD). No lifted row may pass the unsteered
leader. A flag that reaches a market through its genre alone lifts only that genre's best eligible
slice; a flag the slice matches on its own tag still counts for that slice (#231).

**Why.** Two order statistics set the old band, so one row could move it. On CrazyGames a
three-game +16σ leader made a 14-point lift, and five `Card × <tag>` slices took five of six seats.
On `all`, bounded vote percentiles (#204) squeezed the band to 0.63, and no lift reached the list.
A spread measure that one outlier can't move fixes both ends with a single rule, and because it is
still relative to each ranking, a setting means the same thing on every surface.
