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

export async function politeFetch(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
