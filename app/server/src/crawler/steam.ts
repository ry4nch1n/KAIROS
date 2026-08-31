// Steam (PC) adapter. Unlike the browser portals (HTML __NEXT_DATA__ / INITIAL_STATE),
// Steam data comes from three free, key-less JSON endpoints, joined per appid:
//   1. store appdetails   → price, release, genres, developer/publisher, metacritic
//   2. appreviews summary → review %positive (→ rating), total_reviews (→ votes)
//   3. SteamSpy appdetails→ owners (→ plays), ccu, playtime, weighted tags
// The pure transforms below are unit-tested; the network layer is a thin orchestrator.
import { type RawGame, STORE_FEATURES, politeFetch, sleep } from "./base.ts";

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
 * Which titles get the follower fetch. COMING-SOON ONLY (#54, narrowed 2026-08-11).
 *
 * The first cut fetched every coming-soon OR non-AAA title — ~113 requests/run — and from CI
 * every single one came back 429 (451 attempts across 4 crawls, 0 successes). Followers only
 * ever earned their keep on the unreleased cohort anyway: a coming-soon title has NO reviews
 * and NO owners, so followers are the only demand number it has, whereas on released titles
 * followers largely track the review count (see the cohort note above). Narrowing to
 * coming-soon cuts the request count by ~4-5x, which is the right side of the crawl budget and
 * of politeness toward a host that is currently saying no.
 */
export function wantsFollowers(g: RawGame): boolean {
  return g.comingSoon === true;
}

// Follower-fetch resilience (#54). Two mechanisms, both scoped to ONE crawl run:
//  · bounded backoff — steamcommunity.com throttles far harder than the store endpoints, so a
//    single failure gets a couple of retries on a much longer floor than the 1.5s per-game sleep.
//  · a circuit breaker — if the host is rejecting us wholesale (the observed 429-on-every-request
//    mode), retrying the whole cohort burns Actions wall-time for nothing and keeps hammering an
//    upstream that has already said no. After N consecutive failures we stop attempting for the
//    rest of the run and log ONE summary line instead of N stack traces.
export const FOLLOWER_MAX_CONSECUTIVE_FAILURES = 5;
export const FOLLOWER_RETRY_DELAYS_MS = [4000, 12000]; // floors well above the per-game 1.5s

interface FollowerRunState {
  attempts: number; // fetches we actually started (post-breaker)
  captured: number; // fetches that yielded a real number
  consecutiveFailures: number;
  tripped: boolean; // breaker open → skip for the remainder of the run
}
const followerRun: FollowerRunState = {
  attempts: 0,
  captured: 0,
  consecutiveFailures: 0,
  tripped: false,
};

/** Reset the per-run follower breaker. Called at the top of every {@link steamCrawl}. */
export function resetFollowerRun(): void {
  followerRun.attempts = 0;
  followerRun.captured = 0;
  followerRun.consecutiveFailures = 0;
  followerRun.tripped = false;
}

/** Read-only snapshot of the current run's follower stats (for logging + tests). */
export function followerRunState(): Readonly<FollowerRunState> {
  return { ...followerRun };
}

/**
 * Fetch one app's follower count. Returns null on ANY failure — "unknown", never a
 * crawl-breaking throw. Different host from the store endpoints, so it adds zero pressure to
 * the throttle-prone store.steampowered.com; ~1.1 KB and a sub-second median.
 *
 * `fetchXml` / `delaysMs` are injection seams for tests only — production callers pass neither.
 * A 200 that simply has no community group (parse → null) is NOT a failure: the breaker exists
 * to detect the host refusing us, not apps without a group.
 */
export async function fetchFollowers(
  appid: number,
  fetchXml: (url: string) => Promise<string> = (u) => politeFetch(u, 6000),
  delaysMs: number[] = FOLLOWER_RETRY_DELAYS_MS,
): Promise<number | null> {
  if (followerRun.tripped) return null;
  followerRun.attempts++;
  const url = `${COMMUNITY}/games/${appid}/memberslistxml/?xml=1&p=99999`;
  for (let attempt = 0; ; attempt++) {
    try {
      const n = parseFollowerCount(await fetchXml(url));
      followerRun.consecutiveFailures = 0;
      if (n !== null) followerRun.captured++;
      return n;
    } catch (e) {
      const backoff = delaysMs[attempt];
      if (backoff === undefined) {
        console.warn(`  followers ${appid} failed:`, String(e));
        break;
      }
      await sleep(backoff);
    }
  }
  followerRun.consecutiveFailures++;
  if (
    followerRun.consecutiveFailures >= FOLLOWER_MAX_CONSECUTIVE_FAILURES &&
    !followerRun.tripped
  ) {
    followerRun.tripped = true;
    console.warn(
      `  [steam] follower capture DISABLED for the rest of this run — ` +
        `${followerRun.consecutiveFailures} consecutive failures after retries (#54: ` +
        `steamcommunity.com is rejecting this runner). ${followerRun.attempts} attempted, ` +
        `${followerRun.captured} captured.`,
    );
  }
  return null;
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

/**
 * True iff the store says this title has NOT shipped yet (#54 part 2).
 *
 * `release_date.coming_soon` is the ONLY trustworthy marker. The sibling `date` string is
 * unreliable in both directions: it is often a real, PARSEABLE future date ("Aug 6, 2026") —
 * which `parseReleaseDate` would happily turn into a release_date that then sorts ahead of
 * every shipped game in every `ORDER BY release_date DESC` — and just as often a date-less
 * placeholder ("Coming soon", "Q1 2026") that parses to null and is indistinguishable from a
 * date-parser regression. Read the flag, never the string.
 */
export function isComingSoon(appData: any): boolean {
  return appData?.release_date?.coming_soon === true;
}

// ── store-page completeness (#178) ───────────────────────────────────────────
// Both inputs are already in hand: appdetails carries `supported_languages` + `categories`,
// SteamSpy carries a plain `languages` list. Nothing here fetches.

/**
 * Split a Steam/SteamSpy language listing into distinct language names.
 *
 * appdetails serves markup, not data: `"English<strong>*</strong>, French, …,
 * Japanese<br><strong>*</strong>languages with full audio support"`. The trailing footnote is
 * prose, not a language, so it is cut before the split — otherwise every fully-voiced title
 * inflates its own count by one. SteamSpy's `languages` is the same list without the markup,
 * so one parser serves both.
 */
export function parseSupportedLanguages(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  const text = raw
    .split(/<br\s*\/?>/i)[0] // the audio footnote lives after the line break
    .replace(/<[^>]*>/g, " ") // drop <strong>/<i> wrappers, keep the separators
    .replace(/\*?\s*languages with full audio support.*$/i, "") // footnote without a <br>
    .replace(/&amp;/g, "&");
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const name = part.replace(/\*/g, "").replace(/\s+/g, " ").trim();
    if (name) seen.add(name.toLowerCase());
  }
  return [...seen];
}

/** Simplified Chinese is the one locale with a documented step-change in indie reach. */
export function detectSimplifiedChinese(languages: string[]): boolean {
  return languages.some((l) => /simplified\s*chinese|chinese\s*\(\s*simplified\s*\)/i.test(l));
}

// appdetails category ids are stable machine keys; the `description` strings are localized and
// occasionally reworded, so match on the id and keep the text only as a fallback.
const FEATURE_CATEGORY_IDS: Record<string, number[]> = {
  achievements: [22],
  cloud: [23],
  controller: [28], // FULL controller support only — 18 (partial) is a weaker claim
  workshop: [30],
};
const FEATURE_PATTERNS: Record<string, RegExp> = {
  achievements: /steam achievements/i,
  cloud: /steam cloud/i,
  controller: /full controller support/i,
  workshop: /steam workshop/i,
};

/**
 * Extract the store-page features from appdetails `categories`.
 *
 * Returns null when the payload carries no categories array at all (not measured — a browser
 * source, or a partial/failed store fetch). Returns `[]` when categories ARE present and none
 * of the four match: that empty array is the actual bottom-band signal, so the two cases must
 * stay distinguishable.
 */
export function parseStoreFeatures(appData: any): string[] | null {
  const cats = appData?.categories;
  if (!Array.isArray(cats)) return null;
  const ids = new Set<number>();
  const descriptions: string[] = [];
  for (const c of cats) {
    const id = Number(c?.id);
    if (Number.isFinite(id)) ids.add(id);
    if (typeof c?.description === "string") descriptions.push(c.description);
  }
  return STORE_FEATURES.filter(
    (f) =>
      FEATURE_CATEGORY_IDS[f].some((id) => ids.has(id)) ||
      descriptions.some((d) => FEATURE_PATTERNS[f].test(d)),
  );
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
  const comingSoon = isComingSoon(appData);
  // Store-page completeness (#178). appdetails is authoritative; SteamSpy's plainer `languages`
  // is the fallback for the runs where the store payload came back partial. Neither is a new
  // request — both responses are already joined above.
  const languages = parseSupportedLanguages(
    appData?.supported_languages ?? steamspy?.languages ?? null,
  );
  const measuredLanguages = languages.length > 0;

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
    // An unreleased title HAS no release date — the store's future "date" is an announced
    // intention, not a fact, and faking it into release_date would put unshipped games at the
    // top of every recency ordering. Honest NULL; it fills in on the crawl after launch
    // (the loader COALESCEs a newly-present date over the null).
    releaseDate: comingSoon ? null : parseReleaseDate(appData?.release_date?.date),
    plays: owners,
    ownersEst: owners,
    priceCents: appData?.is_free ? 0 : (price?.final ?? null),
    discountPct: price?.discount_percent ?? null,
    ccu: steamspy?.ccu != null ? Number(steamspy.ccu) : null,
    medianPlaytimeMin: steamspy?.median_forever != null ? Number(steamspy.median_forever) : null,
    metacritic: appData?.metacritic?.score ?? null,
    // Scale is a MEASURED OUTCOME (reviews, owners). An unreleased title has neither, so
    // classifying it would report "hobby" for every unshipped game — a claim from absence.
    // null = not measured, which is also what keeps it out of the tier breakdown.
    scaleTier: comingSoon
      ? null
      : classifyScaleTier({ reviews: totalReviews, owners, selfPublished, majorBacked }),
    comingSoon,
    // A payload that listed no languages tells us nothing about localisation breadth — that is
    // null, not a count of 0. A listing with exactly one language IS a measured 1.
    languageCount: measuredLanguages ? languages.length : null,
    hasSimplifiedChinese: measuredLanguages ? detectSimplifiedChinese(languages) : null,
    storeFeatures: parseStoreFeatures(appData),
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
      const ids = (await fn()).filter((n) => Number.isFinite(n) && n > 0);
      // A seed that 200s but parses to nothing is the silent failure mode (#138): the crawl
      // stays "green" on a narrower seed and nobody notices for weeks. A layout/param change
      // must be as loud as a throw — same degradation (other seeds carry the run), but visible.
      if (!ids.length) console.warn(`seed ${label} yielded 0 appids — other seeds only`);
      return ids;
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
  // (4) UNRELEASED demand — Steam's own "Popular Upcoming" shelf, Indie-tagged (#54 part 2).
  // This is what makes follower counts new information rather than a restatement of reviews:
  // on released titles followers track reviews (~10x) and say little the review count doesn't,
  // but a coming-soon title has NO reviews and NO owners, so followers are the only demand
  // number it has. `popularcomingsoon` (not the plain `comingsoon` filter) is load-bearing —
  // unsorted coming-soon is ~6.5k shovelware; the popularity-ranked shelf returns titles with
  // real dynamic range (hundreds to tens of thousands of followers). Verified 200 + 100 appids.
  const upcoming = await fetchIds("search popularcomingsoon Indie", async () => {
    const url =
      `${STORE}/search/results/?query&start=0&count=100&filter=popularcomingsoon` +
      `&tags=492&category1=998&supportedlang=english&infinite=1&json=1&cc=us&l=english`;
    const j = JSON.parse(await politeFetch(url));
    return parseSearchAppids(j?.results_html ?? "");
  });
  // Canon first (recognizable benchmarks always present) → recent top-sellers (the recency
  // focus) → upcoming (the pre-release demand stream) → trending/featured for demand context
  // → owners-ranked indie breadth last. Round-robin, so upcoming takes ~1/6 of the SAME
  // CRAWL_LIMIT rather than raising it — the budget is politeness toward Steam, not minutes.
  return mergeSeeds([INDIE_CANON, recent, upcoming, trending, featured, indie], limit);
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
  // 5th fetch (#54), gated to the COMING-SOON cohort — see wantsFollowers. Outside it we leave
  // `followers` undefined, which the loader writes as NULL = "not measured" (never a measured 0).
  if (wantsFollowers(g)) g.followers = await fetchFollowers(appid);
  return g;
}

export const STEAM_BASE_URL = STORE;

/** Full orchestrator: seed appids → fetch+join each → return RawGames for the loader. */
export async function steamCrawl(
  limit = SEED_LIMIT_DEFAULT,
  log: (m: string) => void = () => {},
): Promise<{ games: RawGame[]; baseUrl: string }> {
  log(`[steam] seeding appids (limit ${limit})…\n`);
  resetFollowerRun(); // breaker is per-run, not per-process
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
  const f = followerRunState();
  log(
    `\n[steam] parsed ${games.length}/${ids.length}` +
      ` · followers ${f.captured}/${f.attempts}${f.tripped ? " (breaker OPEN — see #54)" : ""}\n`,
  );
  return { games, baseUrl: STORE };
}
