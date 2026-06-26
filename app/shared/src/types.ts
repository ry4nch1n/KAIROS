// Shared types across web + server. Single source of truth for API shapes.

export type Platform = "all" | "poki" | "crazygames";

export interface OverviewKPI {
  gamesTracked: number;
  newThisWeek: number;
  avgRating: number;
  fastestGenre: string;
  fastestGenreDeltaPct: number;
  openGaps: number;
}

export interface MomentumSeries {
  genre: string;
  values: number[]; // one per week, aligned to `weeks`
}
export interface GenreMomentum {
  weeks: string[]; // e.g. ["W18","W19",...]
  series: MomentumSeries[];
}

export interface TagFreq {
  tag: string;
  count: number;
}

export interface ScatterPoint {
  title: string;
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
  combo: string;
  demand: number; // 0-100
  supply: number; // 0-100
  score: number; // demand - supply
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

export interface Overview {
  kpi: OverviewKPI;
  momentum: GenreMomentum;
  tags: TagFreq[];
  scatter: ScatterPoint[];
  heatmap: FeatureHeatmap;
  gaps: MarketGap[];
  insights: Insight[];
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

export interface LibraryItem {
  id: number;
  kind: string;
  title: string;
  summary: string;
  tags: string[];
  status: string;
}
