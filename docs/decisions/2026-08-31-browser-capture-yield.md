# 2026-08-31 — Capture yield extends to the browser portals, inside the same gate

**Decision.** The 0%-capture assertion (#54, made table-driven for Steam on 2026-08-24) now also
guards the browser portals. The registry lives in `app/server/src/checks/browserCaptureYield.ts`
and is evaluated by the existing `check:steam` gate — the daily crawl's only gate step — rather
than by a new `check:browser` script.

**Why the same script.** Splitting it out would need a new npm script *and* a new `crawl.yml`
step. Folding it in costs one import, keeps every invariant reporting in one place (the point of
the 2026-08-24 placement decision), and means a browser enrichment going quiet is reported
alongside the Steam checks rather than instead of them. The gate's filename is now narrower than
its remit; renaming it is a separate, human-owned change. Its banner reads "CRAWL DATA-QUALITY
GATE" to match.

**Why browser needed its own registry.** Steam enrichments are per-game fetches gated by a
per-game predicate. A browser enrichment is ONE shelf/listing fetch per crawl whose failure is
swallowed by design (`fetchDiscoverySeed` returns `[]` so a moved page cannot empty a crawl), so
eligibility is the whole fresh cohort of that source and the cohort must be scoped per portal.

**What is guarded.** `crazygames.featured_rank` (`homepage_position`, #56) — the crawl seeds the
8-slot homepage shelf into its own URL set, so a healthy run always carries at least one rank and
0% is unambiguous. Poki's `homepage_position` is deliberately not guarded: it is incidental
overlap with the homepage grid, not a seeded fetch, so a legitimately zero day exists. Both
`trending` columns are excluded — one is never NULL, the other is NULL by design.

**Coverage.** `app/server/test/browserCaptureYield.test.ts` drives the real SQL against a PGlite
DB — the first end-to-end coverage of the DB-side counting, which the pure-function tests never
touched.
