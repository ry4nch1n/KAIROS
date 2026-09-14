# 2026-09-14 — CrazyGames votes are a recent window, not a running total

**Decision.** Every browser portal's vote count has a declared basis, `VOTE_BASIS` in
`app/server/src/queries/shared.ts`: Poki is `cumulative`, CrazyGames is `window` (#204). A portal
not listed reads `cumulative`. A portal becomes `window` only once measured to be one.

**Why.** Hidden Gems read 0 votes/day on 22 of 30 CrazyGames rows. The data-quality gate's step
profile (`check-data.yml` run 34811253184, captures about a day apart) showed why:

- CrazyGames' `upvotes + downvotes` fell on 44% / 53% / 62% of capture-to-capture steps for titles
  peaking under 1k / 1k–10k / at least 10k votes, in small steps (median −2.5% / −0.75% / −0.46%).
  Purges would be rare, large drops; these are daily and small at every size, which is old votes
  ageing out of a rolling window. A live spot check agreed: one title's count sat below its last
  stored capture.
- Poki recorded 18,183 steps and none went down.
- `voteRate` clamps a negative slope to 0, so every falling CrazyGames series read like a dead
  title, and on `all` the two portals' counts were pooled as if they measured the same thing.

The window length is not published and can't be derived from these numbers.

**Rule.**

- Votes have a basis per portal. Raw counts on different bases are never pooled, subtracted,
  compared or ranked against each other.
- Momentum follows the basis. A cumulative portal reads votes/day. A window portal reads the signed
  percent change per week of its level (least-squares slope ÷ mean level × 7 × 100), with a ±5%/wk
  band for a trend and at least three captures for a chip.
- On `all`, a vote level (gem selection, gap and quadrant appetite, loop-family appetite, genre
  medians, scatter x) is each title's percentile within its own portal's live catalogue, taken
  before any median, sum or ordering. The unit is named in the payload.
- On `all`, momentum is shown per portal and never pooled.

**Consequences.**

- Delivered in five PRs: S1 #237 (basis + engagement metric, contract v30), S2 #238 (Momentum
  column, CG/PK markers, early read, v31), S3 #239 (genre momentum per portal, v32), S4 #241
  (within-portal percentiles on `all`, v33), S5 (this record, the gate invariant, docs).
- On production, All Browser Hidden Gems went from 30 CrazyGames titles to 15 per portal, and New
  Releases from 53 / 7 to 30 / 30.
- Percentile appetite is bounded, so the market-gap score band on `all` shrank from 5.71 to 0.63
  points and the standing-flag steering weight fell from 2.86 to 0.31. Steering has little reach on
  All Browser now (#231 owns how the lift is scaled).
- The loop-family Route Lens moved cozy-craft and contained-systemic from a browser lean to
  contested.
- The top `all` gaps now include 3-game cells at P100. A small cell reaches the top percentile
  easily, which sharpens the duplicate-cell problem in #230.
- Rating aggregates (quality ceiling, P75/P90 rating) are still pooled across portals on `all`.
  Ratings share a 0–5 scale, but the portals' distributions differ; this is a known limit.
- `app/server/src/checks/voteBasis.ts` re-measures the basis on every gate run. A cumulative portal
  fails above 2% down steps and a window portal below 20%, as a share of moving steps pooled per
  portal, over at least 1,000 moving steps. A portal that changes what its count means turns the
  crawl red instead of quietly corrupting every momentum read.
