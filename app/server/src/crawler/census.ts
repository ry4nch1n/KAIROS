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
