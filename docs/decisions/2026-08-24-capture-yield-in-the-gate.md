# 2026-08-24 — Capture-yield assertions move into the data-quality gate

**Decision.** The "did this optional enrichment actually arrive" assertion (#54) moves out of
`app/server/src/crawler/run.ts` and into the `check:steam` gate
(`app/server/scripts/check-steam-data.ts`), and becomes a table — one row per guarded
enrichment — rather than a single hand-rolled follower check (#158).

**Why placement changed.** In the crawl workflow the crawl step runs *before* the gate step, so a
non-zero exit from `run.ts` skipped every other data-quality invariant that day: one quiet
enrichment cost visibility into all the rest. Generalising to N enrichments would have multiplied
that. Reporting yield alongside the other invariants keeps the whole picture on a bad day, and the
workflow still ends red because the gate step fails — which is what `crawl.yml` already keys on
(and what its failure reporter already names). Loads are append-only, so a red gate detects
rather than prevents; no run loses a day of data either way.

**Shape.** `assessCaptureYield(cohorts)` in `app/server/src/checks/steamDataQuality.ts` takes
`{ key, eligible, captured, minCohort?, why }` per enrichment, reports `captured/eligible` for all
of them, and fails only on 0% over a cohort at or above its floor. Eligibility mirrors the
crawler's own gating predicate and is measured against the rows the crawl just wrote, never
against log text. Guarding the next enrichment is a row plus two SQL counts.

**Consequences.** `assessFollowerCapture` / `MIN_FOLLOWER_COHORT` are gone, replaced by
`assessCaptureYield` / `MIN_CAPTURE_COHORT`. `crawler/run.ts` no longer imports `checks/`.
`release_state` (`coming_soon`) is guarded as its own row because it is the follower cohort's
eligibility predicate: if it goes null wholesale the follower assertion silently no-ops.
