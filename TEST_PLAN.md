# KAIROS — Test & Verification Plan

This plan defines **what "working" means** and how each claim is proven. Nothing is done until its
claim is backed by evidence: a passing test, a green gate, or an observed result in the running app.
The tests themselves own the exact assertions; this page says which layer catches what, and why each
layer exists.

## Environments

| Env | Database | Web | API |
|---|---|---|---|
| **Local** | PGlite (in-process Postgres, file-persisted, seeded deterministically) | Vite dev server | Express |
| **Production** | Neon Postgres | Netlify static | Netlify Function |

Same SQL and the same handlers in both; only the database driver and the HTTP shell differ. So a
behaviour verified locally is the behaviour that ships, with one exception: the Netlify bundle. A
module that resolves under `tsx` can still break in the bundled Function, and only a deployed build
(a draft deploy is enough) exercises that path.

---

## Gate layers

| Layer | Where it runs | Catches | Blocks |
|---|---|---|---|
| **Lint** (Biome) | CI + local pre-push | Formatting and lint-rule regressions | Merge |
| **Unit + integration** (Vitest, server + web) | CI | Logic and query errors, driven against a real PGlite database and real captured fixtures | Merge |
| **Contract test** | CI | A payload or taxonomy change without its version bump; writes that violate the contract | Merge |
| **Route parity** | CI | The Express and Netlify Function route surfaces drifting apart | Merge |
| **Docs drift** | CI | Generated reference in `docs/reference/` out of date with the code | Merge |
| **Build** (web typecheck + bundle) | CI | Type errors and bundling failures | Merge |
| **Browser e2e** (Playwright) | Local pre-push hook, not CI | Smoke, resilience, accessibility, and **zero page-level horizontal overflow at 375px** per service | Push |
| **Data-quality gate** | End of the daily crawl, or on demand | Stale or wrong *data* in production that every shape test passes | Nothing — detects |

Everything above the last row is a merge gate: `ci.yml` runs lint → test → build, and branch
protection makes it required. e2e stays local because a flaky browser suite as a required check would
block merges on noise; the pre-push hook is the enforcement, and `--no-verify` is the deliberate bypass.

## Test conventions

- **Fixtures are real captured payloads** (`server/test/fixtures/`), so a parser is tested against what
  the portal actually serves. When a portal changes its markup, refresh the fixture with the fix.
- **Queries are tested against a real database**, not mocks. The SQL is the part that can be wrong.
- **Every defect gets a regression test** that fails before the fix and passes after.
- **Mobile is a gate, not a review item.** The 375px overflow spec fails the push on regression.

---

## The data-quality gate

**Why it exists.** Shape tests prove the right columns come back, deduplicated and platform-isolated.
They cannot see that the data is stale or wrong. Data bugs have repeatedly passed a fully green suite:
an indie seed that silently came back empty, a date parser that left every release date null,
a comparables list that collapsed to two rows. Data also regresses *after* merge, when an upstream
changes its locale, API or ranking. Only a standing check on production data catches that.

**Mechanism.** `server/scripts/check-steam-data.ts` runs pure, unit-tested assessors against the live
database and exits non-zero on failure. It is the final step of `crawl.yml` and the only step of
`check-data.yml`. The load has already happened, so the gate **detects rather than prevents**; its job
is to turn a degenerate crawl red instead of letting it look green.

**Measured over the freshest cohort.** Invariants read the games whose latest snapshot is from the most
recent crawl day, scoped to released titles. Legacy rows keep nulls a single crawl can't fix, so
measuring all-time would false-fail forever; unreleased titles have honest nulls that would dilute the
fills. Unreleased titles are reported as their own count.

| Invariant | Fails when |
|---|---|
| Crawl produced data | The fresh Steam cohort is too small to be a real crawl |
| Date accuracy | Release-date fill falls below half the cohort (parser or locale regression) |
| Rating fill | Rating fill falls below the floor |
| Indie cohort non-degenerate | Too few non-AAA titles (empty indie seed, or scale mistaken for AAA) |
| Recent comparables populated | The comparables list collapses |
| Golden classifications | A known self-published hit reads AAA, or a known major-backed title doesn't |
| Capture yield, Steam and browser | An optional enrichment the crawl attempts captures 0% over a real cohort |

Thresholds are deliberately conservative, so they fire only on real degeneracy, and they live in one
place (`DEFAULT_STEAM_QUALITY`). Capture-yield rows are a registry: guarding a new enrichment adds one
row.

**Report-only lines** print beside the invariants without failing the run. A measurement becomes an
assertion only after its first real readings show where a threshold belongs. The current report-only
line is **vote-count freshness** per browser portal: Hidden Gems, the popular top 10% and the whole
catalogue, each split into moving, frozen and too-thin series.

---

## Definition of done

1. CI is green: lint, every test, build.
2. The pre-push e2e suite passes, including the 375px overflow check.
3. A change to a payload or taxonomy bumps its contract version in the same commit.
4. A change to a documented surface regenerates `docs/reference/` in the same commit.
5. A user-visible change is observed working in the running app, not only in tests.
6. A change that touches production data paths is followed by a clean data-quality gate run.

## When something fails

1. Reproduce it, and write a failing test that captures the defect.
2. Fix it minimally, re-run that test, then the full suite.
3. Re-verify the affected behaviour in the running app.

Never report a fix as verified without observed evidence.
