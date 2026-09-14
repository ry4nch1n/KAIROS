# 2026-07-20 — The Steam market read gains a sub-genre (tag) lens

**Decision.** The Steam market read gets a second economics lens keyed on SteamSpy tags as well
as store genres (#90, PR #96). `getSteamTagEconomics` (`app/server/src/queries/steam.ts`) is the
genre-economics aggregate re-keyed on tag name. It filters out curation tags, applies a
minimum-supply threshold and defaults to the indie cohort. `getSteamOverview` exposes it as
`tagEconomics` (contract v9). Radar shows it through a Genre / Sub-genre toggle on the economics
card.

**Why.** Store genres are too coarse to read a real market. A luck/synergy deckbuilder is spread
across Card Game, Strategy, Indie and Casual, so its supply, demand, price and revenue proxy never
showed up as one number. The data was already there: the crawler stores SteamSpy `topTags` in
`tags` / `game_tags`, and the browser Market Gaps read already joined them. This was a gap in what
the UI showed, not in what the crawler collected, so no new crawl was needed.

**Shape.** Demand is median reviews from the start, per the
[same-day demand decision](2026-07-20-steam-demand-is-median-reviews.md). Tag rows **overlap**
(one game carries many tags), so the lens does not partition the catalog and its rows must not be
summed. The card says this in its note.

**Consequences.** The tag lens shares its aggregate helper with the store-genre lens, so later
extensions such as the revenue band (contract v10, #53) reach both lenses and cannot drift between
them. The momentum signals (`supplyTrend` / `supplyRising`, `demandTrajectory`) were added to it
later under #114. Field shapes: [`docs/reference/contract.md`](../reference/contract.md).
