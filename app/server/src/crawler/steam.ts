// Steam (PC) adapter. Unlike the browser portals (HTML __NEXT_DATA__ / INITIAL_STATE),
// Steam data comes from three free, key-less JSON endpoints, joined per appid:
//   1. store appdetails   → price, release, genres, developer/publisher, metacritic
//   2. appreviews summary → review %positive (→ rating), total_reviews (→ votes)
//   3. SteamSpy appdetails→ owners (→ plays), ccu, playtime, weighted tags
// The pure transforms below are unit-tested; the network layer is a thin orchestrator.
import { type RawGame, politeFetch, sleep } from "./base.ts";

const STORE = "https://store.steampowered.com";
const STEAMSPY = "https://steamspy.com/api.php";
const COMMUNITY = "https://steamcommunity.com";

// ── pure transforms ─────────────────────────────────────────────────────────

/** SteamSpy owners is a bucket string like "5,000,000 .. 10,000,000". Return its midpoint. */
export function parseOwners(s: string | null | undefined): number | null {
  if (!s || typeof s !== "string") return null;
  const nums = (s.match(/[\d,]+/g) || [])
    .map((n) => Number(n.replace(/,/g, "")))
    .filter((n) => !Number.isNaN(n));
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  return Math.round((nums[0] + nums[1]) / 2);
}

/** Steam exposes %positive over a large n. Map the positive ratio onto the shared 0–5 scale. */
export function normalizeSteamRating(positive: number, total: number): number | null {
  if (!total || total <= 0) return null;
  return +((positive / total) * 5).toFixed(2);
}

/** Publisher empty, or every publisher is also a developer ⇒ self-published (a solo/indie signal). */
export function isSelfPublished(developers: string[] = [], publishers: string[] = []): boolean {
  const pubs = publishers.map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (!pubs.length) return true;
  const devs = new Set(developers.map((d) => d.trim().toLowerCase()).filter(Boolean));
  return pubs.every((p) => devs.has(p));
}

export type ScaleTier = "hobby" | "small_indie" | "est_indie" | "aaa";
const TIERS: ScaleTier[] = ["hobby", "small_indie", "est_indie", "aaa"];

// Mega-publishers and their first-party/wholly-owned studio labels. A title backed by any of
// these is AAA regardless of Steam review/owner counts — a console port (e.g. a Sony first-party
// game) can have modest Steam numbers yet is not a realistic indie comparable. Match is a
// normalized substring; deliberately EXCLUDES indie-friendly publishers (Devolver, Annapurna,
// Raw Fury, Team17, Coffee Stain, tinyBuild…) whose games ARE valid indie comps. Tune as needed.
const MAJOR_BACKERS = [
  "valve",
  "playstation",
  "sony interactive",
  "naughty dog",
  "sucker punch",
  "guerrilla",
  "insomniac",
  "santa monica studio",
  "polyphony",
  "bungie",
  "bend studio",
  "xbox game studios",
  "microsoft",
  "bethesda",
  "zenimax",
  "mojang",
  "343 industries",
  "the coalition",
  "id software",
  "arkane",
  "machinegames",
  "nintendo",
  "electronic arts",
  "ea sports",
  "ea dice",
  "bioware",
  "respawn",
  "ubisoft",
  "activision",
  "blizzard",
  "take-two",
  "take two",
  "rockstar games",
  "2k games",
  "square enix",
  "bandai namco",
  "capcom",
  "sega",
  "atlus",
  "warner bros",
  "wb games",
  "epic games",
  "tencent",
  "netease",
  "krafton",
  "nexon",
  "konami",
  "hoyoverse",
  "mihoyo",
  "cognosphere",
  "cd projekt",
];
/** True if any developer or publisher is a known mega-publisher / first-party label. */
export function isMajorBacked(developers: string[] = [], publishers: string[] = []): boolean {
  const names = [...developers, ...publishers].map((n) => n.toLowerCase());
  return names.some((n) => MAJOR_BACKERS.some((m) => n.includes(m)));
}

/**
 * Infer a market-scale tier. KEY PRINCIPLE: "AAA" means major-publisher BACKING, not units sold.
 * A self-published breakout (Terraria, Stardew, Hades, Balatro) is the ultimate INDIE success,
 * not AAA — so scale alone never promotes a non-major-backed title past est_indie. This is what
 * keeps the recognizable indie hits in the Comparables set instead of being filtered out as AAA.
 */
export function classifyScaleTier(x: {
  reviews: number;
  owners: number | null;
  selfPublished: boolean;
  majorBacked?: boolean;
}): ScaleTier {
  // Backing — not scale — defines AAA.
  if (x.majorBacked) return "aaa";
  const r = x.reviews || 0;
  const o = x.owners || 0;
  const byReviews = r > 150_000 ? 3 : r >= 20_000 ? 2 : r >= 2_000 ? 1 : 0;
  const byOwners = o > 5_000_000 ? 3 : o >= 500_000 ? 2 : o >= 50_000 ? 1 : 0;
  let t = Math.max(byReviews, byOwners);
  // A non-major-backed hit, however large, is an ESTABLISHED INDIE — never AAA by scale alone.
  if (t >= 3) t = 2;
  // a title with a distinct publisher has backing → at least small_indie
  if (!x.selfPublished && t < 1) t = 1;
  return TIERS[t];
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};
/** Steam release_date.date — handles both "17 Sep, 2020" (intl) and "Mar 25, 2025" (en-US). */
export function parseReleaseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  // Day-first: "17 Sep, 2020"
  const dayFirst = s.match(/(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*,?\s+(\d{4})/);
  if (dayFirst) {
    const mm = MONTHS[dayFirst[2].toLowerCase()];
    if (mm) return `${dayFirst[3]}-${mm}-${String(dayFirst[1]).padStart(2, "0")}`;
  }
  // Month-first: "Mar 25, 2025"
  const monFirst = s.match(/([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (monFirst) {
    const mm = MONTHS[monFirst[1].toLowerCase()];
    if (mm) return `${monFirst[3]}-${mm}-${String(monFirst[2]).padStart(2, "0")}`;
  }
  return null;
}

// ── AI-content disclosure (#110) ───────────────────────────────────────────
// The "AI Generated Content Disclosure" block is server-rendered raw HTML on the STORE PAGE
// (not in any of the 3 JSON endpoints the crawler joins), so it's parsed + fetched separately.
// Two verified landmines: (1) the block's <div id="game_area_content_descriptors"> id is REUSED
// on the sibling "Mature Content Description" block, so we anchor on the <h2> heading text and
// stop at the block's closing </div> — never select by id, or the mature-content note bleeds in;
// (2) the note is the <i>…</i> inside the block, whitespace-collapsed.

/**
 * Parse the AI-disclosure block out of a Steam store page's HTML. Pure + unit-tested.
 * Absent heading → { aiDisclosure:false, aiDisclosureNote:null }. Present but no <i> note →
 * { true, null }. Anchors on the heading text and stops at the enclosing block's </div> so the
 * duplicate-id "Mature Content Description" sibling can never contaminate the note.
 */
export function parseAiDisclosure(html: string): {
  aiDisclosure: boolean;
  aiDisclosureNote: string | null;
} {
  const h = html ?? "";
  const heading = /<h2>\s*AI Generated Content Disclosure\s*<\/h2>/i.exec(h);
  if (!heading) return { aiDisclosure: false, aiDisclosureNote: null };
  // Scope to the block: from the heading up to the FIRST closing </div>, so a following block
  // (e.g. the mature-content sibling that shares the id) is out of range.
  const after = h.slice(heading.index + heading[0].length);
  const block = after.slice(0, after.search(/<\/div>/i));
  const note = /<i>([\s\S]*?)<\/i>/i.exec(block);
  if (!note) return { aiDisclosure: true, aiDisclosureNote: null };
  const text = note[1]
    .replace(/<[^>]*>/g, "") // strip any nested tags
    .replace(/\s+/g, " ")
    .trim();
  return { aiDisclosure: true, aiDisclosureNote: text || null };
}

// Gate: bound the 4th (store-page) fetch to the RECENT NON-AAA cohort — the cohort where the
// crawl budget can afford an extra request and where AI-disclosure demand-contamination actually
// matters. AAA titles are excluded from every indie benchmark anyway; old titles predate the
// disclosure requirement, so checking them is pure fetch waste.
export const STEAM_AI_DISCLOSURE_MAX_AGE_DAYS = Number(process.env.STEAM_AI_MAX_AGE_DAYS) || 120;

/** True iff `g` is a non-AAA title released within `maxAgeDays` of `nowMs` (not future by >1 day). */
export function wantsAiDisclosure(
  g: RawGame,
  nowMs: number,
  maxAgeDays = STEAM_AI_DISCLOSURE_MAX_AGE_DAYS,
): boolean {
  if (g.scaleTier === "aaa") return false;
  if (!g.releaseDate) return false;
  const rel = new Date(`${g.releaseDate}T00:00:00Z`).getTime();
  if (Number.isNaN(rel)) return false;
  const ageDays = (nowMs - rel) / 86400000;
  if (ageDays > maxAgeDays) return false; // too old
  if (ageDays < -1) return false; // future-dated by more than a day
  return true;
}

// ── Follower counts (#54) ───────────────────────────────────────────────────
// Followers are the closest public proxy to wishlists, and they are NOT in any endpoint we
// already fetch (not in appdetails, not in the store-page HTML #110 downloads, and the
// community hub is a JS-rendered React app). They ARE in the app's community-group member
// list: following a game on Steam = joining its app group, so the group's member count IS
// the follower count. `&p=99999` clamps to the last page and omits the member rows —
// ~42 KB becomes ~1.1 KB of server-rendered XML with named elements (steadier than a scrape).
//
// HONEST CAVEAT: following is a PRE-PURCHASE action. For recent small indies followers run
// ~10x reviews, but Balatro sits at 0.71x — once a game converts its audience the counter
// stops tracking demand. Read it as a leading indicator pre-release/early-life and a lagging
// vanity number afterwards.

/**
 * Follower count from a `memberslistxml` response. Pure + unit-tested. Returns null — never 0 —
 * for anything that isn't a real group document.
 *
 * Two landmines this exists to survive:
 *  1. There are TWO <memberCount> elements. The one inside <groupDetails> is the follower
 *     number that matches third-party trackers; the top-level one is 2–9% higher (it counts
 *     limited/banned accounts). Scope to <groupDetails> or the number is quietly wrong.
 *  2. Apps with no community group (DLC, bogus appids, Spacewar 480) return a ~23 KB HTML
 *     "Steam Community :: Error" page at HTTP 200 — the status code cannot be trusted, so
 *     require the XML envelope. Absence maps to null ("unknown"), never 0.
 */
export function parseFollowerCount(xml: string | null | undefined): number | null {
  const s = xml ?? "";
  if (!/<memberList>/i.test(s)) return null; // HTML error page served at 200
  const details = /<groupDetails>([\s\S]*?)<\/groupDetails>/i.exec(s);
  if (!details) return null;
  const m = /<memberCount>(\d+)<\/memberCount>/i.exec(details[1]);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch one app's follower count. Returns null on ANY failure — "unknown", never a
 * crawl-breaking throw. Different host from the store endpoints, so it adds zero pressure to
 * the throttle-prone store.steampowered.com; ~1.1 KB and a sub-second median, which the
 * existing 1.5s per-game sleep largely absorbs.
 */
export async function fetchFollowers(appid: number): Promise<number | null> {
  try {
    return parseFollowerCount(
      await politeFetch(`${COMMUNITY}/games/${appid}/memberslistxml/?xml=1&p=99999`, 6000),
    );
  } catch (e) {
    console.warn(`  followers ${appid} failed:`, String(e));
    return null;
  }
}

/**
 * Fetch + parse the AI-disclosure block for one appid from its store page. Returns null on ANY
 * failure (age-gate, network, timeout) — "unknown", never a crawl-breaking throw. The birthtime
 * cookie clears Steam's age-gate so mature titles return the real store HTML (200).
 */
export async function fetchAiDisclosure(
  appid: number,
): Promise<{ aiDisclosure: boolean; aiDisclosureNote: string | null } | null> {
  try {
    const html = await politeFetch(`${STORE}/app/${appid}/?cc=us&l=english`, 8000, {
      Cookie:
        "birthtime=0; wants_mature_content=1; lastagecheckage=1-January-1970; Steam_Language=english",
    });
    return parseAiDisclosure(html);
  } catch (e) {
    console.warn(`  ai-disclosure ${appid} failed:`, String(e));
    return null;
  }
}

/** Top-N SteamSpy tags by weight (the rich genre-like signal). */
function topTags(tags: Record<string, number> | undefined, n = 10): string[] {
  if (!tags || typeof tags !== "object") return [];
  return Object.entries(tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
}

/** Join the three endpoints' payloads for one appid into a normalized RawGame. */
export function parseSteamGame(
  appid: number | string,
  appData: any,
  reviewSummary: any,
  steamspy: any,
): RawGame {
  const developers: string[] = Array.isArray(appData?.developers) ? appData.developers : [];
  const publishers: string[] = Array.isArray(appData?.publishers) ? appData.publishers : [];
  const owners = parseOwners(steamspy?.owners);
  const totalReviews = Number(reviewSummary?.total_reviews ?? 0);
  const positive = Number(reviewSummary?.total_positive ?? 0);
  const selfPublished = isSelfPublished(developers, publishers);
  const majorBacked = isMajorBacked(developers, publishers);
  const price = appData?.price_overview;
  const tags = topTags(steamspy?.tags);

  return {
    sourceGameId: String(appid),
    url: `${STORE}/app/${appid}`,
    title: appData?.name ?? steamspy?.name ?? `app ${appid}`,
    thumbnailUrl: appData?.header_image ?? null,
    developer: developers[0] ?? steamspy?.developer ?? null,
    description: appData?.short_description ?? null,
    engine: null,
    orientation: null,
    mobile: false,
    genre: appData?.genres?.[0]?.description ?? null,
    tags,
    rating: normalizeSteamRating(positive, totalReviews),
    votes: totalReviews || null,
    featured: false,
    releaseDate: parseReleaseDate(appData?.release_date?.date),
    plays: owners,
    ownersEst: owners,
    priceCents: appData?.is_free ? 0 : (price?.final ?? null),
    discountPct: price?.discount_percent ?? null,
    ccu: steamspy?.ccu != null ? Number(steamspy.ccu) : null,
    medianPlaytimeMin: steamspy?.median_forever != null ? Number(steamspy.median_forever) : null,
    metacritic: appData?.metacritic?.score ?? null,
    scaleTier: classifyScaleTier({ reviews: totalReviews, owners, selfPublished, majorBacked }),
  };
}

// ── network orchestration (not unit-tested; used by run.ts) ───────────────────

const SEED_LIMIT_DEFAULT = 60;

// Canonical indie benchmarks — always seeded FIRST so the Comparables peer set contains the
// recognizable modern hits regardless of SteamSpy ranking drift (appids probe-verified).
// Curated; extend freely. AAA-adjacent smashes (PUBG etc.) are excluded here — they surface
// via the ranked stream and get tier-filtered by classifyScaleTier anyway.
export const INDIE_CANON: number[] = [
  2379780, // Balatro
  1145360, // Hades
  1145350, // Hades II
  646570, // Slay the Spire
  1794680, // Vampire Survivors
  367520, // Hollow Knight
  413150, // Stardew Valley
  105600, // Terraria
];

/** Parse appids from a Steam store-search `results_html` fragment (data-ds-appid attributes). */
export function parseSearchAppids(html: string): number[] {
  const ids: number[] = [];
  const re = /data-ds-appid="(\d+)"/g;
  let m = re.exec(html ?? "");
  while (m !== null) {
    const id = Number(m[1]);
    if (Number.isFinite(id) && id > 0 && !ids.includes(id)) ids.push(id);
    m = re.exec(html ?? "");
  }
  return ids;
}

/**
 * Rank a SteamSpy tag response (an object keyed by appid) by estimated owners, descending.
 * Critical: do NOT use Object.keys() — integer-like keys enumerate in ASCENDING NUMERIC order,
 * which returns the oldest appids (obscure ancient games) and discards SteamSpy's owners ranking.
 */
export function rankTagByOwners(tagJson: Record<string, any>): number[] {
  return Object.values(tagJson ?? {})
    .map((g: any) => ({ appid: Number(g?.appid), owners: parseOwners(g?.owners) ?? 0 }))
    .filter((g) => Number.isFinite(g.appid) && g.appid > 0)
    .sort((a, b) => b.owners - a.owners)
    .map((g) => g.appid);
}

/**
 * Round-robin merge of several seed lists into one deduped, limited list.
 * Round-robin (not concat-then-slice) is deliberate: the trending/top-seller lists
 * are AAA-heavy, so a plain concat lets them crowd out the indie stream at small
 * limits. Interleaving guarantees every source — especially indie — is represented.
 */
export function mergeSeeds(lists: number[][], limit: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max && out.length < limit; i++) {
    for (const list of lists) {
      if (out.length >= limit) break;
      const id = list[i];
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Build a deduped appid seed list. Indie stream is listed first so it is well represented. */
export async function seedAppIds(limit = SEED_LIMIT_DEFAULT): Promise<number[]> {
  const fetchIds = async (label: string, fn: () => Promise<number[]>): Promise<number[]> => {
    try {
      return (await fn()).filter((n) => Number.isFinite(n) && n > 0);
    } catch (e) {
      console.warn(`seed ${label} failed:`, String(e));
      return [];
    }
  };
  // (0) Recent + high-traction indies — Steam's TOP-SELLING Indie-tagged titles (tags=492).
  // This is the primary recency lever: top sellers skew to what's selling NOW, and the 2-year
  // Comparables window then keeps only the recent ones (filters out evergreen classics like
  // Terraria/Stardew that also chart). Released_DESC was rejected — it's near-zero-owner shovelware.
  const recent = await fetchIds("search topsellers Indie", async () => {
    const url =
      `${STORE}/search/results/?query&start=0&count=100&filter=topsellers` +
      `&tags=492&category1=998&supportedlang=english&infinite=1&json=1&cc=us&l=english`;
    const j = JSON.parse(await politeFetch(url));
    return parseSearchAppids(j?.results_html ?? "");
  });
  // (1) Indie breadth — SteamSpy Indie tag ranked by owners (all-time; broadens the mid-tier).
  // NOTE: SteamSpy tags are case-sensitive — "Indie" returns {} (empty); "indie" is the real tag.
  // Rank by owners (rankTagByOwners), NOT Object.keys, so we seed the top indie hits not the oldest.
  const indie = await fetchIds("tag=indie", async () => {
    const j = JSON.parse(await politeFetch(`${STEAMSPY}?request=tag&tag=indie`));
    return rankTagByOwners(j);
  });
  // (2) SteamSpy trending — broad demand context, CCU-weighted (AAA-heavy)
  const trending = await fetchIds("top100in2weeks", async () => {
    const j = JSON.parse(await politeFetch(`${STEAMSPY}?request=top100in2weeks`));
    return Object.keys(j).map(Number);
  });
  // (3) Storefront promotion shelves — top sellers + new releases (a Steam promotion signal)
  const featured = await fetchIds("featuredcategories", async () => {
    const fc = JSON.parse(await politeFetch(`${STORE}/api/featuredcategories/`));
    const ids: number[] = [];
    for (const shelf of ["new_releases", "top_sellers", "specials"]) {
      for (const it of fc?.[shelf]?.items ?? []) if (it?.id) ids.push(Number(it.id));
    }
    return ids;
  });
  // Canon first (recognizable benchmarks always present) → recent top-sellers (the recency
  // focus) → trending/featured for demand context → owners-ranked indie breadth last.
  return mergeSeeds([INDIE_CANON, recent, trending, featured, indie], limit);
}

/** Store appdetails URL. l=english fixes locale leakage (genres came back as e.g. "Ação");
 *  cc=us pins USD pricing so price_cents is consistent regardless of where the crawl runs. */
export function appDetailsUrl(appid: number | string): string {
  return `${STORE}/api/appdetails?appids=${appid}&l=english&cc=us`;
}

/** Fetch + join the three endpoints for one appid. Returns null if the app isn't a usable game. */
export async function fetchSteamGame(appid: number): Promise<RawGame | null> {
  const adWrap = JSON.parse(await politeFetch(appDetailsUrl(appid)));
  const entry = adWrap?.[appid];
  if (!entry?.success || entry.data?.type !== "game") return null;
  const reviews = JSON.parse(
    await politeFetch(
      `${STORE}/appreviews/${appid}?json=1&language=all&filter=summary&num_per_page=0`,
    ),
  );
  let steamspy: any = {};
  try {
    // SteamSpy is the most rate-limit-prone of the three endpoints and its data is enrichment,
    // not load-bearing — give it a tighter per-endpoint timeout so a hang here fails soft fast
    // and we continue with whatever the store/reviews endpoints already returned (#31).
    steamspy = JSON.parse(await politeFetch(`${STEAMSPY}?request=appdetails&appid=${appid}`, 6000));
  } catch (e) {
    console.warn(`  steamspy ${appid} failed:`, String(e));
  }
  const g = parseSteamGame(appid, entry.data, reviews?.query_summary ?? {}, steamspy);
  // 4th fetch (#110), gated to the recent non-AAA cohort so the crawl budget isn't blown on the
  // whole seed. Tri-state: true=discloses, false=checked & absent, null=fetch failed. Outside the
  // cohort we leave both null — "not checked" is honestly distinct from "checked & absent".
  if (wantsAiDisclosure(g, Date.now())) {
    const d = await fetchAiDisclosure(appid);
    g.aiDisclosure = d ? d.aiDisclosure : null;
    g.aiDisclosureNote = d?.aiDisclosureNote ?? null;
  }
  // 5th fetch (#54), gated on tier ONLY — deliberately NOT riding the AI-disclosure cohort.
  // Different host, ~1/170th the bytes, and followers matter for the whole non-AAA set, not
  // just the <=120-day slice; AAA stays excluded because it's out of every indie benchmark.
  if (g.scaleTier !== "aaa") g.followers = await fetchFollowers(appid);
  return g;
}

export const STEAM_BASE_URL = STORE;

/** Full orchestrator: seed appids → fetch+join each → return RawGames for the loader. */
export async function steamCrawl(
  limit = SEED_LIMIT_DEFAULT,
  log: (m: string) => void = () => {},
): Promise<{ games: RawGame[]; baseUrl: string }> {
  log(`[steam] seeding appids (limit ${limit})…\n`);
  const ids = await seedAppIds(limit);
  log(`[steam] ${ids.length} appids\n`);
  const games: RawGame[] = [];
  for (const id of ids) {
    try {
      const g = await fetchSteamGame(id);
      if (g) {
        games.push(g);
        log(".");
      } else log("x");
    } catch (e) {
      log("!");
      console.warn(`\n  skip app ${id}: ${String(e)}`);
    }
    await sleep(1500); // polite ~1 req-group / 1.5s
  }
  log(`\n[steam] parsed ${games.length}/${ids.length}\n`);
  return { games, baseUrl: STORE };
}
