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
  // ── Portal promotion (#56). Optional: a source that exposes no such signal leaves them
  // undefined and the loader writes NULL — "not measured", distinct from a measured false.
  // Read the captured value narrowly: portal shelves are personalized by region and device,
  // so it means "promoted to an anonymous desktop visitor from the runner's region that day"
  // (the payloads literally carry the caller's geo — SG locally, US from CI).
  homepagePosition?: number | null; // 1-based rank on the portal's homepage shelf
  trending?: boolean | null; // portal's own trending flag, where one exists
  // ── Phase 2: Steam / PC fields (optional; null/undefined for browser sources) ──
  releaseDate?: string | null; // ISO YYYY-MM-DD
  plays?: number | null; // owners estimate (also mirrored to owners_est)
  ownersEst?: number | null; // SteamSpy owners-bucket midpoint
  priceCents?: number | null;
  discountPct?: number | null;
  ccu?: number | null; // concurrent players
  medianPlaytimeMin?: number | null;
  metacritic?: number | null;
  scaleTier?: string | null; // 'hobby' | 'small_indie' | 'est_indie' | 'aaa'
  // AI-content disclosure (#110). Tri-state: true = the store page carries the AI Generated
  // Content Disclosure block, false = checked and absent, null/undefined = not checked (out of
  // the gated cohort) or the store-page fetch failed. Store-page-only — absent from the 3 JSON
  // endpoints, so it's fetched separately and only for the recent non-AAA cohort.
  aiDisclosure?: boolean | null;
  aiDisclosureNote?: string | null; // the developer's <i>…</i> note, when present
  // Follower count (#54) — the app community group's member count, the closest public proxy to
  // wishlists. null/undefined = NOT MEASURED (out of the non-AAA gate, no community group, or the
  // fetch failed), never a measured 0. Append-only snapshots make the delta a velocity series;
  // following is reversible and accounts get deleted, so that series is only NEAR-monotonic.
  followers?: number | null;
  // Unreleased / "coming soon" (#54 part 2). TRUE means the store says the title has NOT shipped:
  // it has no reviews, no owners and no release date, so it is EXCLUDED from every market
  // analytic (which all describe released titles). Its followers are the point — that is the one
  // pre-purchase demand number an unshipped game has. null/undefined = not measured (browser
  // sources), which reads the same as false everywhere via `IS NOT TRUE`.
  comingSoon?: boolean | null;
  // ── Store-page completeness (#178). CAPTURE ONLY — no analytic reads these yet.
  // All three come free from payloads already fetched (`store/api/appdetails` +
  // SteamSpy `appdetails`), so they add ZERO crawl cost and never touch CRAWL_LIMIT.
  // null/undefined = NOT MEASURED (browser sources, or the field absent from the payload) —
  // distinct from a measured zero/empty, which is itself the signal: the two lowest-review
  // titles in the 2026-08-24 deckbuilder pass were the only two shipping no achievements and
  // no cloud saves, and the single-language one was bottom of the band.
  languageCount?: number | null; // distinct store-listed languages (localisation breadth)
  hasSimplifiedChinese?: boolean | null; // the single highest-leverage locale for indie reach
  /**
   * Which of the four store-page features the listing carries, as a sorted subset of
   * {@link STORE_FEATURES}. An EMPTY array is a measured "carries none of them" — the bottom-band
   * signal — and must never be collapsed to null, which means the payload never told us.
   */
  storeFeatures?: string[] | null;
}

/**
 * The store-page features worth capturing, in the order they are written. Each is a boolean
 * fact about the listing (not about the game), so the compact array form beats four columns.
 */
export const STORE_FEATURES = ["achievements", "cloud", "controller", "workshop"] as const;

/** Per-run selection inputs for {@link SourceAdapter.listGameUrls}. */
export interface ListOptions {
  /**
   * Monotonic run counter for this source (the `crawls` row count — see `crawlRotation`).
   * Drives the rotating sitemap window so successive runs sweep different slices of the
   * catalog instead of re-fetching the same prefix forever.
   */
  rotation?: number;
}

export interface SourceAdapter {
  name: string;
  baseUrl: string;
  /** Enumerate game page URLs (e.g. from the sitemap). */
  listGameUrls(limit?: number, opts?: ListOptions): Promise<string[]>;
  /** Parse one fetched game page HTML into a RawGame. */
  parseGame(html: string, url: string): RawGame;
}

const UA = "KAIROS-GameRadar/0.1 (+market-intel; contact: solo-dev) Mozilla/5.0 (compatible)";

// Per-request timeout (#31). Every crawler request routes through politeFetch, so bounding
// it here bounds them all — including the three sequential Steam endpoints in fetchSteamGame
// (SteamSpy, the most rate-limit-prone, is already caught per-endpoint and continues with
// partial fields; appdetails/reviews propagate to the steamCrawl loop's catch, which logs +
// moves to the next game). A single hung upstream can no longer stall a record indefinitely
// and blow the crawl's Actions-minute budget — it fails fast and the run proceeds.
const DEFAULT_TIMEOUT_MS = 8000;

export async function politeFetch(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, ...extraHeaders },
      signal: ctrl.signal,
    });
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

// URL selection (#99), shared by every sitemap-backed adapter. Browser portal sitemaps carry
// no <lastmod>, so a plain `urls.slice(0, limit)` re-fetched the same fixed prefix every run:
// new releases outside it were never discovered, games.first_seen_at stopped advancing, and
// every supply-velocity signal read a structural zero.

const dedupe = (urls: string[]): string[] => [...new Set(urls)];

/**
 * Build an extractor for `<base><path><slug>` game links in a listing page — matches both
 * href attributes and paths embedded in an SSR JSON blob, and ignores non-game nav links.
 */
export const linkExtractor = (base: string, path: string) => (html: string) =>
  [
    ...html.matchAll(
      new RegExp(`["'](?:https?://[^"']*?)?${path}([a-z0-9][a-z0-9-]{1,80})["'?#/]`, "gi"),
    ),
  ].map((m) => `${base}${path}${m[1].toLowerCase()}`);

/**
 * Deterministic rotating window over an unordered catalog: run N takes `size` URLs from
 * offset `(N * size) % total`, wrapping past the end. Assumes nothing about the portal (no
 * dates, no ordering) and is the load-bearing half of the fix — over enough runs it sweeps
 * the whole catalog. `size` rarely divides `total` evenly, so each wrap lands on a different
 * phase and slots dropped from a window's tail (where a seed took their place) come back.
 */
export function rotatingWindow(urls: string[], size: number, rotation = 0): string[] {
  const total = urls.length;
  if (total === 0 || size <= 0) return [];
  if (size >= total) return [...urls];
  const start = (((Math.trunc(rotation) * size) % total) + total) % total;
  const window = urls.slice(start, start + size);
  if (window.length < size) window.push(...urls.slice(0, size - window.length));
  return window;
}

/**
 * Fetch a portal's own "new games" listing (an ordinary page on a host we already crawl) and
 * extract game URLs. Deliberately failure-tolerant: that page may be JS-rendered, moved, or
 * re-marked-up at any time, and a throw / 404 / zero-URL parse must never break or empty a
 * crawl — it logs, returns `[]`, and the caller falls through to the rotating window alone.
 */
export async function fetchDiscoverySeed(
  label: string,
  url: string,
  extract: (html: string) => string[],
): Promise<string[]> {
  try {
    const urls = dedupe(extract(await politeFetch(url)));
    if (urls.length === 0) {
      console.warn(`[${label}] discovery seed ${url} yielded 0 urls — sitemap window only`);
      return [];
    }
    return urls;
  } catch (e) {
    console.warn(`[${label}] discovery seed ${url} failed (${String(e)}) — sitemap window only`);
    return [];
  }
}

/**
 * Merge a recency seed ahead of the breadth sweep, dedupe, cap at `limit` — changing *which*
 * URLs are crawled, never how many. The seed is itself capped at half the limit so a large
 * listing page can never starve the sweep that guarantees eventual full-catalog coverage.
 */
export function mergeDiscovery(seed: string[], sweep: string[], limit: number): string[] {
  if (limit <= 0) return [];
  const head = dedupe(seed).slice(0, Math.ceil(limit / 2));
  return dedupe([...head, ...sweep]).slice(0, limit);
}
