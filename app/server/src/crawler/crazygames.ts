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
const NEW_URL = `${BASE}/en/new`;
const newGameLinks = linkExtractor(BASE, "/game/");

function extractNextData(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no __NEXT_DATA__ found");
  return JSON.parse(m[1]);
}

export const crazygames: SourceAdapter = {
  name: "crazygames",
  baseUrl: BASE,

  // Selection, not volume (#99): a recency seed from /en/new ahead of a rotating sitemap
  // window. The seed is best-effort; the window alone still guarantees eventual coverage.
  async listGameUrls(limit = 50, opts: ListOptions = {}): Promise<string[]> {
    const xml = await politeFetch(`${BASE}/en/sitemap`);
    const all = [...xml.matchAll(/<loc>([^<]*\/game\/[^<]+)<\/loc>/g)].map((m) => m[1]);
    const seed = await fetchDiscoverySeed("crazygames", NEW_URL, newGameLinks);
    return mergeDiscovery(seed, rotatingWindow(all, limit, opts.rotation ?? 0), limit);
  },

  parseGame(html: string, url: string): RawGame {
    const data = extractNextData(html);
    const g = data?.props?.pageProps?.game;
    if (!g) throw new Error("no game in pageProps");
    const rating10 = typeof g.rating === "number" ? g.rating : null;
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
      featured: false, // homepage/featured comes from listing context (future enhancement)
    };
  },
};
