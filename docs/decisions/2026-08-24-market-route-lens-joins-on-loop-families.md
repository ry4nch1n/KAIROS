# 2026-08-24 — The market-level Route Lens joins browser and Steam on loop families

**Decision.** `/api/loop-family-market` becomes a cross-platform read (#67): each row carries a
`steam` block (games, median revenue per game, median price, supply trend) beside the browser
demand it already held, plus a `routeLean`. The join key is the curated loop family, never a raw
genre string, and both surfaces fold through one shared rule (`foldFamilies`) — joining two genre
vocabularies was the semantic thinness that deferred this issue. A family median cannot be averaged
out of per-genre medians, so the genre→family map is pushed into SQL (`unnest`).

**Consequences.** The lean compares each surface only against its own cross-family median (units
never mix) and damps a surface whose supply is crowding, so a hot family with a closing door cannot
read as open. Absence is never zero: no Steam games is `steam: null`, no browser supply is
`appetite: null`, a family only Steam reaches is now a row rather than "no coverage", and a
Steam-platform read returns `routeLean: null`. No schema change and no contract bump — this
payload's shapes are module-local by the same choice #108 made, and it consumes the loop-family
enum rather than changing it.
