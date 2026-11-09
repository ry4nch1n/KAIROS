// Steam release census (#245 slice 2). The Steam crawl is a survivor sample — top sellers,
// SteamSpy lists, featured shelves — so a cheap launch in a niche tag never enters `games`, and a
// tag the crawl has seen only a handful of times reads "no new supply" while it floods. The
// store's own search lists EVERY release under a tag, newest first, so one request per tag reads
// supply from the store's listing instead of from the crawl's sample.
//
// Endpoint: the infinite-scroll variant of store search. The `json=1` variant returns only
// `{name, logo}` per row — no count, no dates — so it cannot measure supply at all.
//
// Scope, deliberately narrow:
//  - Only tags the standing flags match (`matchSteering`), capped at CENSUS_MAX_TAGS, so a new
//    flag adds its market with no code change and the request count stays bounded.
//  - One page per tag. A broad tag fills 100 rows in days, so the page is marked `truncated` with
//    the days it covers, and read as a lower bound — never paged further (the cost would grow
//    with how broad the tag is).
//  - `total_count` is stored every run but not read yet: its day-to-day change is a supply
//    series that works for any tag, but it needs ~60 days of history and is noisy (players add
//    and remove tags). History can't be backfilled, so it is captured from day one.
import { matchSteering } from "../queries/shared.ts";
import { getBriefSteering } from "../queries/library.ts";
import type { Querier } from "../db/db.ts";
import { politeFetch, sleep } from "./base.ts";
import { parseSearchAppids } from "./steam.ts";

const STORE = "https://store.steampowered.com";
export const CENSUS_MAX_TAGS = 15;
export const CENSUS_PAGE_SIZE = 100;
/** The same trailing windows `tagSupplyTrend` uses, so both supply reads agree on "rising". */
export const CENSUS_WINDOW_DAYS = 30;

export interface StoreTag {
  tagid: number;
  name: string;
}

export interface CensusRow {
  released: string | null; // YYYY-MM-DD, null when the store shows no exact date
  priceCents: number | null; // null when the row carries no price (e.g. unpriced/unreleased)
}

export interface CensusPage {
  totalCount: number;
  rows: CensusRow[];
}

export interface CensusSummary {
  totalCount: number;
  parsed: number; // rows with an exact release date on or before the capture date
  recent: number; // released in the last CENSUS_WINDOW_DAYS
  prior: number; // released in the window before that
  coveredDays: number; // how far back the page reaches (capped at 2 windows)
  truncated: boolean; // the page ran out before covering both windows
  medianPriceCents: number | null;
  priceN: number;
}

export function censusUrl(tagid: number): string {
  return (
    `${STORE}/search/results/?tags=${tagid}&sort_by=Released_DESC&infinite=1` +
    `&start=0&count=${CENSUS_PAGE_SIZE}&category1=998&cc=us&l=english`
  );
}

/** `/tagdata/populartags/english` — ordered by popularity, which is the census tie-break. */
export function parseStoreTags(json: string): StoreTag[] {
  const raw = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("populartags: expected an array");
  return raw
    .filter((t) => Number.isFinite(Number(t?.tagid)) && typeof t?.name === "string")
    .map((t) => ({ tagid: Number(t.tagid), name: t.name.trim() }));
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Store release labels: "Sep 20, 2026" (l=english&cc=us) or "20 Sep, 2026" (other locales).
 *  Anything without a day — "Coming soon", "Q4 2026", "2026" — has no exact date and returns null. */
export function parseStoreDate(label: string): string | null {
  const s = label.replace(/\s+/g, " ").trim();
  let m = s.match(/^([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]*,? (\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

/** Parse one infinite-scroll search response. Throws on a shape change, so a store redesign
 *  fails the tag loudly instead of reading as "no releases". */
export function parseCensusPage(json: string): CensusPage {
  const body = JSON.parse(json);
  if (typeof body?.results_html !== "string" || !Number.isFinite(Number(body?.total_count))) {
    throw new Error("census: response lacks results_html/total_count");
  }
  const totalCount = Number(body.total_count);
  const rows = body.results_html
    .split(/class="search_result_row/)
    .slice(1)
    .map((chunk: string): CensusRow => {
      const date = chunk.match(/class="search_released[^"]*">([^<]*)</);
      const price = chunk.match(/data-price-final="(\d+)"/);
      return {
        released: date ? parseStoreDate(date[1]) : null,
        priceCents: price ? Number(price[1]) : null,
      };
    });
  if (totalCount > 0 && rows.length === 0) {
    throw new Error("census: total_count > 0 but no result rows parsed (markup changed?)");
  }
  return { totalCount, rows };
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

export function summarizeCensus(page: CensusPage, capturedOn: string): CensusSummary {
  const span = CENSUS_WINDOW_DAYS * 2;
  const ages = page.rows
    .map((r) => (r.released ? dayDiff(capturedOn, r.released) : null))
    .filter((a): a is number => a != null && a >= 0); // future-dated rows are not supply yet
  const recent = ages.filter((a) => a < CENSUS_WINDOW_DAYS).length;
  const prior = ages.filter((a) => a >= CENSUS_WINDOW_DAYS && a < span).length;
  // The page is the newest CENSUS_PAGE_SIZE titles. It only runs out early when it came back
  // full, more titles exist, and even its oldest dated row is still inside both windows.
  const oldest = ages.length ? Math.max(...ages) : 0;
  const truncated =
    page.rows.length >= CENSUS_PAGE_SIZE && page.totalCount > page.rows.length && oldest < span;
  const prices = page.rows
    .filter((r) => r.priceCents != null && r.released != null)
    .map((r) => r.priceCents as number)
    .sort((a, b) => a - b);
  const mid = prices.length >> 1;
  const median =
    prices.length === 0
      ? null
      : prices.length % 2
        ? prices[mid]
        : Math.round((prices[mid - 1] + prices[mid]) / 2);
  return {
    totalCount: page.totalCount,
    parsed: ages.length,
    recent,
    prior,
    coveredDays: truncated ? oldest : span,
    truncated,
    medianPriceCents: median,
    priceN: prices.length,
  };
}

/** Store tags the standing flags match, most popular first, capped. */
export function selectCensusTags(tags: StoreTag[], flags: string[], cap = CENSUS_MAX_TAGS) {
  if (!flags.length) return [];
  return tags.filter((t) => matchSteering(flags, { genre: "", tag: t.name }).length).slice(0, cap);
}

export interface CensusRunResult {
  tags: number;
  stored: number;
  failed: string[];
}

export async function runCensus(
  db: Querier,
  log: (m: string) => void = console.log,
  fetchText: (url: string) => Promise<string> = (u) => politeFetch(u, 12000),
  capturedOn = new Date().toISOString().slice(0, 10),
  delayMs = 2000,
): Promise<CensusRunResult> {
  const { flags } = await getBriefSteering(db);
  const all = parseStoreTags(await fetchText(`${STORE}/tagdata/populartags/english`));
  const targets = selectCensusTags(all, flags);
  log(`[census] ${flags.length} standing flag(s) → ${targets.length} tag(s)`);
  const res: CensusRunResult = { tags: targets.length, stored: 0, failed: [] };
  for (const t of targets) {
    await sleep(delayMs);
    try {
      const s = summarizeCensus(parseCensusPage(await fetchText(censusUrl(t.tagid))), capturedOn);
      // Append-only, one row per tag per day: a re-run the same day keeps the first capture.
      await db.query(
        `INSERT INTO tag_census (tag_id, tag_name, captured_on, total_count, recent, prior,
                                 covered_days, truncated, median_price_cents, price_n, parsed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tag_id, captured_on) DO NOTHING`,
        [
          t.tagid,
          t.name,
          capturedOn,
          s.totalCount,
          s.recent,
          s.prior,
          s.coveredDays,
          s.truncated,
          s.medianPriceCents,
          s.priceN,
          s.parsed,
        ],
      );
      res.stored++;
      log(
        `  ${t.name}: ${s.recent} recent / ${s.prior} prior` +
          `${s.truncated ? ` (page covers ${s.coveredDays}d)` : ""} · total ${s.totalCount}`,
      );
    } catch (e) {
      res.failed.push(t.name);
      log(`  ${t.name}: FAILED ${String(e)}`);
    }
  }
  return res;
}

// ── Tag-seeded discovery (#265) ──────────────────────────────────────────────────────────────
// The census counts a steered tag's releases but never feeds titles back into the crawl, so a
// mid-band deckbuilder with a few hundred reviews never enters `games` and the tag lens reads
// only the genre's megahits. One more store-search page per steered tag, sorted by reviews,
// hands the Steam crawl that tag's top appids. The census page itself is Released_DESC (newest
// shovelware first), so it cannot be reused — this is a separate request on the same host.

/** Appids taken from each steered tag's reviews-sorted page (STEAM_TAG_SEED_N overrides). */
export const TAG_SEED_N_DEFAULT = 25;

export function tagSeedUrl(tagid: number, n = TAG_SEED_N_DEFAULT): string {
  return (
    `${STORE}/search/results/?tags=${tagid}&sort_by=Reviews_DESC&infinite=1` +
    `&start=0&count=${n}&category1=998&cc=us&l=english`
  );
}

/** Top appids from one reviews-sorted search response. Throws on a shape change (as the census). */
export function parseTagSeedPage(json: string, n = TAG_SEED_N_DEFAULT): number[] {
  const body = JSON.parse(json);
  if (typeof body?.results_html !== "string") throw new Error("tag seed: no results_html");
  return parseSearchAppids(body.results_html).slice(0, n);
}

// The reviews-sorted page is still the genre's top end, so after a few crawls it is mostly titles
// already in `games`, and the US$10–20 band (the one the price-tier split needs) stays thin. A
// second page per steered tag asks the store for its reviews-sorted titles under US$20 and keeps
// those whose LIST price sits in the band. `maxprice` filters on the sale price, so a discounted
// US$24.99 title can appear; the list-price check drops it.

/** The mid-band list-price window, inclusive, in US cents. */
export const TAG_BAND_MIN_CENTS = 1000;
export const TAG_BAND_MAX_CENTS = 2000;
/** Rows read from the price-capped page; about half sit under US$10, so read twice the depth. */
export const TAG_BAND_PAGE_SIZE = 50;

export function tagBandUrl(tagid: number, count = TAG_BAND_PAGE_SIZE): string {
  return (
    `${STORE}/search/results/?tags=${tagid}&sort_by=Reviews_DESC&maxprice=${TAG_BAND_MAX_CENTS / 100}` +
    `&infinite=1&start=0&count=${count}&category1=998&cc=us&l=english`
  );
}

/** Appids of a price-capped search page whose list price is in the band, in page order. A row's
 *  list price is its struck-through original when discounted, else its final price. */
export function parseTagBandPage(json: string, n = TAG_SEED_N_DEFAULT): number[] {
  const body = JSON.parse(json);
  if (typeof body?.results_html !== "string") throw new Error("tag band: no results_html");
  const ids: number[] = [];
  for (const chunk of body.results_html.split('data-ds-appid="').slice(1)) {
    const id = Number(chunk.match(/^(\d+)/)?.[1]);
    const orig = chunk.match(/class="discount_original_price">\$([\d,]+(?:\.\d{2})?)</);
    const final = chunk.match(/data-price-final="(\d+)"/);
    const list = orig
      ? Math.round(Number(orig[1].replace(/,/g, "")) * 100)
      : final
        ? Number(final[1])
        : null;
    if (!(id > 0) || list == null || ids.includes(id)) continue;
    if (list >= TAG_BAND_MIN_CENTS && list <= TAG_BAND_MAX_CENTS) ids.push(id);
  }
  return ids.slice(0, n);
}

/** Alternate two seed lists (deduped) so neither the top end nor the band starves the other. */
export function interleaveSeeds(a: number[], b: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const id of [a[i], b[i]]) if (id != null && !out.includes(id)) out.push(id);
  }
  return out;
}

// Reviews-sorted pages cannot surface a title with no reviews, and the popular-upcoming shelf only
// lists titles that already have buzz, so a solo developer's coming-soon page never entered the
// crawl (#292). A third page per steered tag lists its coming-soon titles by release date. The
// sort is ascending on purpose: captured 2026-11-09, Released_DESC led with placeholder dates
// (2048, "2028", "Q2 2028") while Released_ASC led with titles launching that week.

/** Appids read from each steered tag's coming-soon page (STEAM_TAG_UPCOMING_N overrides). */
export const TAG_UPCOMING_N_DEFAULT = 50;

export function tagUpcomingUrl(tagid: number, n = TAG_UPCOMING_N_DEFAULT): string {
  return (
    `${STORE}/search/results/?tags=${tagid}&filter=comingsoon&sort_by=Released_ASC&infinite=1` +
    `&start=0&count=${n}&category1=998&cc=us&l=english`
  );
}

export interface TagSeed {
  tag: string;
  appids: number[];
  /** Coming-soon appids, nearest launch first; drawn from their own reserved slots (#292). */
  upcoming?: number[];
}

/** Fail-soft by contract: any failure — steering, the tag list, one tag's page — logs and the
 *  crawl carries on with whatever it has. Seeding widens the peer set; it must never cost a day. */
export async function fetchTagSeeds(
  db: Querier,
  log: (m: string) => void = console.log,
  fetchText: (url: string) => Promise<string> = (u) => politeFetch(u, 12000),
  n = TAG_SEED_N_DEFAULT,
  delayMs = 2000,
  upcomingN = TAG_UPCOMING_N_DEFAULT,
): Promise<TagSeed[]> {
  const out: TagSeed[] = [];
  if (n <= 0 && upcomingN <= 0) return out;
  let targets: StoreTag[];
  try {
    const { flags } = await getBriefSteering(db);
    if (!flags.length) return out;
    targets = selectCensusTags(
      parseStoreTags(await fetchText(`${STORE}/tagdata/populartags/english`)),
      flags,
    );
  } catch (e) {
    log(`[steam] tag seeding skipped: ${String(e)}\n`);
    return out;
  }
  for (const t of targets) {
    let top: number[] = [];
    let band: number[] = [];
    let upcoming: number[] = [];
    if (n > 0) {
      await sleep(delayMs);
      try {
        top = parseTagSeedPage(await fetchText(tagSeedUrl(t.tagid, n)), n);
      } catch (e) {
        log(`[steam] tag seed ${t.name}: FAILED ${String(e)}\n`);
      }
      await sleep(delayMs);
      try {
        band = parseTagBandPage(await fetchText(tagBandUrl(t.tagid)), n);
      } catch (e) {
        log(`[steam] tag band ${t.name}: FAILED ${String(e)}\n`);
      }
    }
    if (upcomingN > 0) {
      await sleep(delayMs);
      try {
        upcoming = parseTagSeedPage(await fetchText(tagUpcomingUrl(t.tagid, upcomingN)), upcomingN);
      } catch (e) {
        log(`[steam] tag upcoming ${t.name}: FAILED ${String(e)}\n`);
      }
    }
    if (top.length || band.length || upcoming.length) {
      out.push({ tag: t.name, appids: interleaveSeeds(top, band), upcoming });
    }
  }
  return out;
}
