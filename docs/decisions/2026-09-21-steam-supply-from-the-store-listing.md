# 2026-09-21 — Steered Steam tags read supply from the store's release listing

**Decision.** For each Steam tag the standing flags match (at most 15), the daily crawl fetches one
100-row "newest first" page of the store's own search (`infinite=1`, games only) into an
append-only `tag_census` table. The Steam sub-genre lens takes `supplyTrend` from the newest census
row when one from the last 7 days exists (`supplySource: "census"`), and from the crawled sample
otherwise. A page that ran out within a week of one month is a lower bound and reads as crowding;
beyond that, the partial prior window is compared at its daily rate. `total_count` is stored every
run but not read yet (#245).

**Why.** The Steam crawl is a survivor sample, so a niche tag's cheap launches never reach it. On
2026-09-21 the crawl held 3 Roguelike Deckbuilder titles and reported no new supply; the store
listed 94 releases in 60 days at a $7.99 median price. Slice 1 (#249) stopped calling that "quiet";
the census replaces the guess with a count. The `json=1` search variant the issue first proposed
returns only names and logos, so it can't measure anything.

**Trade-offs.** It parses store HTML, not a documented API, so it fails loudly and falls back after
7 days. One page per tag keeps the cost flat (about 9 requests a day at today's flags), at the
price of lower bounds on broad tags. The flag matcher now drops "video", which also stops "video
games" in a flag steering the Radar toward video tags.

**Not decided here.** Reading the `total_count` series (needs ~60 days of history), and whether
heavy but flat supply — Roguelike Deckbuilder runs about 47 releases a month and reads "steady" —
deserves its own signal.
