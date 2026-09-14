# 2026-07-24 — Browser crawlers rotate through the catalog and seed from "new games"

**Decision.** The browser adapters (CrazyGames, Poki) no longer crawl `urls.slice(0, limit)` of
the portal sitemap (#99, PR #115). Each run's crawl set is built from two parts, using helpers in
`app/server/src/crawler/base.ts`:

- **`rotatingWindow`**: run N takes `limit` URLs starting at offset `N × limit`, wrapping at the
  end, so repeated runs sweep the whole catalog. `crawlRotation`
  (`app/server/src/crawler/load.ts`) derives N from the existing `crawls` table, so no schema
  change was needed.
- **`fetchDiscoverySeed`**: a best-effort fetch of the portal's own "new games" listing.
  `mergeDiscovery` puts the seed first, removes duplicates and caps the seed at half the limit so
  it can never crowd out the sweep.

**Why.** The CrazyGames sitemap listed 4,269 game URLs with no `<lastmod>`. With the crawl limit
at 250, every run re-fetched the same fixed prefix of about 6%, in an order that says nothing about
recency. New releases never entered the crawl set, so `games.first_seen_at` stopped advancing and
every browser supply-velocity signal built on it (`genreSupplyTrend`, `supplyRising`,
`genreSupplyPressure`, new releases) was structurally zero. Poki had the same pattern.

**Rule.** This change controls *which* URLs are crawled, never *how many*. `CRAWL_LIMIT` and the
crawl budget did not change. The seed is failure-tolerant by design: a throw, a 404 or a page that
parses to zero URLs falls back to the rotating window alone, so a portal that changes its markup
cannot break or empty a crawl.

**Consequences.** A title missing from the sitemap can still enter the crawl through the seed. The
seed's failure is silent, so whether it actually delivered is checked by the capture-yield gate
(see [2026-08-31](2026-08-31-browser-capture-yield.md)) rather than by the crawl.
