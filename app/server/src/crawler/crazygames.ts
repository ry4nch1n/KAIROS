// CrazyGames adapter. Data lives in the SSR __NEXT_DATA__ blob -> props.pageProps.game.
// No headless browser needed (verified). Rating is 0-10 on CrazyGames -> normalized to 0-5.
import {
  type ListOptions,
  type RawGame,
  type SourceAdapter,
  fetchDiscoverySeed,
  linkExtractor,
  mergeDiscovery,
  politeFetch,
  rotatingWindow,
} from "./base.ts";

const BASE = "https://www.crazygames.com";
const IMG = "https://imgs.crazygames.com/";

// Recency seed: the portal's own "new games" listing, on a host we already crawl.
// `/en/new` 404s (#138) — the locale prefix is only valid on non-English paths.
const NEW_URL = `${BASE}/new`;
const newGameLinks = linkExtractor(BASE, "/game/");

// Promotion seed (#56): the homepage's SSR blob carries props.pageProps.featuredGames as an
// ORDERED 8-item shelf (its sibling shelves ship `items: []` and hydrate client-side, so this
// is the only usable one). One extra fetch per crawl, not per game.
const HOME_URL = `${BASE}/`;
const featuredRank = new Map<string, number>(); // slug -> 1-based homepage position

function extractNextData(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no __NEXT_DATA__ found");
  return JSON.parse(m[1]);
}

/**
 * Parse the homepage shelf into crawl URLs *and* record each slug's rank for `parseGame`.
 * Doubling as a discovery seed is the point: the shelf is 8 slots against a ~4,000-game
 * catalog, so without seeding them into the crawl set the column would be `false` on
 * essentially every row — indistinguishable from the hardcoded `false` it replaces.
 */
function extractFeatured(html: string): string[] {
  featuredRank.clear(); // cleared first, so a failed/changed homepage can't leave stale ranks
  const items = extractNextData(html)?.props?.pageProps?.featuredGames?.items;
  if (!Array.isArray(items)) return [];
  for (const it of items) {
    const slug = typeof it?.slug === "string" ? it.slug : null;
    if (!slug || featuredRank.has(slug)) continue;
    featuredRank.set(slug, featuredRank.size + 1);
  }
  return [...featuredRank.keys()].map((slug) => `${BASE}/game/${slug}`);
}

export const crazygames: SourceAdapter = {
  name: "crazygames",
  baseUrl: BASE,

  // Selection, not volume (#99): a recency seed from /en/new ahead of a rotating sitemap
  // window. The seed is best-effort; the window alone still guarantees eventual coverage.
  async listGameUrls(limit = 50, opts: ListOptions = {}): Promise<string[]> {
    const xml = await politeFetch(`${BASE}/en/sitemap`);
    const all = [...xml.matchAll(/<loc>([^<]*\/game\/[^<]+)<\/loc>/g)].map((m) => m[1]);
    const promoted = await fetchDiscoverySeed("crazygames", HOME_URL, extractFeatured);
    const seed = await fetchDiscoverySeed("crazygames", NEW_URL, newGameLinks);
    return mergeDiscovery(
      [...promoted, ...seed],
      rotatingWindow(all, limit, opts.rotation ?? 0),
      limit,
    );
  },

  parseGame(html: string, url: string): RawGame {
    const data = extractNextData(html);
    const g = data?.props?.pageProps?.game;
    if (!g) throw new Error("no game in pageProps");
    const rating10 = typeof g.rating === "number" ? g.rating : null;
    const rank = g.slug ? (featuredRank.get(g.slug) ?? null) : null;
    const votes = (g.upvotes ?? 0) + (g.downvotes ?? 0);
    return {
      sourceGameId: g.slug ?? String(g.id),
      url: url || `${BASE}/game/${g.slug}`,
      title: g.name,
      thumbnailUrl: g.cover ? IMG + g.cover : null,
      developer: null, // CrazyGames exposes only an opaque developerId
      description: g.metaDescription ?? null,
      engine: g.loaderTypeLabel ?? g.technology ?? null,
      orientation: g.orientation ? String(g.orientation).toLowerCase() : null,
      mobile: g.mobileFriendly ?? null,
      genre: g.category?.name ?? null,
      tags: Array.isArray(g.tags) ? g.tags.map((t: any) => t.name).filter(Boolean) : [],
      rating: rating10 == null ? null : +(rating10 / 2).toFixed(2),
      votes: votes || null,
      // Promotion comes from the homepage shelf read in listGameUrls, not the game page.
      // A parse outside a crawl (tests, one-off) sees an empty map => not featured.
      featured: rank != null,
      homepagePosition: rank,
      trending: null, // CrazyGames publishes no trending signal — not measured, not "false"
    };
  },
};
