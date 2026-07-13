// Pluggable crawler. Add a new portal = implement SourceAdapter + register it.
export interface RawGame {
  sourceGameId: string;
  url: string;
  title: string;
  thumbnailUrl: string | null;
  developer: string | null;
  description: string | null;
  engine: string | null;
  orientation: string | null;
  mobile: boolean | null;
  genre: string | null;
  tags: string[];
  rating: number | null; // normalized 0-5
  votes: number | null;
  featured: boolean;
  // ── Phase 2: Steam / PC fields (optional; null/undefined for browser sources) ──
  releaseDate?: string | null;       // ISO YYYY-MM-DD
  plays?: number | null;             // owners estimate (also mirrored to owners_est)
  ownersEst?: number | null;         // SteamSpy owners-bucket midpoint
  priceCents?: number | null;
  discountPct?: number | null;
  ccu?: number | null;               // concurrent players
  medianPlaytimeMin?: number | null;
  metacritic?: number | null;
  scaleTier?: string | null;         // 'hobby' | 'small_indie' | 'est_indie' | 'aaa'
}

export interface SourceAdapter {
  name: string;
  baseUrl: string;
  /** Enumerate game page URLs (e.g. from the sitemap). */
  listGameUrls(limit?: number): Promise<string[]>;
  /** Parse one fetched game page HTML into a RawGame. */
  parseGame(html: string, url: string): RawGame;
}

const UA =
  "KAIROS-GameRadar/0.1 (+market-intel; contact: solo-dev) Mozilla/5.0 (compatible)";

// Per-request timeout (#31). Every crawler request routes through politeFetch, so bounding
// it here bounds them all — including the three sequential Steam endpoints in fetchSteamGame
// (SteamSpy, the most rate-limit-prone, is already caught per-endpoint and continues with
// partial fields; appdetails/reviews propagate to the steamCrawl loop's catch, which logs +
// moves to the next game). A single hung upstream can no longer stall a record indefinitely
// and blow the crawl's Actions-minute budget — it fails fast and the run proceeds.
const DEFAULT_TIMEOUT_MS = 8000;

export async function politeFetch(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    return await res.text(); // awaited inside the try so a hung body read is bounded too
  } catch (e: any) {
    // The AbortController fires on timeout; surface it as a clear, greppable timeout error
    // (callers treat it like any other fetch failure — the partial-failure paths already exist).
    if (e?.name === "AbortError") throw new Error(`fetch ${url} -> timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer); // never leave a dangling timer holding the event loop open
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
