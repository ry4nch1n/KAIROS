# 2026-07-20 — Steam demand is median reviews, not median owners

**Decision.** The Steam Demand-vs-Supply quadrant scores a genre's demand ("appetite") as the
median of `l.votes` (review count), not the median of `owners_est` (#89, PR #95). Owners × price
stays as the bubble weight, and the y-axis reads "median reviews". This is the same signal the
browser quadrant already used.

**Why.** `owners_est` is a SteamSpy owners-*bucket* midpoint (`parseOwners` in
`app/server/src/crawler/steam.ts`), and the lowest bucket (0..20,000) collapses to a single value,
10,000. The median indie title in almost every genre sits in that bucket, so every genre landed on
the same 10,000 line and the cross-genre median reference line did too. The quadrant could no
longer tell genres apart. Racing floated above the rest only because a 2-title genre can land its
median in a high bucket, which is a small-sample artifact rather than real demand. The SQL and the
scale were fine; the median of a coarse categorical bucket was the wrong estimator.

**Rule.** A demand axis that ranks or splits markets uses a continuous count. Owner buckets appear
only as context or as a revenue-proxy weight, never as the term being ranked.

**Consequences.** `getSteamGenreQuadrant` (`app/server/src/queries/steam.ts`) computes appetite
from median `l.votes`. The sub-genre tag lens (#90, decided the same day) adopted median reviews
from the start. The Steam opportunity ranking had kept median owners and tied markets on one
bucket value, so #218 (PR #223) moved its demand term to the same median-reviews expression.
`SteamGap` carries `medianVotes` as the scored term, and `medianOwners` stays as context.
