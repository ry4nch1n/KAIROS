# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the solo developer who operates KAIROS.** One person, running a one-person game studio. Uses the app on desktop for analysis sessions and on a phone opportunistically (in bed, away from the desk) to check what moved. Deep familiarity with the product's own vocabulary — but that vocabulary is large enough (loop families, settings, moods, route lens, opportunity z-scores, pitch statuses) that the app still serves recall, not just reference.

**Secondary, and real: an unaided third-party viewer.** A collaborator, publisher, or peer developer genuinely lands on KAIROS and must understand it without a walkthrough. Production read endpoints are currently public (the Basic-auth gate is deliberately open). This audience is confirmed as a design target, not incidental: first-run comprehension, self-defining terminology, and honest empty states are requirements rather than polish.

## Product Purpose

A **decision engine**, not a data display. It answers one question for a solo developer: *what should I build next, and is this specific idea worth a year of my life?*

**Success is a confident build/no-build call.** The funnel Radar (find an underserved opportunity) → Library/pitch (shape it) → prototype (feel-test it) → Revenue (can it clear the income target?) is one path, and the product is composed around that path rather than around four coexisting dashboards.

## Positioning

Two mechanisms a neighboring market-intel tool could not truthfully copy:

1. **Append-only snapshots that compound.** Nothing is ever overwritten; every crawl writes an immutable row. All intelligence — growth, saturation, breakouts, hidden gems, supply velocity — is *derived* from the diff between snapshots. The system gets smarter for free as history accumulates, and cannot be bootstrapped by a competitor starting today.
2. **Epistemic honesty as a product feature.** Estimates are shown as bands, not points; two independent revenue estimators are exposed with a disagreement flag; modelled inputs are labelled "assumed · {source}"; unmeasured is rendered differently from failed; a column hides itself when its curation coverage drops below 40%. The product's claim is not "here are the numbers" but "here is what we actually know, and how well."

## Operating Context

- **One shell, four services**, toggled by a fixed rail with no router: **Radar** (market gap analytics over Steam + browser portals), **Brief** (periodic news digest), **Library** (game pitches and playable browser prototypes), **Revenue** (Steam revenue projection against a real income target).
- **Operated by one person, unattended for years, at near-zero cost.** Crawls run daily on a schedule; deploys are batched to one per day for hosting-credit control. The architecture optimizes for low ops, not for scale.
- **Scheduled agent routines write into the product** (pitch posting, feedback triage, brief generation) and the UI is where their output is reviewed. The app is both an analysis tool and a review surface for automation.
- **Downstream, numbers leave the app by hand** into a separate studio P&L. There is currently no export path.
- **Mobile is a first-class target.** The SPA is opened on phones; a zero-horizontal-overflow gate at 375px is enforced by an e2e test.

## Capabilities and Constraints

- **Data contract is the coordination mechanism.** `shared/src/contract.ts` is the single source of truth for payload shapes and taxonomy, served at `GET /api/contract`, enforced on write, asserted by a test. Changing a shape or a taxonomy value means bumping its `version` in the same commit.
- **Confirmed domain vocabulary** (contract taxonomy, currently v15 / taxonomy v3): loop families, settings (worlds), moods, content scopes, pitch statuses (`building`, `prototyping`, `validated`, `parked`, `shelved`), route lens, tiers. Adding a value is a contract change, on purpose.
- **Analytical terms the UI must carry**: opportunity score as `z(demand) + z(quality) − z(supply)` with its three signed components, revenue bands with an estimator-disagreement flag, quiet-launch baseline, supply velocity/crowding, AI-content disclosure tri-state, review velocity.
- **Dual-driver database selected at runtime** — in-process Postgres locally, hosted Postgres in production, same SQL.
- **API handlers are shared; routing is duplicated across a local server and a production function**, with a parity test gating drift.
- **Server runs without a build step**; TypeScript imports carry explicit extensions.
- **Deploys are batched daily** and hosting credits are hard-capped — visual work cannot assume free redeploys.
- **Undecided:** whether a public/shared viewing mode should ever diverge from the operator's view (separate surfaces vs one surface that is simply honest).

## Brand Commitments

- **Name:** KAIROS; the market-intelligence surface is codenamed **GameRadar**.
- **Voice:** plainspoken, quantitative, and epistemically careful. Real product strings set the register — "plan against the pessimistic column", "untested is not the same as failed", "engine & wishlists model *your* build, not this game's", "assumed · {source}". Formulas are printed in legends rather than hidden behind info icons. This voice is confirmed and binding.
- **Copy constraint:** UI strings must stay user-agnostic. No personal workflow, tooling, routine names, or private financial context may appear in shipped copy — third parties see KAIROS without context.

## Evidence on Hand

- **Real crawled market data** (Steam plus browser portals) as append-only snapshots, with derived analytics. Local development databases may be empty or thin; production carries the accumulated history.
- **Real pitches and playable browser prototypes**, with generated key art (16:9 header capsules and in-game screenshots) already rendering in Library.
- **Steam appids are present on comparable rows**, so official capsule art is available and currently unused outside Library.
- **Cited external sources** appear in product copy (e.g. GameDiscoverCo for conversion assumptions).
- **Absences future work must not fabricate:** no testimonials, no customers, no usage metrics, no pricing, no third-party endorsements. There is exactly one operator.

## Product Principles

1. **Nothing renders unless it changes a decision.** The product exists to produce a build/no-build call; chrome that performs dashboard-ness without moving that call is cost, not value.
2. **Never let confidence outrun evidence.** Bands over points, disagreement flagged, assumptions labelled, absence distinguished from failure — and an empty dataset must fail loudly rather than render as a valid analysis.
3. **Compose around the funnel.** Radar → pitch → prototype → Revenue is one path; each surface should end by handing off to the next step, not by signing its name.
4. **The vocabulary is the product, so the vocabulary must be reachable.** Domain terms are load-bearing and deliberately specific; their definitions must be available to both audiences, on touch as well as hover.
5. **Density is earned by legibility.** This is a dense analytical tool by design; density that cannot be scanned is noise wearing density's clothes.

## Accessibility & Inclusion

**WCAG 2.1 AA is a real gate, not an aspiration.** Confirmed requirements: 4.5:1 minimum text contrast, visible focus indicators on every interactive element, full keyboard reachability, correct heading order with a single `h1` per view, and touch targets meeting the 44px minimum. To be enforced by an automated test in the same spirit as the existing 375px horizontal-overflow gate, so it cannot silently regress.
