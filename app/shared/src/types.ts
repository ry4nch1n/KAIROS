// Shared types across web + server. Single source of truth for API shapes.

// The data contract (versions, taxonomy enums, payload validators) lives in contract.ts
// and is re-exported here so `import { CONTRACT, ... } from "shared"` resolves (shared's
// main is this file).
export * from "./contract.ts";

export type Platform = "all" | "poki" | "crazygames" | "steam";

// ── Phase 2: Steam / PC analytics ──
export interface ScaleTierRow { tier: string; games: number; }
export type SteamCohort = "indie" | "all";
export interface SteamGenreEconomics {
  genre: string;
  games: number;
  medianPriceCents: number;
  medianRating: number | null; // null when the cohort has no rated games yet (honest, not 0)
  totalOwners: number;
  revenueProxy: number; // owners × price, in dollars (rough monetizability signal)
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
  label: string; genre: string; tag: string;
  supplyN: number;          // # games (supply)
  medianOwners: number;     // demand
  qualityCeil: number;      // P90 rating
  medianPriceCents: number; // monetization
  score: number;
  examples: string[];
}
export interface SteamPriceBand {
  band: string;             // "Free" | "<$5" | "$5–10" | "$10–20" | "$20+"
  games: number;
  medianRating: number | null;
  totalOwners: number;
  revenueProxy: number;     // dollars
}
export interface SteamOwnershipRow {
  genre: string; games: number;
  totalOwners: number; medianOwners: number;
  ccu: number;              // summed live concurrent players
  medianPlaytimeMin: number;
}
export interface SteamDeveloperRow {
  developer: string; games: number;
  totalOwners: number; avgRating: number; topGenre: string;
}
export interface SteamNewRelease {
  title: string; genre: string; tier: string;
  rating: number | null; owners: number | null;
  priceCents: number | null; releaseDate: string | null;
}

export interface SteamOverview {
  kpi: { games: number; indie: number; aaa: number; ratedPct: number; indieMedianPriceCents: number };
  tiers: ScaleTierRow[];
  indie: SteamGenreEconomics[]; // indie-addressable cohort (default benchmark)
  all: SteamGenreEconomics[];   // all tiers incl. AAA (demand-context view)
  comparables: SteamComparable[];
  opportunity: SteamGap[];
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

export interface ScatterPoint { title: string; genre: string; votes: number; rating: number; gem: boolean; }

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
}

export interface GenreLandscapePoint { genre: string; supply: number; p75Rating: number; avgRating: number; totalVotes: number; examples: string[]; }

export interface GenreVelocityBar { genre: string; votesPerDay: number; }
export interface GlossaryRow { label: string; kind: "genre" | "tag"; count: number; examples: string[]; definition: string; }

export interface Overview {
  kpi: OverviewKPI;
  momentum: GenreMomentum;
  tags: TagFreq[];
  scatter: ScatterPoint[];
  heatmap: FeatureHeatmap;
  gaps: MarketGap[];
  insights: Insight[];
  landscape: GenreLandscapePoint[];
  velocityBars: GenreVelocityBar[];
  glossary: GlossaryRow[];
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

export interface GenreRow {
  genre: string;
  games: number;
  avgRating: number;
  medianVotes: number;
  p90Votes: number;
  p90Rating: number;
  votesPerDay: number;
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
  status: string;
  mediaUrl: string | null; // playable/asset link (e.g. a hosted prototype)
  date: string | null;     // YYYY-MM-DD — e.g. a prototype's publish date
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
  d1Fit: number | null;
  steamCeiling: number | null;
  buildCost: number | null;
  pitchDate: string; // YYYY-MM-DD
  batch: string | null;
  source: string | null;
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
  d1Fit?: number | null;
  steamCeiling?: number | null;
  buildCost?: number | null;
  batch?: string | null;
  source?: string | null;
}
