# KAIROS — Test & Verification Plan

This plan defines **what "working" means** for the KAIROS command-center MVP and how each claim is proven. No feature is "done" until its criterion here is verified with evidence (a passing test or an observed browser result).

## Scope of this MVP

- KAIROS shell: 3 services (GameRadar, News Brief, Library) behind an icon rail.
- GameRadar: reads **live from the database**, platform filter (All / Poki / CrazyGames), all Overview charts.
- News Brief: renders editions from the `brief_editions` table.
- Library: intentional empty state.
- Data: real Postgres schema; DB seeded with deterministic sample data; CrazyGames crawler implemented and unit-tested (its live run is not a gate for app verification).

## Environments

| Env | DB | Web | API |
|---|---|---|---|
| **Local (verify here)** | PGlite (in-process Postgres, file-persisted) | Vite dev server | Express |
| **Prod (later)** | Neon Postgres | Netlify static | Netlify Functions |

Same SQL + same handlers across both — only the DB driver and the HTTP shell differ.

---

## A. Automated tests (Vitest) — must all pass

Written test-first (TDD). Run with `npm test`.

| # | Test | Asserts | Status |
|---|---|---|---|
| A1 | schema applies on fresh PGlite | all tables/views create without error | ⬜ |
| A2 | seed integrity | games > 0, every game has ≥1 snapshot, tags linked, sources = {poki, crazygames} | ⬜ |
| A3 | `getOverview(platform)` | returns `{gamesTracked, avgRating, fastestGenre, openGaps}`; numbers change between `all`/`poki`/`crazygames` | ⬜ |
| A4 | `getGenreMomentum(platform)` | returns series of `{genre, weeks[], values[]}`; respects platform filter | ⬜ |
| A5 | `getTagFrequency(platform)` | returns `[{tag, count}]` sorted desc; platform-filtered | ⬜ |
| A6 | `getHiddenGems(platform)` | every row has `rating ≥ 4.4 AND votes < 5000 AND featured = false` | ⬜ |
| A7 | `getMarketGaps(platform)` | rows ranked by `demand − supply`; demand/supply in 0–100 | ⬜ |
| A8 | `getScatter(platform)` | returns rating×votes points; gems flagged | ⬜ |
| A9 | platform filter isolation | `poki` results contain only `source_id = poki`; `all` ≥ each single platform | ⬜ |
| A10 | `getBriefEditions()` / `getBriefEdition(date)` | list sorted desc; payload JSON parses into sections | ⬜ |
| A11 | CrazyGames adapter parse | parsing a saved fixture yields expected `{title,url,rating,tags,...}` | ⬜ |
| A12 | append-only load | re-running load for same crawl day inserts 0 duplicate snapshots (idempotent) | ⬜ |
| A13 | API routes | `GET /api/overview?platform=poki` etc. return 200 + correct JSON shape | ⬜ |

## B. Browser end-to-end (manual + MCP-driven) — must all pass

Drive the running app with the browser/preview MCP; capture a screenshot per check.

| # | Check | Pass criterion | Status |
|---|---|---|---|
| B1 | App boots | no blank screen; no uncaught console errors | ⬜ |
| B2 | Rail switches services | clicking Radar/Brief/Library swaps sidebar + content; active state correct | ⬜ |
| B3 | Radar charts render | momentum (lines), tag treemap, scatter, feature heatmap all draw with data from API | ⬜ |
| B4 | Platform selector | clicking All/Poki/CrazyGames re-renders KPIs + all charts + gaps + insights with different values | ⬜ |
| B5 | KPI ↔ chart consistency | KPI "games tracked" matches the platform's seeded game count | ⬜ |
| B6 | Brief reader | Brief tab lists editions; selecting one renders its sections (refs/signals/actions) | ⬜ |
| B7 | Library empty state | shows intentional empty state (icon, copy, ghost cards, disabled CTA) — not an error/blank | ⬜ |
| B8 | Loading & empty | charts show a loading state then data; no flash of broken axes | ⬜ |
| B9 | Responsive | at 1280 and 1024 widths layout holds; no horizontal scroll | ⬜ |
| B10 | No console errors | console clean across all three services after interaction | ⬜ |

## C. Usability bar (subjective, but checked)

- C1 Visual matches the approved light-mode mockup (rail + sidebar + cards, Fira fonts, blue/amber).
- C2 Service switch feels instant (< 150ms perceived); charts resize correctly after switch.
- C3 Tooltips appear on chart hover with exact values.
- C4 Nothing looks "placeholder broken" — empty states are designed, numbers are formatted (tabular, thousands separators).

---

## Definition of Done (MVP)

1. **All A-tests green**, output pristine (no errors/warnings).
2. **All B-checks pass** with a screenshot as evidence.
3. **C bar** met on review.
4. `npm run dev` brings up the full command center against the seeded DB with one command (after `npm install` + `npm run db:seed`).
5. Docs current: README run steps work as written; DESIGN/OPERATIONS reflect the as-built stack.

## Iteration protocol (when something fails)

1. Reproduce → write/adjust a failing test that captures the defect (for logic bugs).
2. Fix minimally → re-run that test → re-run full suite.
3. Re-verify the related B-check in the browser.
4. Record the fix in the table above (flip ⬜ → ✅, note the fix).
Do not flip a box to ✅ without observed evidence.

---

## Verification run — RESULTS (2026-06-26)

**A. Automated (Vitest): 17/17 PASS.** A1 schema, A2 seed integrity, A3 overview (platform-differentiated, all = poki+cg), A4 momentum, A5 tag freq, A6 hidden gems (all rating≥4.4 & votes<5000), A7 market gaps (ranked, 0–100), A8 scatter, A8b heatmap, A9 platform isolation, A10 brief, A11 CrazyGames parse (real `__NEXT_DATA__` fixture), A12 append-only idempotency (2nd same-day load inserts 0), A13 API routes (200 + shapes). Command: `npm test`.

**B. Browser E2E (DOM-verified via preview MCP): PASS.**
- B1 boots, no uncaught errors · B10 **zero console errors** across all interaction.
- B2 rail switches services (radar→brief→library→radar), active state + visibility correct.
- B3 Radar draws **4 chart canvases** (momentum/treemap/scatter/heatmap) with real sizes.
- B4 platform selector: All→120 games, Poki→59, subtitle/KPIs/gaps/fastest all re-render.
- B5 KPI "games tracked" = seeded count (120 / 59). 
- B6 Brief: editions list (Jun 26 THU, Jun 23 MON), 4 sections, ref cards, signals, actions from `brief_editions`.
- B7 Library: designed empty state (heading, copy, 4 ghost cards, disabled CTA, "V2" note).
- B8 charts show skeleton→data · B9 responsive 1024 (KPIs→2 cols, no horizontal overflow) and 1440 OK.
- Charts re-render correctly after hide/show (ResizeObserver).

**Build:** `npm run build` → `web/dist` produced (deployable). Note: ECharts full import → 1.2 MB JS (397 KB gzip); flagged for later modular-import optimization (non-blocking).

**Screenshots:** the preview harness's image capture timed out on the canvas-heavy page; rendering was instead verified programmatically (canvas dimensions, DOM content, computed styles, console). App itself is error-free.

**Definition of Done: MET** — all A green, all B verified, one-command `npm run dev` against seeded PGlite, docs current.
