// Poki adapter. Data lives in `window.INITIAL_STATE` (RTK Query cache) ->
// state.api.queries["getGame(...)"].data. Rating is already 0-5. Poki exposes a
// developer name (CrazyGames doesn't); engine signal is weak (file.render_type).
import { type RawGame, type SourceAdapter, politeFetch } from "./base.ts";

const BASE = "https://poki.com";
const IMG = "https://img.poki-cdn.com/cdn-cgi/image/width=1200,f=auto/";

// Extract the balanced {...} object assigned to window.INITIAL_STATE.
// Brace-counts while skipping braces that appear inside string literals — the
// RTK query KEYS themselves contain `{`/`}` (e.g. getGame({"slug":"x"})).
function extractInitialState(html: string): any {
  const marker = html.indexOf("INITIAL_STATE");
  if (marker < 0) throw new Error("no INITIAL_STATE");
  const start = html.indexOf("{", marker);
  if (start < 0) throw new Error("no object after INITIAL_STATE");
  let depth = 0, inStr = false, esc = false, quote = "";
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

  async listGameUrls(limit = 50): Promise<string[]> {
    const xml = await politeFetch(`${BASE}/en/sitemaps/games.xml`);
    const urls = [...xml.matchAll(/<loc>([^<]*\/en\/g\/[^<]+)<\/loc>/g)].map((m) => m[1]);
    return urls.slice(0, limit);
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
      featured: false,
    };
  },
};
