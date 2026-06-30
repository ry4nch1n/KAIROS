// Shared types across web + server. Single source of truth for API shapes.

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
}

export interface SteamOverview {
  kpi: { games: number; indie: number; aaa: number; ratedPct: number; indieMedianPriceCents: number };
  tiers: ScaleTierRow[];
  indie: SteamGenreEconomics[]; // indie-addressable cohort (default benchmark)
  all: SteamGenreEconomics[];   // all tiers incl. AAA (demand-context view)
  comparables: SteamComparable[];
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
export interface NewRelease {
  gameId: number;
  title: string;
  genre: string;
  rating: number;
  votes: number;
  url: string;
}

export interface LibraryItem {
  id: number;
  kind: string;
  title: string;
  summary: string;
  tags: string[];
  status: string;
}
