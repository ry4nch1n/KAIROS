# 2026-08-24 — The unreleased cohort gets its own surface, not a column on a released one

**Decision.** Coming-soon Steam titles stay excluded from every released-cohort analytic
(`RELEASED_ONLY`) and are read on exactly one dedicated surface — `getSteamUpcoming`, carried as
`SteamOverview.upcoming` and rendered as its own "Upcoming — pre-release demand" card (#164).
Followers are surfaced there and nowhere else: #54 narrowed the *capture* to that cohort because a
shipped game's followers restate its review count, so a `comparables` column would have been null
for every row it appeared on, reintroducing the mixing `RELEASED_ONLY` prevents.

**Consequences.** Contract v18, additive. No schema change — `game_snapshots` has held `followers`
and `coming_soon` since #54. Velocity needs two measured days, so a fresh database renders "—".
