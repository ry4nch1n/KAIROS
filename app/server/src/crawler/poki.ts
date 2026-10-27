// Poki adapter. Data lives in `window.INITIAL_STATE` (RTK Query cache) ->
// state.api.queries["getGame(...)"].data. Rating is already 0-5. Poki exposes a
// developer name (CrazyGames doesn't); engine signal is weak (file.render_type).
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

const BASE = "https://poki.com";
const IMG = "https://img.poki-cdn.com/cdn-cgi/image/width=1200,f=auto/";

// Recency seed: the portal's own "new games" listing, on a host we already crawl.
const NEW_URL = `${BASE}/en/new`;
const newGameLinks = linkExtractor(BASE, "/en/g/");

// Extract the state assigned to window.INITIAL_STATE. Poki serves two shapes:
//   1. an object literal — `INITIAL_STATE = {...}`
//   2. a JSON string — `INITIAL_STATE = JSON.parse("{\"router\":…}")` (seen since ~2026-10-19;
//      the brace-counter below would slice the *escaped* text and every game failed to parse)
// For (1) we brace-count while skipping braces inside string literals — the
// RTK query KEYS themselves contain `{`/`}` (e.g. getGame({"slug":"x"})).
export function extractInitialState(html: string): any {
  const marker = html.indexOf("INITIAL_STATE");
  if (marker < 0) throw new Error("no INITIAL_STATE");
  const assigned = html.slice(marker).match(/^INITIAL_STATE\s*=\s*JSON\.parse\(\s*"/);
  if (assigned) {
    // The argument is a JS double-quoted literal; Poki only emits JSON-compatible escapes
    // (\" \\ \uXXXX), so JSON.parse decodes the literal and a second JSON.parse the state.
    const open = marker + assigned[0].length - 1;
    let end = open + 1;
    for (; end < html.length; end++) {
      if (html[end] === "\\") end++;
      else if (html[end] === '"') break;
    }
    return JSON.parse(JSON.parse(html.slice(open, end + 1)));
  }
  const start = html.indexOf("{", marker);
  if (start < 0) throw new Error("no object after INITIAL_STATE");
  let depth = 0,
    inStr = false,
    esc = false,
    quote = "";
  let i = start;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === quote) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
    } else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return JSON.parse(html.slice(start, i));
}

export const poki: SourceAdapter = {
  name: "poki",
  baseUrl: BASE,

  // Same selection change as CrazyGames (#99) — see crawler/base.ts for the shared helpers.
  async listGameUrls(limit = 50, opts: ListOptions = {}): Promise<string[]> {
    const xml = await politeFetch(`${BASE}/en/sitemaps/games.xml`);
    const all = [...xml.matchAll(/<loc>([^<]*\/en\/g\/[^<]+)<\/loc>/g)].map((m) => m[1]);
    const seed = await fetchDiscoverySeed("poki", NEW_URL, newGameLinks);
    return mergeDiscovery(seed, rotatingWindow(all, limit, opts.rotation ?? 0), limit);
  },

  parseGame(html: string, url: string): RawGame {
    const state = extractInitialState(html);
    const queries = state?.api?.queries ?? {};
    const slug = url.split("/g/")[1]?.replace(/\/.*$/, "");
    let g: any = null;
    for (const [key, val] of Object.entries<any>(queries)) {
      if (key.startsWith("getGame") && val?.data) {
        if (!slug || val.data.slug === slug) {
          g = val.data;
          break;
        }
        g = g ?? val.data; // fallback: first getGame with data
      }
    }
    if (!g) throw new Error("no getGame data in INITIAL_STATE");

    // Promotion capture (#56) — free, no extra request. Every game page's INITIAL_STATE also
    // carries a getHomepage(...) query whose `data.games` is the homepage grid as a flat
    // ORDERED array, and the game object itself carries Poki's own `trending_rank` (absent
    // when the game isn't trending). Both are personalized by geo/device — see RawGame.
    const hpKey = Object.keys(queries).find((k) => k.startsWith("getHomepage"));
    const homeGames: any[] = queries[hpKey ?? ""]?.data?.games ?? [];
    const hpIndex = g.slug ? homeGames.findIndex((x: any) => x?.slug === g.slug) : -1;

    const cats: any[] = Array.isArray(g.categories) ? g.categories : [];
    const up = g.rating?.up_count ?? 0;
    const down = g.rating?.down_count ?? 0;
    return {
      sourceGameId: g.slug ?? String(g.id),
      url: url || `${BASE}/en/g/${g.slug}`,
      title: g.title ?? g.english_title,
      thumbnailUrl: g.image?.path ? IMG + g.image.path : null,
      developer: g.developer ?? (Array.isArray(g.developers) ? g.developers[0] : null) ?? null,
      description: g.intro ?? g.meta?.description ?? null,
      engine: g.file?.render_type ?? null,
      orientation: g.orientation ?? null,
      mobile: g.mobile_available ?? null,
      genre: g.genre ?? cats[0]?.title ?? null,
      tags: cats.map((c) => c.title).filter(Boolean),
      rating: typeof g.rating?.rating === "number" ? g.rating.rating : null, // already 0-5
      votes: up + down || null,
      featured: hpIndex >= 0,
      homepagePosition: hpIndex >= 0 ? hpIndex + 1 : null,
      trending: typeof g.trending_rank === "number",
    };
  },
};
