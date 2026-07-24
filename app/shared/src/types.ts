// Shared types across web + server. Single source of truth for API shapes.

// The data contract (versions, taxonomy enums, payload validators) lives in contract.ts
// and is re-exported here so `import { CONTRACT, ... } from "shared"` resolves (shared's
// main is this file).
export * from "./contract.ts";

export type Platform = "all" | "poki" | "crazygames" | "steam";

// ── Phase 2: Steam / PC analytics ──
export interface ScaleTierRow {
  tier: string;
  games: number;
}
export type SteamCohort = "indie" | "all";
// Wishlist→sale conversion signal (R4.1). Directional, cited — not a per-genre table Steam
// publishes. Attached to a genre when there's a clear signal; null otherwise (no claim).
export type ConversionSignal = "strong" | "typical" | "deliberation";
export interface ConversionRef {
  signal: ConversionSignal;
  note: string;
  source: string;
  asOf: string;
}

export interface SteamGenreEconomics {
  genre: string;
  games: number;
  medianPriceCents: number;
  medianRating: number | null; // null when the cohort has no rated games yet (honest, not 0)
  totalOwners: number;
  revenueProxy: number; // owners × price, in dollars (rough monetizability signal)
  // Per-game reads (#24): total conflates market size with opportunity — 248 games
  // splitting $8.5B is a worse solo-dev bet than 8 splitting $136M.
  medianRevenuePerGame: number; // dollars; the "typical outcome", resists mega-hit skew
  meanRevenuePerGame: number; // dollars; mean ≫ median = category is top-heavy
  conversion: ConversionRef | null; // wishlist→sale directional signal, or null
  // Cross-estimate band (#53). `medianRevenuePerGame` above rests on ONE estimator —
  // SteamSpy owners-bucket midpoint × price — and those buckets are wide. A second,
  // independent Boxleiter-style estimator (reviews × multiplier × price) gives a range
  // instead of false precision. Low/high are the two estimators sorted, per game (median).
  medianRevenueBoxleiter: number; // dollars; reviews × multiplier × price, median per game
  revenueBandLowPerGame: number; // dollars; min(owners-based, Boxleiter)
  revenueBandHighPerGame: number; // dollars; max(owners-based, Boxleiter)
  estimatorRatio: number; // high ÷ low (1 = agreement); 0 when the band can't be formed
  estimatorsDisagree: boolean; // true past the disagreement threshold — read the band, not a point
}

// Sub-genre lens: the same economics row, keyed on a SteamSpy tag instead of a store genre
// (`genre` carries the tag name). Tags overlap, so rows do NOT partition the catalog — each
// is "the market of games carrying this tag". Demand is median reviews, a continuous signal,
// not owners buckets.
export interface SteamTagEconomics extends SteamGenreEconomics {
  medianVotes: number; // median review count per game — the demand estimator for this tag
  // Momentum (#114) — the same two signals the store-genre quadrant exposes, at tag grain, so a
  // sub-genre reads "is this market opening or closing?" identically to a store genre.
  supplyTrend: SupplyTrend; // new-entrant flow (release_date): "rising" = crowding / door closing
  supplyRising: boolean; // convenience flag mirroring the store-genre annotations
  // Median-reviews momentum across snapshot windows. "new" = history too thin to read yet
  // (the honest state; demand trajectory deepens as game_snapshots accrues), never a fake trend.
  demandTrajectory: Trajectory;
}

// Named sub-genre lookup (#113). The ranked lens is a top-30 by TOTAL revenue, which generic
// tags win by construction, so a specific market had to become addressable by name. `rows`
// are matches that clear the supply floor; `thin` names matches that exist but are too small
// to read as a market — an explicit "2 titles, below the floor" beats an empty result, which
// is indistinguishable from a broken query.
export interface SteamTagLookup {
  query: string; // normalized terms actually searched (echoed back, may be "")
  minSupply: number; // the supply floor applied — same one the ranked lens uses
  rows: SteamTagEconomics[];
  thin: { tag: string; games: number }[];
}

// Curated, researched team-size estimate (see server data/teamSize.ts). solo=1–2, small=3–10,
// mid=11–30, large=30+. Always rendered as "est." with its source — never as fact.
export type TeamSizeBucket = "solo" | "small" | "mid" | "large";
export type TeamSizeConfidence = "high" | "medium" | "low";
export interface ComparableTeamSize {
  bucket: TeamSizeBucket;
  headcount: string; // e.g. "~25", "1 (solo)"
  source: string; // citation URL
  confidence: TeamSizeConfidence;
}

export interface SteamComparable {
  title: string;
  tier: string;
  genre: string;
  rating: number | null;
  votes: number | null;
  owners: number | null;
  priceCents: number | null;
  developer: string | null;
  releaseDate: string | null; // ISO YYYY-MM-DD (for the "Released" year column)
  teamSize: ComparableTeamSize | null; // curated estimate, or null when the studio isn't researched
  // Reviews gained per day over the trailing 30-day snapshot window — the public proxy for
  // wishlist velocity (wishlist counts aren't acquirable). null when the snapshot history
  // can't support a rate (<2 points in the window), never a misleading 0.
  reviewVelocity: number | null;
}

export interface SteamGap {
  label: string;
  genre: string;
  tag: string;
  supplyN: number; // # games (supply)
  medianOwners: number; // demand
  qualityCeil: number; // P90 rating
  medianPriceCents: number; // monetization
  score: number;
  examples: string[];
  supplyRising: boolean; // genre accreting recent releases fast (R1.3 annotation)
}
export interface SteamPriceBand {
  band: string; // "Free" | "<$5" | "$5–10" | "$10–20" | "$20+"
  games: number;
  medianRating: number | null;
  totalOwners: number;
  revenueProxy: number; // dollars
}
export interface SteamOwnershipRow {
  genre: string;
  games: number;
  totalOwners: number;
  medianOwners: number;
  ccu: number; // summed live concurrent players
  medianPlaytimeMin: number;
}
export interface SteamDeveloperRow {
  developer: string;
  games: number;
  totalOwners: number;
  avgRating: number;
  topGenre: string;
}
export interface SteamNewRelease {
  title: string;
  genre: string;
  tier: string;
  rating: number | null;
  owners: number | null;
  priceCents: number | null;
  releaseDate: string | null;
}

export interface SteamOverview {
  kpi: {
    games: number;
    indie: number;
    aaa: number;
    ratedPct: number;
    indieMedianPriceCents: number;
  };
  // "This week's read" — see Overview.read; Steam flavor (opportunity, per-game economics, top-heavy warning).
  read: string[];
  tiers: ScaleTierRow[];
  indie: SteamGenreEconomics[]; // indie-addressable cohort (default benchmark)
  all: SteamGenreEconomics[]; // all tiers incl. AAA (demand-context view)
  tagEconomics: SteamTagEconomics[]; // sub-genre lens — indie cohort, keyed on SteamSpy tags
  comparables: SteamComparable[];
  opportunity: SteamGap[];
  quadrant: QuadrantPoint[];
  pricing: SteamPriceBand[];
  ownership: SteamOwnershipRow[];
  developers: SteamDeveloperRow[];
  newReleases: SteamNewRelease[];
  subtitle: string;
}

export interface OverviewKPI {
  gamesTracked: number;
  newGames: number;
  avgRating: number;
  avgRatingP90: number;
  risingGenre: string;
  risingVotesPerDay: number;
  openGaps: number;
}

export interface MomentumSeries {
  genre: string;
  values: number[]; // one per date, aligned to `dates`
}
export interface GenreMomentum {
  dates: string[]; // e.g. ["06-15","06-22",...] — real MM-DD dates
  series: MomentumSeries[];
}

export interface TagFreq {
  tag: string;
  count: number;
}

export interface ScatterPoint {
  title: string;
  genre: string;
  votes: number;
  rating: number;
  gem: boolean;
}

export interface HiddenGem {
  gameId: number;
  title: string;
  rating: number;
  votes: number;
  genre: string;
}

export interface MarketGap {
  label: string;
  genre: string;
  tag: string;
  supplyN: number;
  appetite: number;
  qualityCeil: number;
  score: number;
  examples: string[];
  // Recency annotation (R1.3): true when the gap's genre is accreting new entrants fast.
  // The z-score `score` is unchanged — this flags "the door is closing" without silently
  // re-ranking, so a high-score gap that's also crowding fast reads honestly.
  supplyRising: boolean;
}

export interface HeatCell {
  week: number; // index into weeks
  genreIndex: number;
  value: number;
}
export interface FeatureHeatmap {
  weeks: string[];
  genres: string[];
  cells: HeatCell[];
}

export type InsightKind = "up" | "down" | "gap" | "gem";
export interface Insight {
  kind: InsightKind;
  tag: string; // e.g. "OPPORTUNITY"
  meta: string; // e.g. "demand p88 · supply p07"
  text: string; // may contain <b> emphasis
  // The decision clause: what this observation implies for the plan ("favors a browser
  // loop test", "crowding fast — avoid"). Plain text, rendered after an arrow. An insight
  // that ends at observation isn't a takeaway — every insight should carry one.
  implication?: string;
}

export interface GenreLandscapePoint {
  genre: string;
  supply: number;
  p75Rating: number;
  avgRating: number;
  totalVotes: number;
  examples: string[];
}

// One point per genre for the Demand vs. Supply quadrant (B3 / R1.2): the whitespace
// story in a single chart. x = supply (how many titles), y = appetite (demand), bubble =
// commercial weight, colour = supply momentum. Top-left (low supply, high appetite) is the
// underserved quadrant; a point there coloured "quiet" is the cleanest opening.
export interface QuadrantPoint {
  genre: string;
  supply: number; // # live titles (x)
  appetite: number; // demand — median votes (browser) / median owners (Steam) (y)
  weight: number; // bubble — total votes (browser) / revenue proxy $ (Steam)
  supplyTrend: SupplyTrend;
}

export interface GenreVelocityBar {
  genre: string;
  votesPerDay: number;
}

// One row per setting/theme present in the catalogue (#25). Setting is an axis orthogonal
// to genre — derived by mapping setting-bearing tags into a controlled vocabulary
// (contract.taxonomy.settings). The first slice of a genre × setting view: it surfaces
// which settings the catalogue actually covers, so a "genre looks open" call can be checked
// against whether the specific setting the plan cares about is crowded.
export interface SettingFacet {
  setting: string;
  count: number;
  examples: string[];
}
export interface GlossaryRow {
  label: string;
  kind: "genre" | "tag";
  count: number;
  examples: string[];
  definition: string;
}

export interface Overview {
  kpi: OverviewKPI;
  // "This week's read" — up to 3 computed, decision-framed sentences (may contain <b>):
  // top gap with its route framing, biggest mover, and a saturation warning. The answer
  // strip; the charts below are the evidence.
  read: string[];
  momentum: GenreMomentum;
  tags: TagFreq[];
  scatter: ScatterPoint[];
  heatmap: FeatureHeatmap;
  gaps: MarketGap[];
  insights: Insight[];
  landscape: GenreLandscapePoint[];
  quadrant: QuadrantPoint[];
  velocityBars: GenreVelocityBar[];
  glossary: GlossaryRow[];
  settings: SettingFacet[];
  platform: Platform;
  subtitle: string;
}

export interface BriefEditionMeta {
  id: number;
  editionDate: string; // ISO date
  weekday: string; // "mon" | "thu"
  briefType: string;
  sourceCount: number;
}

// Matches the real indie-brief edition JSON (build-brief.js / brief-content-<date>.json).
export interface BriefNotable {
  name: string;
  status?: string | null;
  date?: string | null;
  category?: string;
  blurb?: string;
  relevance?: string;
  figure?: string | null;
  team?: string | null;
  kind?: string | null;
  cover_url?: string | null;
  image_url?: string | null;
  source?: string;
  steam_appid?: string | null;
}
export interface BriefToolingItem {
  group?: string;
  headline: string;
  detail?: string;
  version_or_date?: string | null;
  relevance?: string;
  source?: string;
}
export interface BriefMarketItem {
  headline: string;
  figure?: string | null;
  detail?: string;
  date?: string | null;
  source?: string;
}
export interface BriefPayload {
  weekday?: string;
  phase_badge?: string;
  edition_label?: string;
  top_signals?: string[];
  new_notable?: BriefNotable[];
  browser?: BriefNotable[];
  tooling?: { headline?: string; items?: BriefToolingItem[] };
  market?: BriefMarketItem[];
  reference_shelf?: string;
  founder_take?: string[];
}
export interface BriefEdition extends BriefEditionMeta {
  payload: BriefPayload;
}

// Current "Standing Flags" (interests) steering the brief — curated on Notion,
// mirrored read-only into KAIROS by the routine.
export interface BriefSteering {
  flags: string[];
  updatedAt: string | null;
}

// Supply-side momentum: is this genre being flooded with new entrants, or quiet?
// "rising" = new titles arriving faster than the prior window (crowding); "quiet" = no
// recent entrants. Distinct from `trajectory` (which reads demand/votes) — a genre can
// have rising demand AND rising supply (a race) or rising demand with quiet supply (the
// white space you want). Computed by comparing two adjacent trailing windows anchored to
// the data's newest date, so it's clock-independent.
export type SupplyTrend = "rising" | "steady" | "cooling" | "quiet";

export interface GenreRow {
  genre: string;
  games: number;
  avgRating: number;
  medianVotes: number;
  p90Votes: number;
  p90Rating: number;
  votesPerDay: number;
  // Later-half vs earlier-half momentum of the genre's median-votes series — the delta
  // read ("is this changing?") a static level column can't give.
  trajectory: Trajectory;
  supplyTrend: SupplyTrend; // new-entrant momentum (crowding signal)
  recentEntrants: number; // titles first seen in the trailing window
}
export interface DeveloperRow {
  developer: string;
  games: number;
  avgRating: number;
  avgVotes: number;
  topGenre: string;
}
// Age-adjusted momentum: "new" = too little history to judge yet.
export type Trajectory = "rising" | "plateau" | "decaying" | "new";
export interface NewRelease {
  gameId: number;
  title: string;
  genre: string;
  rating: number;
  votes: number;
  url: string;
  votesPerDay: number; // votes gained per day over the tracked window (launch-date-independent)
  trajectory: Trajectory;
}

export interface LibraryItem {
  id: number;
  kind: string;
  title: string;
  summary: string;
  tags: string[];
  // DERIVED for cards linked to a pitch: the API returns the linked pitch's status, so a
  // prototype card can never disagree with the leaderboard. Falls back to the item's own
  // stored status when there's no linked pitch (non-prototype collections).
  status: string;
  pitchSlug: string | null; // the pitch whose concept this card tests — the status source
  mediaUrl: string | null; // playable/asset link (e.g. a hosted prototype)
  imageUrl: string | null; // poster/thumbnail shown on the card
  date: string | null; // YYYY-MM-DD — e.g. a prototype's publish date
}

// Input for publishing/upserting a library item (token-gated POST /api/library).
// mediaUrl is the natural upsert key — same convention the prototype seed uses —
// so re-posting the same hosted URL updates the card instead of duplicating it.
export interface LibraryItemInput {
  kind: string; // e.g. "prototype"
  title: string;
  mediaUrl: string; // upsert key
  summary?: string | null;
  imageUrl?: string | null;
  tags?: string[] | null;
  // Ignored on read for pitch-linked cards (status derives from the pitch). Still used by
  // collections that own their own status. Defaults to "draft".
  status?: string | null;
  pitchSlug?: string | null; // link to the pitch this card tests; omit to keep an existing link
  date?: string | null; // YYYY-MM-DD publish date (becomes created_at)
}

// A game-concept pitch — the Library "Pitches" collection. Dated + classified so
// batches stay grouped. Written by the weekly kairos-iterate routine (upsert on slug).
export interface Pitch {
  id: number;
  slug: string;
  rank: number | null;
  title: string;
  oneLiner: string | null;
  loopFamily: string | null;
  platformLadder: string | null;
  status: string;
  badge: string | null;
  loopDetail: string | null;
  browserMvp: string | null;
  steamLadder: string | null;
  evidence: string | null;
  risk: string | null;
  browserFit: number | null; // 1..3 — browser-native viability (instant hook, portal retention, ad-monetizability)
  steamFit: number | null; // 1..3 — paid-Steam laddering potential + revenue ceiling vs comps
  buildEase: number | null; // 1..3 — solo-dev feasibility (higher = cheaper/easier)
  provenance: string | null; // market-backed | design-derived (how well-supported the pitch is)
  // Pitch v5 — scope block (F3): can the loop be proven fun before it eats the year?
  grayBoxDays: number | null; // estimated days to a testable gray-box loop (the Aug kill-gate clock)
  contentScope: string | null; // small | medium | large — content bill vs. genre expectation
  techRisk: string | null; // one line: the scariest technical unknown
  // v5 — hook (F4) + founder fit (F5): the two lenses the commercial scores miss.
  hook: string | null; // the capsule promise / marketing beat in one line
  marketability: number | null; // 1..3 — first-session pull / does it capsule (absorbs #26 "Grab")
  founderFit: number | null; // 1..3 — personal pull + edge (would you still care in month four?)
  whyMe: string | null; // one line: why this holds your attention / what you uniquely bring
  pitchDate: string; // YYYY-MM-DD
  batch: string | null;
  source: string | null;
  // Visual card (contract pitch v2): world/style dimensions + generated art.
  setting: string | null;
  artStyle: string | null;
  codeName: string | null; // placeholder project name shown on the header capsule
  headerUrl: string | null; // Steam-style header capsule image
  shotUrl: string | null; // in-game screenshot image
}

// Input for publishing/upserting a pitch (token-gated POST /api/pitches).
export interface PitchInput {
  slug: string;
  title: string;
  pitchDate: string;
  rank?: number | null;
  oneLiner?: string | null;
  loopFamily?: string | null;
  platformLadder?: string | null;
  status?: string | null;
  badge?: string | null;
  loopDetail?: string | null;
  browserMvp?: string | null;
  steamLadder?: string | null;
  evidence?: string | null;
  risk?: string | null;
  browserFit?: number | null;
  steamFit?: number | null;
  buildEase?: number | null;
  provenance?: string | null;
  grayBoxDays?: number | null;
  contentScope?: string | null;
  techRisk?: string | null;
  hook?: string | null;
  marketability?: number | null;
  founderFit?: number | null;
  whyMe?: string | null;
  batch?: string | null;
  source?: string | null;
  setting?: string | null;
  artStyle?: string | null;
  codeName?: string | null;
  headerUrl?: string | null;
  shotUrl?: string | null;
}
