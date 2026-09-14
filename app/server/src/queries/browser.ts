// Browser-portal analytics (Poki + CrazyGames). Split out of the former monolithic
// index.ts (issue #33, pure code movement). Cross-cutting helpers live in ./shared.ts.
import type { Querier } from "../db/db.ts";
import type {
  Platform,
  Overview,
  OverviewKPI,
  GenreMomentum,
  TagFreq,
  ScatterPoint,
  HiddenGem,
  MarketGap,
  FeatureHeatmap,
  Insight,
  GenreRow,
  DeveloperRow,
  NewRelease,
  Trajectory,
  SupplyTrend,
  GenreLandscapePoint,
  QuadrantPoint,
  GenreVelocityBar,
  GenrePortalMomentum,
  RisingGenre,
  GlossaryRow,
  SettingFacet,
  VoteBasis,
} from "shared";
import { CONTRACT } from "../../../shared/src/contract.ts";
import { coTagHits, DEFAULTED_GENRES, loopFamilyFor } from "../data/loopFamilyMap.ts";
import {
  num,
  pf,
  canonSql,
  isCurationTag,
  classifyEngagement,
  classifyTrajectory,
  classifySupply,
  genreSupplyTrend,
  portalName,
  voteBasisOf,
  voteMomentumOf,
  steerRanking,
  steeringLens,
  MIN_MARKET_SUPPLY,
  MIN_RANKABLE_CELLS,
} from "./shared.ts";
import { getBriefSteering } from "./library.ts";

const fmtDate = (d: any) => new Date(d).toISOString().slice(5, 10); // "MM-DD"

// Short, plain-language definitions for browser-game tags shown in the glossary.
// Keyed by lowercased tag name. Anything missing falls back to an inferred guess.
const TAG_DEFINITIONS: Record<string, string> = {
  action: "Fast-paced games built on reflexes and real-time challenge.",
  "action games": "Fast-paced games built on reflexes and real-time challenge.",
  adventure: "Exploration- and story-driven games.",
  arcade: "Simple, score-chasing games with a classic arcade feel.",
  racing: "Race-to-the-finish driving competition games.",
  driving: "Vehicle-driving games (racing, parking, stunts).",
  car: "Car-themed driving games.",
  "car games": "Car-themed driving games.",
  bike: "Motorbike/bicycle riding and stunt games.",
  truck: "Truck-driving and hauling games.",
  parking: "Precision vehicle-parking challenge games.",
  drift: "Drift-focused driving games.",
  shooting: "Games centered on aiming and shooting.",
  shooter: "Games centered on aiming and shooting.",
  sniper: "Long-range precision shooting games.",
  gun: "Firearm-based shooting games.",
  puzzle: "Games about solving logic or spatial challenges.",
  strategy: "Games rewarding planning, tactics, and resource management.",
  "tower defense": "Defend a path by placing defensive towers against waves.",
  sports: "Games simulating real-world sports.",
  soccer: "Football/soccer sports games.",
  football: "Football sports games.",
  basketball: "Basketball sports games.",
  pool: "Pool/billiards cue-sports games.",
  billiards: "Billiards/pool cue-sports games.",
  golf: "Golf sports games.",
  simulation: "Games that model a real-world activity or system.",
  simulator: "Games that simulate operating a vehicle, job, or system.",
  idle: "Incremental games that progress with minimal, often automated, input.",
  clicker: "Tap/click games where repeated clicks drive progression.",
  io: "Massively-multiplayer browser arena games in the '.io' style.",
  ".io": "Massively-multiplayer browser arena games in the '.io' style (e.g. Agar.io).",
  horror: "Scary, tense, atmosphere-driven games.",
  zombie: "Zombie-survival and shooting games.",
  multiplayer: "Games played with or against other people online.",
  "2 player": "Games for two players sharing one device or playing online.",
  "two player": "Games for two players sharing one device or playing online.",
  casual: "Easy-to-pick-up games with light, low-commitment sessions.",
  board: "Digital versions of board games (chess, checkers, ludo).",
  card: "Card-based games (solitaire, matching, collectible).",
  mahjong: "Tile-matching games in the mahjong tradition.",
  cooking: "Time-management games themed around cooking and food service.",
  restaurant: "Restaurant-management time-management games.",
  beauty: "Dress-up, makeover, and styling games.",
  "dress up": "Outfit and styling games.",
  merge: "Games built around combining items to upgrade them.",
  "match 3": "Swap-and-match three-or-more puzzle games.",
  "bubble shooter": "Aim-and-pop bubble-matching games.",
  platform: "Jump-and-run platforming games.",
  runner: "Endless-runner games focused on dodging and timing.",
  running: "Auto-run / endless-runner games focused on dodging and timing.",
  "running games": "Auto-run / endless-runner games focused on dodging and timing.",
  stickman: "Games starring stick-figure characters.",
  fighting: "One-on-one combat/brawler games.",
  brain: "Puzzle/logic games that test memory, reasoning, or math.",
  "brain games": "Puzzle/logic games that test memory, reasoning, or math.",
  number: "Math and number-based puzzle games.",
  "number games": "Math and number-based puzzle games.",
  math: "Arithmetic and math-practice games.",
  word: "Word, spelling, and vocabulary games.",
  typing: "Keyboard typing-skill games.",
  mouse: "Games controlled mainly with the mouse (point-click / aim).",
  "mouse games": "Games controlled mainly with the mouse (point-click / aim).",
  music: "Rhythm and music-timing games.",
  physics: "Games whose challenge comes from realistic physics.",
  pixel: "Games with a retro pixel-art aesthetic.",
  retro: "Games with a retro/old-school aesthetic.",
  "3d": "Games rendered with 3D graphics.",
  "3d games": "Games rendered with 3D graphics.",
  "2d": "Games with flat, two-dimensional graphics.",
  flash: "Legacy Flash-style games (now HTML5), usually simple arcade titles.",
  html5: "Games built in HTML5 to run natively in the browser.",
  mobile: "Touch-friendly games that also play well on phones/tablets.",
  "mobile games": "Touch-friendly games that also play well on phones/tablets.",
  girls: "Audience label for dress-up, care, and casual games aimed at girls.",
  kids: "Games aimed at younger children.",
  educational: "Learning-focused games.",
  skill: "Games that reward dexterity and precise timing.",
  ball: "Ball-physics and ball-control games.",
  snake: "Snake-style grow-and-avoid games.",
  tank: "Tank combat games.",
  war: "Warfare-themed combat games.",
  farm: "Farming and harvest management games.",
  fishing: "Fishing-themed games.",
  escape: "Room-escape puzzle games.",
  "hidden object": "Find-the-hidden-item search games.",
  jigsaw: "Jigsaw-puzzle assembly games.",
  solitaire: "Single-player card-sorting games.",
  // Platform curation / brand tags (not gameplay genres) — described honestly:
  popular: "A platform curation label for trending/most-played titles — not a gameplay genre.",
  "popular games":
    "A platform curation label for trending/most-played titles — not a gameplay genre.",
  "new": "A platform curation label for recently added titles — not a gameplay genre.",
  "new games": "A platform curation label for recently added titles — not a gameplay genre.",
  trending: "A platform curation label for currently-rising titles — not a gameplay genre.",
  hot: "A platform curation label for currently-popular titles — not a gameplay genre.",
  featured: "A platform curation label for editorially highlighted titles — not a gameplay genre.",
  crazygames: "A platform/brand tag (CrazyGames) — not a gameplay descriptor.",
  "crazy games": "A platform/brand tag (CrazyGames) — not a gameplay descriptor.",
  poki: "A platform/brand tag (Poki) — not a gameplay descriptor.",
  fun: "A broad catch-all label with no specific gameplay meaning.",
};

function defineTag(name: string): string {
  const d = TAG_DEFINITIONS[name.toLowerCase().trim()];
  if (d) return d;
  const base = name.replace(/\s*games?$/i, "").trim();
  return base
    ? `Games themed around or tagged "${base}" (inferred — not a formally defined category).`
    : `A platform tag with no formal definition (inferred).`;
}

// ── Genre momentum, per portal (#204 S3) ──
// A genre's median-votes series is built per portal on its own capture instants: a running total
// and a recent-window count are different quantities, so on `all` they are never pooled into one
// median, one rate or one ranking.
interface PortalGenreDates {
  source: string;
  voteBasis: VoteBasis;
  dates: string[];
  days: number[]; // capture instants, days from this portal's first
  order: string[]; // genres by summed median level, this portal only
  byGenre: Record<string, number[]>; // zero where the genre had no median at an instant (pre-#204 input)
  seen: Record<string, boolean[]>; // whether it did
  daySpan: number;
}
async function genreVotesByDate(db: Querier, platform: Platform): Promise<PortalGenreDates[]> {
  const rows = await db.query(
    `SELECT src.name AS source, ${canonSql("s.genre")} AS genre, s.captured_at AS d,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY s.votes) AS med
     FROM game_snapshots s
     JOIN games g ON g.id = s.game_id
     JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND s.votes IS NOT NULL AND s.genre IS NOT NULL ${pf(platform)}
     GROUP BY src.name, ${canonSql("s.genre")}, s.captured_at`,
  );
  const bySource = new Map<string, Record<string, any>[]>();
  if (platform !== "all") bySource.set(platform, []); // a single portal always reads as itself
  for (const r of rows) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  return [...bySource.keys()].sort().map((s) => portalGenreDates(s, bySource.get(s)!));
}
function portalGenreDates(source: string, rows: Record<string, any>[]): PortalGenreDates {
  const times = [...new Set(rows.map((r) => new Date(r.d).getTime()))].sort((a, b) => a - b);
  const idx = new Map(times.map((t, i) => [t, i]));
  const byGenre: Record<string, number[]> = {};
  const seen: Record<string, boolean[]> = {};
  const totalVotes: Record<string, number> = {};
  for (const r of rows) {
    const g = r.genre as string;
    const i = idx.get(new Date(r.d).getTime())!;
    if (!byGenre[g]) {
      byGenre[g] = new Array(times.length).fill(0);
      seen[g] = new Array(times.length).fill(false);
    }
    byGenre[g][i] = num(r.med);
    seen[g][i] = true;
    totalVotes[g] = (totalVotes[g] ?? 0) + num(r.med);
  }
  return {
    source,
    voteBasis: voteBasisOf(source),
    dates: times.map((t) => fmtDate(t)),
    days: times.map((t) => (t - times[0]) / 86400000),
    order: Object.keys(byGenre).sort((a, b) => totalVotes[b] - totalVotes[a]),
    byGenre,
    seen,
    daySpan: times.length > 1 ? (times[times.length - 1] - times[0]) / 86400000 : 0,
  };
}

/** One genre's momentum on one portal, in its unit. Cumulative is exactly the pre-#204 genre read
 *  (endpoint velocity, rounded; half-over-half trajectory on the zero-filled series), so Poki's
 *  numbers do not move. Window fits `classifyEngagement` over the real instants that carried the
 *  genre — a missing capture is absent, not a zero. */
function genreMomentumRead(pd: PortalGenreDates, genre: string): GenrePortalMomentum {
  const series = pd.byGenre[genre];
  const seen = pd.seen[genre] ?? [];
  const base = {
    source: pd.source,
    voteBasis: pd.voteBasis,
    captures: seen.filter(Boolean).length,
  };
  if (pd.voteBasis === "window") {
    const at = seen.flatMap((s, i) => (s ? [i] : []));
    const fit = classifyEngagement(
      at.map((i) => series[i]),
      pd.daySpan,
      at.map((i) => pd.days[i]),
    );
    return { ...base, votesPerDay: null, ...fit };
  }
  return {
    ...base,
    votesPerDay: series ? Math.round(velocity(series, pd.daySpan)) : 0,
    engagementPctPerWeek: null,
    trajectory: series ? classifyTrajectory(series, pd.daySpan).trajectory : "new",
  };
}
/** Within-portal ranking value — raw votes/day or %/wk. Only ever compared inside one portal. */
const moverRank = (pd: PortalGenreDates, genre: string): number | null =>
  pd.voteBasis === "window"
    ? genreMomentumRead(pd, genre).engagementPctPerWeek
    : velocity(pd.byGenre[genre], pd.daySpan);

/** A genre needs this many live titles on the portal before it can headline a mover read. */
const GENRE_MIN_VOL = 4;
interface Mover {
  source: string;
  voteBasis: VoteBasis;
  genre: string;
  v: number; // raw, in the portal's unit
  trajectory: Trajectory;
}
/** The strongest genre mover on one portal (KPI + read), ranked on that portal's unit only. */
function topMover(
  pd: PortalGenreDates,
  vol: Map<string, number>,
): { rising: RisingGenre; mover: Mover } | undefined {
  const best = pd.order
    .filter((genre) => (vol.get(genre) ?? 0) >= GENRE_MIN_VOL)
    .map((genre) => ({ genre, v: moverRank(pd, genre) }))
    .filter((x): x is { genre: string; v: number } => x.v != null)
    .sort((a, b) => b.v - a.v)[0];
  if (!best) return undefined;
  const m = genreMomentumRead(pd, best.genre);
  return {
    rising: { genre: best.genre, ...m },
    mover: { ...best, source: pd.source, voteBasis: pd.voteBasis, trajectory: m.trajectory },
  };
}

/** Live titles per genre, per portal. */
async function genreCounts(
  db: Querier,
  platform: Platform,
): Promise<Map<string, Map<string, number>>> {
  const rows = await db.query(
    `SELECT src.name AS source, ${canonSql("l.genre")} AS genre, count(*)::int AS n FROM v_latest l JOIN games g ON g.id=l.game_id JOIN sources src ON src.id=g.source_id WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)} GROUP BY src.name, ${canonSql("l.genre")}`,
  );
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) out.set(r.source, (out.get(r.source) ?? new Map()).set(r.genre, num(r.n)));
  return out;
}

// velocity = (last - first) / spanDays, guarded for <2 points or zero span
function velocity(values: number[], daySpan: number): number {
  if (values.length < 2 || daySpan <= 0) return 0;
  const first = values[0],
    last = values[values.length - 1];
  return (last - first) / daySpan;
}

// Data-relative anchor for the 14-day "new" window: the newest first_seen_at WITHIN this
// platform's OWN live catalog. Must carry the same predicates (g.is_live + pf) as the query
// it bounds — otherwise one platform's window inherits another source's crawl recency (an
// unrelated crawler's health, not the market being examined). Still data-relative, not
// wall-clock, so the read stays deterministic.
function newAnchor(platform: Platform): string {
  return `(SELECT max(g2.first_seen_at) FROM games g2 JOIN sources src ON src.id = g2.source_id WHERE g2.is_live ${pf(platform)})`;
}
function subtitleFor(platform: Platform): string {
  if (platform === "poki") return "Poki · last 90 days";
  if (platform === "crazygames") return "CrazyGames · last 90 days";
  if (platform === "steam") return "Steam (PC) · last 90 days";
  return "Poki + CrazyGames · last 90 days";
}

/** Genre median-vote levels over time — one chart's worth per portal, never both on one axis. */
export async function getGenreMomentum(
  db: Querier,
  platform: Platform,
  pds?: PortalGenreDates[],
): Promise<GenreMomentum[]> {
  pds ??= await genreVotesByDate(db, platform);
  return pds.map((pd) => ({
    source: pd.source,
    voteBasis: pd.voteBasis,
    dates: pd.dates,
    series: pd.order.slice(0, 4).map((genre) => ({ genre, values: pd.byGenre[genre] })),
  }));
}

const RATING_BANDS = ["<3.5", "3.5–4.0", "4.0–4.4", "4.4–4.7", "≥4.7"];
function bandIndex(r: number): number {
  return r < 3.5 ? 0 : r < 4.0 ? 1 : r < 4.4 ? 2 : r < 4.7 ? 3 : 4;
}

export async function getFeatureHeatmap(db: Querier, platform: Platform): Promise<FeatureHeatmap> {
  const rows = await db.query(
    `SELECT ${canonSql("l.genre")} AS genre, l.rating AS rating, count(*)::int AS n
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL AND l.rating IS NOT NULL ${pf(platform)}
     GROUP BY ${canonSql("l.genre")}, l.rating`,
  );
  const totals: Record<string, number> = {};
  for (const r of rows) totals[r.genre] = (totals[r.genre] ?? 0) + num(r.n);
  const genres = Object.keys(totals)
    .sort((a, b) => totals[b] - totals[a])
    .slice(0, 7);
  const gi = new Map(genres.map((g, i) => [g, i]));
  const cells = genres.flatMap((_, g) =>
    RATING_BANDS.map((_, w) => ({ genreIndex: g, week: w, value: 0 })),
  );
  const at = (g: number, w: number) => cells[g * RATING_BANDS.length + w];
  for (const r of rows) {
    if (!gi.has(r.genre)) continue;
    at(gi.get(r.genre)!, bandIndex(num(r.rating))).value += num(r.n);
  }
  return { weeks: RATING_BANDS, genres, cells };
}

export async function getTagFrequency(db: Querier, platform: Platform): Promise<TagFreq[]> {
  const rows = await db.query(
    `SELECT ${canonSql("t.name")} AS tag, count(DISTINCT g.id)::int AS cnt
     FROM tags t
     JOIN game_tags gt ON gt.tag_id = t.id
     JOIN games g ON g.id = gt.game_id
     JOIN sources src ON src.id = g.source_id
     WHERE g.is_live ${pf(platform)}
     GROUP BY ${canonSql("t.name")} ORDER BY cnt DESC LIMIT 12`,
  );
  return rows.map((r) => ({ tag: r.tag, count: num(r.cnt) }));
}

// Setting/theme facet (#25). Setting is an axis ORTHOGONAL to genre — two "Simulation"
// games in different settings compete in different fields, and market white space often
// lives at a genre × setting intersection a genre-only view can't see. Portals/Steam carry
// setting labels mixed into their flat tag lists; this maps the setting-bearing ones into
// the controlled vocabulary (contract.taxonomy.settings) and drops the rest. The map is the
// residual-design seam: enriching the tag→setting coverage needs no shape change, only more
// keys here. Kept deliberately conservative — an unmapped tag is left OUT, never guessed,
// so the facet reports real coverage rather than inflating it.
const SETTING_TAGS: Record<string, string> = {
  fantasy: "fantasy",
  "high fantasy": "fantasy",
  "dark fantasy": "fantasy",
  magic: "fantasy",
  "sci-fi": "sci-fi",
  scifi: "sci-fi",
  "science fiction": "sci-fi",
  futuristic: "sci-fi",
  space: "space",
  "space sim": "space",
  "outer space": "space",
  cyberpunk: "cyberpunk",
  "post-apocalyptic": "post-apocalyptic",
  "post apocalyptic": "post-apocalyptic",
  apocalyptic: "post-apocalyptic",
  horror: "horror",
  "survival horror": "horror",
  lovecraftian: "horror",
  historical: "historical",
  history: "historical",
  medieval: "medieval",
  modern: "modern",
  contemporary: "modern",
  western: "western",
  "wild west": "western",
  military: "military",
  war: "military",
  wwii: "military",
  "world war ii": "military",
};

export async function getSettingFacets(db: Querier, platform: Platform): Promise<SettingFacet[]> {
  const keys = Object.keys(SETTING_TAGS);
  const ph = keys.map((_, i) => `$${i + 1}`).join(",");
  const rows = await db.query(
    `SELECT lower(t.name) AS tagname, g.id AS gid, g.title AS title
     FROM tags t
     JOIN game_tags gt ON gt.tag_id = t.id
     JOIN games g ON g.id = gt.game_id
     JOIN sources src ON src.id = g.source_id
     WHERE g.is_live ${pf(platform)} AND lower(t.name) IN (${ph})`,
    keys,
  );
  // Aggregate in JS: a game can carry several setting tags (setting isn't exclusive), so it
  // counts once per DISTINCT setting it maps into — orthogonal axes, not a partition.
  const bySetting = new Map<string, { games: Set<number>; examples: string[] }>();
  for (const r of rows) {
    const setting = SETTING_TAGS[String(r.tagname)];
    if (!setting) continue;
    const e = bySetting.get(setting) ?? { games: new Set<number>(), examples: [] };
    e.games.add(num(r.gid));
    if (e.examples.length < 3 && !e.examples.includes(r.title)) e.examples.push(r.title);
    bySetting.set(setting, e);
  }
  // Preserve the contract's canonical setting order for ties; sort primarily by supply.
  const order = new Map((CONTRACT.taxonomy.settings as readonly string[]).map((s, i) => [s, i]));
  return [...bySetting.entries()]
    .map(([setting, e]) => ({ setting, count: e.games.size, examples: e.examples }))
    .sort(
      (a, b) => b.count - a.count || (order.get(a.setting) ?? 99) - (order.get(b.setting) ?? 99),
    );
}

const GEM_RATING_PCTILE = 0.75,
  GEM_VOTES_PCTILE = 0.25;
// Sample-size gate (issue #8): a rating from a handful of votes is noise, not quality.
// A game must clear MIN_GEM_VOTES to be a "gem", and gems rank by a Bayesian-shrunk
// rating (few votes are pulled toward the prior mean) rather than the raw score.
const MIN_GEM_VOTES = 30;
const GEM_PRIOR_MEAN = 4.2,
  GEM_PRIOR_WEIGHT = 20;

/** Bayesian-shrunk rating: (v·R + k·C) / (v + k). Few votes → near the prior mean C. */
export function bayesianGemScore(
  rating: number,
  votes: number,
  priorMean = GEM_PRIOR_MEAN,
  priorWeight = GEM_PRIOR_WEIGHT,
): number {
  const v = Math.max(0, votes || 0);
  return (v * rating + priorWeight * priorMean) / (v + priorWeight);
}

async function gemBase(db: Querier, platform: Platform) {
  return db.query(
    `WITH base AS (
       SELECT g.id, g.title, src.name AS source, ${canonSql("l.genre")} AS genre, l.rating, l.votes,
              -- Days since we FIRST SAW the title, measured against the same data-relative
              -- anchor the new-release window uses (never the wall clock, so reads stay
              -- deterministic). first_seen_at is crawl discovery, not a release date.
              greatest(0, floor(extract(epoch FROM (${newAnchor(platform)} - g.first_seen_at)) / 86400))::int AS days_tracked,
              percent_rank() OVER (ORDER BY l.rating) AS rp,
              percent_rank() OVER (ORDER BY l.votes)  AS vp
       FROM v_latest l
       JOIN games g ON g.id = l.game_id
       JOIN sources src ON src.id = g.source_id
       WHERE g.is_live AND l.rating IS NOT NULL AND l.votes IS NOT NULL ${pf(platform)}
     )
     SELECT id, title, source, genre, rating, votes, days_tracked, rp, vp,
            (rp >= ${GEM_RATING_PCTILE} AND vp <= ${GEM_VOTES_PCTILE} AND votes >= ${MIN_GEM_VOTES}) AS gem
     FROM base`,
  );
}

export async function getScatter(
  db: Querier,
  platform: Platform,
  rows?: Record<string, any>[],
): Promise<ScatterPoint[]> {
  rows ??= await gemBase(db, platform);
  return rows.map((r) => ({
    title: r.title,
    genre: r.genre ?? "—",
    rating: num(r.rating),
    votes: num(r.votes),
    gem: !!r.gem,
  }));
}

type Captures = Map<number, { t: number[]; v: number[] }>;
/** Group per-title (id, d, votes) snapshot rows into capture series, in row order. */
function groupCaptures(rows: Record<string, any>[]): Captures {
  const byId: Captures = new Map();
  for (const r of rows) {
    const id = num(r.id);
    const g = byId.get(id) ?? { t: [], v: [] };
    byId.set(id, g);
    g.t.push(new Date(r.d).getTime());
    g.v.push(num(r.votes));
  }
  return byId;
}
/** One title's momentum in its portal's unit (#204). Real capture instants, so an uneven crawl
 *  cadence can't bend the fitted slope; fewer than two captures reads "new" on either basis. */
function momentumOf(source: string, g?: { t: number[]; v: number[] }) {
  const voteBasis = voteBasisOf(source);
  const days = (g?.t ?? []).map((t) => (t - (g?.t[0] ?? 0)) / 86400000);
  return {
    source,
    voteBasis,
    captures: g?.t.length ?? 0, // rows are grouped per captured_at, so each entry is one instant
    ...voteMomentumOf(voteBasis, g?.v ?? [], days[days.length - 1] ?? 0, days),
  };
}

/**
 * Per-title vote series for an arbitrary id set, off the append-only snapshot table — the same
 * reading getNewReleases computes over its cohort, hoisted so any list can annotate its rows
 * with "is this still accreting attention, or has it stopped?".
 */
async function voteCaptures(db: Querier, ids: number[]): Promise<Captures> {
  if (!ids.length) return new Map();
  const ph = ids.map((_, i) => `$${i + 1}`).join(",");
  return groupCaptures(
    await db.query(
      `SELECT game_id AS id, captured_at AS d, max(votes) AS votes
       FROM game_snapshots
       WHERE game_id IN (${ph}) AND votes IS NOT NULL
       GROUP BY game_id, captured_at ORDER BY game_id, captured_at`,
      ids,
    ),
  );
}

export async function getHiddenGems(
  db: Querier,
  platform: Platform,
  rows?: Record<string, any>[],
): Promise<HiddenGem[]> {
  rows ??= await gemBase(db, platform);
  const top = rows
    .filter((r) => r.gem)
    // Rank by Bayesian-shrunk rating so well-supported quality outranks thin-sample flukes.
    .sort(
      (a, b) =>
        bayesianGemScore(num(b.rating), num(b.votes)) -
        bayesianGemScore(num(a.rating), num(a.votes)),
    )
    .slice(0, 30);
  // Second axis (#176). Rating × votes alone gives one number, and one number cannot tell
  // "under-discovered" from "stalled years ago" — the two look identical on it. Age since
  // first sighting plus vote momentum ANNOTATE the ranking (the sort is deliberately
  // unchanged) so the reader can separate them instead of trusting the label.
  const caps = await voteCaptures(
    db,
    top.map((r) => num(r.id)),
  );
  return top.map((r) => {
    const id = num(r.id);
    return {
      gameId: id,
      title: r.title,
      rating: num(r.rating),
      votes: num(r.votes),
      genre: r.genre ?? "—",
      daysTracked: num(r.days_tracked),
      ...momentumOf(r.source, caps.get(id)),
    };
  });
}

/** How many gap rows the browser Radar shows. The cut is a display decision, not an analysis
 *  one — the ranking below it still exists, and the steering lens reads it (#167/#142). */
export const GAPS_TOP_N = 6;

// Browser market gaps, FULL ranked candidate set — every genre × tag that cleared the supply
// floor, steered and sorted but not cut. `getMarketGaps` is this list's top slice; the steering
// lens needs the rest, because a market steering lifted can still land below the cut (#167).
export async function rankMarketGaps(db: Querier, platform: Platform): Promise<MarketGap[]> {
  const supply = await genreSupplyTrend(db, platform);
  // Standing flags add a visible score term BEFORE the sort and the top-N cut (#142), exactly as
  // on the Steam side — steering can surface a market the raw score kept off the list. The flags
  // are a global setting, so the same lens reshapes both reads. None set → no-op.
  const { flags } = await getBriefSteering(db);
  const [rows, gex] = await Promise.all([
    db.query(
      `SELECT ${canonSql("l.genre")} AS genre, ${canonSql("t.name")} AS tag,
              count(DISTINCT g.id)::int AS supply_n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY l.votes)::float AS appetite,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS quality_ceil
       FROM v_latest l
       JOIN games g ON g.id = l.game_id
       JOIN sources src ON src.id = g.source_id
       JOIN game_tags gt ON gt.game_id = g.id
       JOIN tags t ON t.id = gt.tag_id
       WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
       GROUP BY ${canonSql("l.genre")}, ${canonSql("t.name")}
       HAVING count(DISTINCT g.id) >= ${MIN_MARKET_SUPPLY}`,
    ),
    gapExamples(db, platform),
  ]);
  // Drop platform-curation tags up front so they don't seed junk gaps OR skew the z-baseline.
  const clean = rows.filter((r) => !isCurationTag(r.tag));
  // Too few markets to stand a z-score up — an empty list with an honest reason beats a ranking
  // of sample artifacts (#215, mirroring #211).
  if (clean.length < MIN_RANKABLE_CELLS) return [];
  const z = (vals: number[]) => {
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    return (v: number) => (v - m) / sd;
  };
  const zApp = z(clean.map((r) => num(r.appetite)));
  const zSup = z(clean.map((r) => num(r.supply_n)));
  const zQual = z(clean.map((r) => num(r.quality_ceil)));
  const scored = clean.map((r) => ({
    label: `${r.genre} × ${r.tag}`,
    genre: r.genre,
    tag: r.tag,
    supplyN: num(r.supply_n),
    appetite: Math.round(num(r.appetite)),
    qualityCeil: +num(r.quality_ceil).toFixed(2),
    score: +(zApp(num(r.appetite)) + zQual(num(r.quality_ceil)) - zSup(num(r.supply_n))).toFixed(2),
    // Same intermediates the score above sums — surfaced, not re-derived (#87). Signs match:
    // demand/quality lift, supply is negated. Rounded independently; sum ≈ score ±0.02.
    components: {
      demand: +zApp(num(r.appetite)).toFixed(2),
      quality: +zQual(num(r.quality_ceil)).toFixed(2),
      supply: +(-zSup(num(r.supply_n))).toFixed(2),
    },
    examples: gex.get(`${r.genre} × ${r.tag}`) ?? [],
    supplyRising: supply.get(r.genre)?.trend === "rising",
  }));
  // Standing flags re-score the ranking before its sort and top-N cut (#142), with the lift
  // scaled to THIS ranking's own visible band and confined to a candidate band (#200).
  return steerRanking(scored, flags, GAPS_TOP_N);
}

// The displayed gap list — the ranked set's top slice.
export async function getMarketGaps(db: Querier, platform: Platform): Promise<MarketGap[]> {
  return (await rankMarketGaps(db, platform)).slice(0, GAPS_TOP_N);
}

// Loop-family market read (#108). Re-keys the SAME crawl aggregation onto the plan's loop families
// (CONTRACT.pitch.loopFamilies) via the curated map, so a family's supply, demand, supply trend,
// and no-coverage set become answerable. The fold runs in JS (the DB doesn't hold the map). Each
// GENRE goes to exactly ONE family (a game has one genre → no tag double-count): its genre-level
// default, else its dominant genre × tag entry — so broad genres (Strategy, Shooter) get
// disambiguated by tag while a clean default (Idle, Cooking) is never yanked off by a minority tag.
// Payload types live here (not shared/types.ts) to fit the file cap; additive, read defensively —
// no contract bump (this CONSUMES the enum, it doesn't change it).
/** A family's Steam side (#67). `null` = Steam contributed no games; read it beside the row's
 *  `steamGenres`, which says whether that is a measured emptiness or an unmapped family (#179). */
export interface LoopFamilySteam {
  games: number; // released, non-AAA Steam games mapped to this family
  medianPriceCents: number;
  medianRevenuePerGame: number; // USD — owners bucket × price, the Comparables estimator
  supplyTrend: SupplyTrend;
}
export interface LoopFamilyMarketRow {
  family: string; // a CONTRACT.pitch.loopFamilies value
  supplyN: number; // distinct games (genre grain — no tag double-count); 0 = Steam-only family
  appetite: number | null; // supply-weighted median votes; null where the browser has no coverage
  supplyTrend: SupplyTrend;
  genres: string[]; // mapped browser genres that fed this family
  steamGenres: string[]; // Steam genres that fed the Steam side; [] = nothing maps in (#179)
  steam: LoopFamilySteam | null;
  routeLean: MarketRouteLean; // null on a single-surface read
}
export interface LoopFamilyMarket {
  platform: Platform;
  subtitle: string;
  rows: LoopFamilyMarketRow[]; // covered families, sorted by supply-weighted demand
  uncovered: string[]; // loopFamilies values NEITHER surface hit
}
export async function getLoopFamilyMarket(
  db: Querier,
  platform: Platform,
): Promise<LoopFamilyMarket> {
  // A Steam-platform read has one surface: scoring Steam against itself would manufacture a lean.
  const cross = platform !== "steam";
  const [genreRows, splitRows, supply, steamEcon] = await Promise.all([
    // Per-genre spine: distinct games (supply) + median votes (demand).
    db.query(
      `SELECT ${canonSql("l.genre")} AS genre, count(DISTINCT g.id)::int AS supply_n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY l.votes)::float AS appetite
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
       WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
       GROUP BY ${canonSql("l.genre")}`,
    ),
    db.query(gameTagSql(platform, ", max(l.votes)::float AS votes", true), [DEFAULTED_GENRES]),
    genreSupplyTrend(db, platform),
    cross ? steamFamilyEconomics(db) : emptySteamSide(),
  ]);

  // acc.weighted = Σ appetite·supply → a supply-weighted family demand.
  type Acc = { supplyN: number; weighted: number; recent: number; prior: number; genres: string[] };
  const fams = new Map<string, Acc>();
  const blank = (): Acc => ({ supplyN: 0, weighted: 0, recent: 0, prior: 0, genres: [] });
  const add = (fam: string, gen: string, label: string, n: number, app: number, share: number) => {
    const acc = fams.get(fam) ?? blank();
    acc.supplyN += n;
    acc.weighted += app * n;
    acc.recent += (supply.get(gen)?.recent ?? 0) * share;
    acc.prior += (supply.get(gen)?.prior ?? 0) * share;
    acc.genres.push(label);
    fams.set(fam, acc);
  };
  for (const r of genreRows) {
    const family = loopFamilyFor(r.genre);
    if (family) add(family, r.genre, r.genre, num(r.supply_n), num(r.appetite), 1);
  }
  // A grab-bag genre now SPLITS on the tag axis rather than going whole to its dominant tag
  // (#179): each slice is a pseudo-genre — own game count, own median demand — carrying that
  // share of the genre's entrant flow. Assigning Action whole moved 1,117 games' supply and
  // economics onto one family; apportioning them is the same claim, honestly sized.
  const genreN = new Map(genreRows.map((r) => [r.genre, num(r.supply_n)]));
  for (const sl of tagSlices(splitRows))
    add(
      sl.family,
      sl.genre,
      sl.label,
      sl.games.length,
      median(sl.games.map((g) => num(g.votes))),
      sl.games.length / Math.max(1, genreN.get(sl.genre) ?? sl.games.length),
    );
  // A family Steam covers but no browser genre reaches is a ROW, not whitespace — "nobody ships
  // this in the browser" is the cross-platform finding, which no-coverage hid.
  for (const f of steamEcon.econ.keys()) if (!fams.has(f)) fams.set(f, blank());

  const appetiteOf = (a: Acc) => (a.supplyN ? Math.round(a.weighted / a.supplyN) : null);
  const bMed = median([...fams.values()].map(appetiteOf).filter((v): v is number => v != null));
  const sMed = median([...steamEcon.econ.values()].map((s) => s.medianRevenuePerGame));
  const pull = (v: number | null | undefined, m: number) => (v != null && m > 0 ? v / m : null);

  const rows = [...fams.entries()]
    .map(([family, a]) => {
      const steam = steamEcon.econ.get(family) ?? null;
      const steamGenres = steamEcon.genresByFamily.get(family) ?? [];
      const appetite = appetiteOf(a);
      const supplyTrend = classifySupply(Math.round(a.recent), Math.round(a.prior));
      return {
        family,
        supplyN: a.supplyN,
        appetite,
        supplyTrend,
        genres: a.genres.sort(),
        steamGenres,
        steam,
        routeLean: cross
          ? marketRouteLean(pull(appetite, bMed), supplyTrend === "rising", {
              pull: pull(steam?.medianRevenuePerGame, sMed),
              crowding: steam?.supplyTrend === "rising",
              mapped: steamGenres.length > 0,
            })
          : null,
      };
    })
    .sort(
      (x, y) =>
        (y.appetite ?? 0) * y.supplyN - (x.appetite ?? 0) * x.supplyN ||
        (y.steam?.games ?? 0) - (x.steam?.games ?? 0) ||
        x.family.localeCompare(y.family),
    );

  // Contract families NEITHER surface reached — the whitespace signal.
  const covered = new Set(rows.map((r) => r.family));
  const uncovered = CONTRACT.pitch.loopFamilies.filter((f) => !covered.has(f));
  return { platform, subtitle: subtitleFor(platform), rows, uncovered };
}

/** Per-GAME genre + tag rows — the grain the tag axis needs. `skipDefaulted` drops the genres
 *  carrying a default ($1): assigned whole, so their games never need the split. */
function gameTagSql(platform: Platform, cols: string, skipDefaulted: boolean): string {
  const gx = canonSql("l.genre");
  return `SELECT ${gx} AS genre, array_agg(DISTINCT ${canonSql("t.name")}) AS tags${cols}
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     JOIN game_tags gt ON gt.game_id = g.id JOIN tags t ON t.id = gt.tag_id
     WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
       ${skipDefaulted ? `AND lower(${gx}) <> ALL($1::text[])` : ""}
     GROUP BY g.id, ${gx}`;
}

type GameRow = { genre: string; tags: string[] | null } & Record<string, any>;
type Slice = { family: string; genre: string; label: string; games: GameRow[] };

/** The fold, per GAME (#179). Its genre default wins outright; otherwise exactly ONE family among
 *  the game's mapped tags takes it — none or several disagreeing leaves it unassigned, the map's
 *  own ambiguity guard applied a game at a time. Shared by BOTH surfaces: joining them on
 *  families only means anything if both were folded the same way. */
export function tagSlices(rows: GameRow[]): Slice[] {
  const out = new Map<string, Slice>();
  for (const r of rows) {
    const def = loopFamilyFor(r.genre);
    const hits = new Map<string, string>(); // family -> the first tag that produced it
    const tags = Array.isArray(r.tags) ? r.tags : [];
    if (!def) {
      // A tag PAIR (#217) is one more vote under the same guard — never an override.
      for (const [f, pair] of coTagHits(tags)) if (!hits.has(f)) hits.set(f, pair);
      for (const t of tags) {
        const f = loopFamilyFor(r.genre, t);
        if (f && !hits.has(f)) hits.set(f, t);
      }
    }
    const family = def ?? (hits.size === 1 ? [...hits.keys()][0] : null);
    if (!family) continue;
    const label = def ? r.genre : `${r.genre} × ${hits.get(family)}`;
    const s = out.get(`${family}|${label}`) ?? { family, genre: r.genre, label, games: [] };
    s.games.push(r);
    out.set(`${family}|${label}`, s);
  }
  return [...out.values()];
}

// Steam economics per loop family (#67), folded per GAME (#179) so a grab-bag genre splits across
// families on the tag axis without double-counting. Cohort = the other Steam economics surfaces':
// released, non-AAA (inlined, not imported from ./steam.ts: no module cycle) — applied AFTER
// coverage is recorded, so an all-AAA family still reads mapped-but-empty rather than unmapped.
// Returns the economics AND the labels that produced them, which is what separates the two.
type SteamSide = { econ: Map<string, LoopFamilySteam>; genresByFamily: Map<string, string[]> };
const emptySteamSide = (): SteamSide => ({ econ: new Map(), genresByFamily: new Map() });
async function steamFamilyEconomics(db: Querier): Promise<SteamSide> {
  const out: SteamSide = emptySteamSide();
  const [rows, supply] = await Promise.all([
    db.query(
      gameTagSql(
        "steam",
        `, max(l.price_cents)::float AS price_cents, max(l.owners_est)::float AS owners_est,
           max(l.scale_tier) AS scale_tier, bool_or(l.coming_soon) AS coming_soon`,
        false,
      ),
    ),
    genreSupplyTrend(db, "steam"),
  ]);
  const genreN = new Map<string, number>();
  for (const r of rows) genreN.set(r.genre, (genreN.get(r.genre) ?? 0) + 1);
  const flow = new Map<string, { recent: number; prior: number }>();
  const cohort = new Map<string, GameRow[]>();
  for (const sl of tagSlices(rows as GameRow[])) {
    out.genresByFamily.set(
      sl.family,
      [...(out.genresByFamily.get(sl.family) ?? []), sl.label].sort(),
    );
    const f = flow.get(sl.family) ?? { recent: 0, prior: 0 };
    const share = sl.games.length / Math.max(1, genreN.get(sl.genre) ?? sl.games.length);
    f.recent += (supply.get(sl.genre)?.recent ?? 0) * share;
    f.prior += (supply.get(sl.genre)?.prior ?? 0) * share;
    flow.set(sl.family, f);
    const keep = sl.games.filter((g) => g.scale_tier !== "aaa" && g.coming_soon !== true);
    if (keep.length) cohort.set(sl.family, [...(cohort.get(sl.family) ?? []), ...keep]);
  }
  for (const [family, games] of cohort) {
    const f = flow.get(family) ?? { recent: 0, prior: 0 };
    out.econ.set(family, {
      games: games.length,
      medianPriceCents: Math.round(median(games.map((g) => num(g.price_cents)))),
      medianRevenuePerGame: Math.round(
        median(games.map((g) => num(g.owners_est) * num(g.price_cents))) / 100,
      ),
      supplyTrend: classifySupply(Math.round(f.recent), Math.round(f.prior)),
    });
  }
  return out;
}

/** The revenue shape a SEGMENT leans toward: portal-ad/catalogue, premium sale, or neither. */
export type MarketRouteLean = "browser" | "steam" | "contested" | "steam-unmapped" | null;
const LEAN_MARGIN = 1.25; // inside this ratio the surfaces are contested, not decided
const CROWDING_DAMP = 0.8; // a flooding surface is worth less than its raw number claims

/** Market-level route lean (#67), the market companion to the pitch-level compass (PR #66). A
 *  pitch carries two co-equal fit SCORES; a market has no such pair, so each surface is scored
 *  against its OWN cross-family median and only those relative strengths meet — units never mix. A
 *  flooding surface is damped: a family can lead and still be the wrong door if everyone is already
 *  walking through it. One surface absent IS the lean; both absent → null — but only once that
 *  absence has actually been measured (`mapped`, #179). */
export function marketRouteLean(
  bPull: number | null,
  bCrowding: boolean,
  steam: { pull: number | null; crowding: boolean; mapped?: boolean },
): MarketRouteLean {
  const b = bPull == null ? null : bPull * (bCrowding ? CROWDING_DAMP : 1);
  const s = steam.pull == null ? null : steam.pull * (steam.crowding ? CROWDING_DAMP : 1);
  // An empty Steam side means one of two different things, and the panel was reporting both as a
  // browser lean. When no live Steam genre maps into the family, Steam was never MEASURED — a
  // hole in the curated map, not a finding about the market. Only a mapped-but-empty Steam side
  // is the real "nobody sells this on Steam", which genuinely is a browser lean.
  if (s == null && steam.mapped === false) return b == null ? null : "steam-unmapped";
  if (b == null && s == null) return null;
  if (s == null) return "browser";
  if (b == null) return "steam";
  if (b > s * LEAN_MARGIN) return "browser";
  if (s > b * LEAN_MARGIN) return "steam";
  return "contested";
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return !s.length ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function getGenres(db: Querier, platform: Platform): Promise<GenreRow[]> {
  const rows = await db.query(
    `SELECT ${canonSql("l.genre")} AS genre, count(*)::int AS games, avg(l.rating)::float AS avg_rating,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.votes)::float AS med_votes,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY l.votes)::float AS p90_votes,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS p90_rating
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
     GROUP BY ${canonSql("l.genre")} ORDER BY games DESC`,
  );
  const [pds, supply] = await Promise.all([
    genreVotesByDate(db, platform),
    genreSupplyTrend(db, platform),
  ]);
  return rows.map((r) => {
    const sup = supply.get(r.genre);
    // Delta read: is this genre's median-vote series accelerating or fading? A level column seen
    // ten times carries no information — its change does. Per portal, in its unit (#204 S3); on
    // `all` a portal that does not carry the genre is left out rather than shown as "new".
    const momentum = pds
      .map((pd) => genreMomentumRead(pd, r.genre))
      .filter((m) => platform !== "all" || m.captures > 0);
    const solo = platform === "all" ? null : momentum[0];
    return {
      genre: r.genre,
      games: num(r.games),
      avgRating: +num(r.avg_rating).toFixed(2),
      medianVotes: Math.round(num(r.med_votes)),
      p90Votes: Math.round(num(r.p90_votes)),
      p90Rating: +num(r.p90_rating).toFixed(2),
      votesPerDay: solo ? solo.votesPerDay : null,
      trajectory: solo ? solo.trajectory : null,
      momentum,
      supplyTrend: sup?.trend ?? "quiet",
      recentEntrants: sup?.recent ?? 0,
    };
  });
}

export async function getDevelopers(db: Querier, platform: Platform): Promise<DeveloperRow[]> {
  const rows = await db.query(
    `SELECT g.developer AS developer, count(DISTINCT g.id)::int AS games,
            avg(l.rating)::float AS avg_rating, avg(l.votes)::float AS avg_votes,
            mode() WITHIN GROUP (ORDER BY ${canonSql("l.genre")}) AS top_genre
     FROM v_latest l
     JOIN games g ON g.id = l.game_id
     JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND g.developer IS NOT NULL AND g.developer <> '' ${pf(platform)}
     GROUP BY g.developer
     ORDER BY games DESC, avg_rating DESC LIMIT 60`,
  );
  return rows.map((r) => ({
    developer: r.developer,
    games: num(r.games),
    avgRating: +num(r.avg_rating).toFixed(2),
    avgVotes: Math.round(num(r.avg_votes)),
    topGenre: r.top_genre ?? "—",
  }));
}

export async function getNewReleases(db: Querier, platform: Platform): Promise<NewRelease[]> {
  const rows = await db.query(
    `SELECT g.id AS id, g.title AS title, g.url AS url, src.name AS source, ${canonSql("l.genre")} AS genre, l.rating AS rating, l.votes AS votes
     FROM games g JOIN sources src ON src.id = g.source_id JOIN v_latest l ON l.game_id = g.id
     WHERE g.is_live ${pf(platform)} AND g.first_seen_at >= ${newAnchor(platform)} - interval '14 days'
     ORDER BY g.first_seen_at DESC, l.votes DESC NULLS LAST LIMIT 60`,
  );
  // Per-title vote series over the same new-release cohort → age-adjusted votes/day +
  // trajectory, so two titles with equal cumulative votes but different momentum diverge.
  const series = await db.query(
    `SELECT s.game_id AS id, s.captured_at AS d, max(s.votes) AS votes
     FROM game_snapshots s JOIN games g ON g.id = s.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live ${pf(platform)} AND g.first_seen_at >= ${newAnchor(platform)} - interval '14 days'
       AND s.votes IS NOT NULL
     GROUP BY s.game_id, s.captured_at ORDER BY s.game_id, s.captured_at`,
  );
  const byId = groupCaptures(series);
  return rows.map((r) => ({
    gameId: num(r.id),
    title: r.title,
    genre: r.genre ?? "—",
    rating: num(r.rating),
    votes: num(r.votes),
    url: r.url,
    ...momentumOf(r.source, byId.get(num(r.id))),
  }));
}

export async function getInsights(
  db: Querier,
  platform: Platform,
  deps?: {
    pds?: PortalGenreDates[];
    gaps?: MarketGap[];
    landscape?: GenreLandscapePoint[];
    gems?: HiddenGem[];
  },
): Promise<Insight[]> {
  const pds = deps?.pds ?? (await genreVotesByDate(db, platform));
  const out: Insight[] = [];
  // Every insight carries an implication — the decision clause. An observation without
  // "so what" is chart furniture; the read is what the user came for.
  // (1) Rising genre, per portal in its own unit (#204 S3). On `all` each portal gets its own
  // insight naming it; a window portal's leader is only called rising when its engagement grew.
  for (const pd of pds) {
    const ranked = pd.order
      .map((genre) => ({ genre, v: moverRank(pd, genre) }))
      .filter((x): x is { genre: string; v: number } => x.v != null);
    if (!ranked.length) continue;
    const top = ranked.reduce((best, cur) => (cur.v > best.v ? cur : best), ranked[0]);
    const win = pd.voteBasis === "window";
    if (win && !(top.v > 0)) continue;
    const on = platform === "all" ? `On ${portalName(pd.source)}, ` : "";
    out.push({
      kind: "up",
      tag: "RISING",
      meta:
        (platform === "all" ? `${portalName(pd.source)} · ` : "") +
        (win ? `+${top.v.toFixed(1)}%/wk recent engagement` : `+${Math.round(top.v)} votes/day`),
      text: win
        ? `${on}<b>${top.genre}</b> shows the strongest growth in recent engagement across the window.`
        : `${on}<b>${top.genre}</b> is gaining the most votes/day across the window.`,
      implication: `demand is shifting toward ${top.genre} — weight new loop tests accordingly`,
    });
  }
  // (2) Top opportunity gap
  const gaps = deps?.gaps ?? (await getMarketGaps(db, platform));
  if (gaps.length)
    out.push({
      kind: "gap",
      tag: "OPPORTUNITY",
      meta: `${gaps[0].supplyN} games · ${gaps[0].appetite} median votes`,
      text: `<b>${gaps[0].label}</b> shows high demand with thin supply.`,
      implication:
        "underserved — a fast browser loop test here meets demand with little competition",
    });
  // (3) Hidden-gems count
  const gems = deps?.gems ?? (await getHiddenGems(db, platform));
  if (gems.length) {
    // The honest reading (#176): this list is "quality discovery missed", NOT evidence of an
    // underserved market — the browser panel has no revenue axis to make a demand claim on.
    // Splitting on momentum is what makes it actionable: a gem still accreting votes is being
    // found late, a flat one has stopped being found at all.
    // Read in each row's own unit (#204): a CrazyGames gem whose engagement window is shrinking is
    // not climbing, and its null votes/day must not be mistaken for a measured zero.
    const climbing = gems.filter(
      (g) =>
        ((g.voteBasis === "window" ? g.engagementPctPerWeek : g.votesPerDay) ?? 0) > 0 &&
        g.trajectory !== "decaying",
    );
    const live = climbing.length;
    // The wording follows the unit (#204 S2): a window portal's falling count is fading engagement,
    // not a stalled total, so "gaining votes" is only said of running-total rows. Mixed lists name
    // the split rather than pooling two units under one verb.
    const liveWindow = climbing.filter((g) => g.voteBasis === "window").length;
    const bases = new Set(gems.map((g) => g.voteBasis));
    const rest =
      bases.size > 1
        ? `are still climbing (${live - liveWindow} gaining votes, ${liveWindow} with growing recent engagement), the rest are flat or fading`
        : bases.has("window")
          ? "still show growing recent engagement, the rest are flat or fading"
          : "are still gaining votes, the rest have stalled";
    out.push({
      kind: "gem",
      tag: "HIDDEN GEMS",
      meta: `${gems.length} found · ${live} still climbing`,
      text: `<b>${gems.length} well-rated games</b> sit in the top 25% on rating with low vote volume — <b>${live}</b> ${rest}.`,
      implication:
        "quality discovery missed — study the ones still climbing for what earns attention late, and treat the flat ones as a warning that good doesn't get found on its own",
    });
  }
  // (4) Optional highest-quality genre by P75 rating
  const landscape = deps?.landscape ?? (await getGenreLandscape(db, platform));
  if (landscape.length) {
    const best = landscape.reduce((b, c) => (c.p75Rating > b.p75Rating ? c : b), landscape[0]);
    out.push({
      kind: "up",
      tag: "TOP QUALITY",
      meta: `P75 rating ${best.p75Rating.toFixed(2)}`,
      text: `<b>${best.genre}</b> has the highest P75 rating across all genres.`,
      implication: `players reward polish in ${best.genre} — the quality bar to clear is high`,
    });
  }
  return out;
}

// ── "This week's read" — the decision layer (§9 Phase A of the 5-factor evaluation) ──
// Up to 3 computed, decision-framed sentences shown above the charts. Each line ends
// with a "→ implication" clause so the strip answers "so what?", not just "what".
// SQL computes the numbers; only the phrasing is templated (same anti-hallucination
// stance as getInsights).

/** Share of a genre's live catalog that arrived in the last 14 days — supply pressure. */
async function genreSupplyPressure(
  db: Querier,
  platform: Platform,
): Promise<{ genre: string; total: number; recent: number }[]> {
  const rows = await db.query(
    `SELECT ${canonSql("l.genre")} AS genre, count(*)::int AS total,
            count(*) FILTER (
              WHERE g.first_seen_at >= ${newAnchor(platform)} - interval '14 days'
            )::int AS recent
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
     GROUP BY ${canonSql("l.genre")} HAVING count(*) >= 4`,
  );
  return rows.map((r) => ({ genre: r.genre, total: num(r.total), recent: num(r.recent) }));
}

// Crowding thresholds: a warning needs both a real share (≥15% of the catalog is new)
// and a real count (≥3 titles) so tiny genres don't cry wolf off one release.
const PRESSURE_MIN_SHARE = 0.15;
const PRESSURE_MIN_RECENT = 3;

/** Pure composition — exported for tests. May contain <b>; rendered like insights. */
export function composeBrowserRead(args: {
  gap?: MarketGap;
  // One strongest mover per portal, `v` raw in that portal's unit (#204 S3). `byPortal` (the `all`
  // view) names each portal in one line; movers are listed side by side, never ranked across bases.
  movers?: Mover[];
  byPortal?: boolean;
  pressure: { genre: string; total: number; recent: number }[];
}): string[] {
  const lines: string[] = [];
  if (args.gap) {
    lines.push(
      `<b>${args.gap.label}</b> is the top gap — ${args.gap.appetite.toLocaleString("en-US")} median votes across only ${args.gap.supplyN} games. → Underserved: the strongest candidate for a quick browser loop test.`,
    );
  }
  const up = (args.movers ?? []).filter((m) => m.v > 0);
  const rate = (m: Mover) =>
    m.voteBasis === "window"
      ? `+${m.v.toFixed(1)}%/wk in recent engagement`
      : `+${Math.round(m.v)} votes/day`;
  const tone = (m: Mover) =>
    m.voteBasis === "window"
      ? m.trajectory === "rising"
        ? "and climbing"
        : "but not yet a trend"
      : m.trajectory === "rising"
        ? "and accelerating"
        : m.trajectory === "decaying"
          ? "but slowing"
          : "holding steady";
  if (!args.byPortal && up[0]) {
    lines.push(
      `<b>${up[0].genre}</b> is the biggest mover at ${rate(up[0])} ${tone(up[0])}. → Demand is shifting toward it — weight new pitches accordingly.`,
    );
  } else if (args.byPortal && up.length) {
    const each = up.map(
      (m) => `${portalName(m.source)}: <b>${m.genre}</b> at ${rate(m)} ${tone(m)}`,
    );
    lines.push(
      `Biggest movers, each in its portal's own unit — ${each.join("; ")}. → Demand is shifting toward ${up.length > 1 ? "them" : "it"} — weight new pitches accordingly.`,
    );
  }
  const crowding = args.pressure
    .filter((p) => p.recent >= PRESSURE_MIN_RECENT && p.recent / p.total >= PRESSURE_MIN_SHARE)
    .sort((a, b) => b.recent / b.total - a.recent / a.total)[0];
  lines.push(
    crowding
      ? `Supply warning: <b>${crowding.genre}</b> added ${crowding.recent} titles in 14 days (${Math.round((crowding.recent / crowding.total) * 100)}% of its catalog). → Crowding fast — a new entry needs a sharp differentiator.`
      : `No genre shows unusual supply pressure this window. → No crowding warning — pick on demand, not scarcity.`,
  );
  return lines;
}

async function getKPI(
  db: Querier,
  platform: Platform,
  gaps: MarketGap[],
  rising: RisingGenre[],
): Promise<OverviewKPI> {
  const g = await db.query(
    `SELECT count(*)::int AS n FROM games g JOIN sources src ON src.id = g.source_id WHERE g.is_live ${pf(platform)}`,
  );
  const avg = await db.query(
    `SELECT avg(l.rating)::float AS r FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id WHERE g.is_live ${pf(platform)}`,
  );
  const newGames = await db.query(
    `SELECT count(*)::int AS n FROM games g JOIN sources src ON src.id = g.source_id
     WHERE g.is_live ${pf(platform)} AND g.first_seen_at >= ${newAnchor(platform)} - interval '14 days'`,
  );
  // Single portal: its mover as the shorthand ("—" / 0 when none, as before). `all`: none — the
  // per-portal list is the read (#204 S3).
  const solo = platform === "all" ? null : rising[0];
  const soloRate = solo ? solo.votesPerDay : voteBasisOf(platform) === "window" ? null : 0;
  const p90 = await db.query(
    `SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS p FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id WHERE g.is_live AND l.rating IS NOT NULL ${pf(platform)}`,
  );
  return {
    gamesTracked: num(g[0].n),
    newGames: num(newGames[0].n),
    avgRating: +num(avg[0].r).toFixed(2),
    avgRatingP90: +num(p90[0].p).toFixed(2),
    risingGenre: platform === "all" ? null : (solo?.genre ?? "—"),
    risingVotesPerDay: platform === "all" ? null : soloRate,
    risingByPortal: rising,
    openGaps: gaps.filter((c) => c.score > 0).length,
  };
}

async function genreExamples(db: Querier, platform: Platform): Promise<Map<string, string[]>> {
  const rows = await db.query(
    `SELECT genre, title FROM (
       SELECT ${canonSql("l.genre")} AS genre, g.title AS title,
              row_number() OVER (PARTITION BY ${canonSql("l.genre")} ORDER BY l.votes DESC NULLS LAST) AS rn
       FROM v_latest l JOIN games g ON g.id=l.game_id JOIN sources src ON src.id=g.source_id
       WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
     ) t WHERE rn <= 3 ORDER BY genre, rn`,
  );
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const a = m.get(r.genre) ?? [];
    a.push(r.title);
    m.set(r.genre, a);
  }
  return m;
}

async function gapExamples(db: Querier, platform: Platform): Promise<Map<string, string[]>> {
  const rows = await db.query(
    `SELECT genre, tag, title FROM (
       SELECT ${canonSql("l.genre")} AS genre, ${canonSql("t.name")} AS tag, g.title AS title,
              row_number() OVER (PARTITION BY ${canonSql("l.genre")}, ${canonSql("t.name")} ORDER BY l.votes DESC NULLS LAST) AS rn
       FROM v_latest l JOIN games g ON g.id=l.game_id JOIN sources src ON src.id=g.source_id
       JOIN game_tags gt ON gt.game_id=g.id JOIN tags t ON t.id=gt.tag_id
       WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
     ) x WHERE rn <= 3 ORDER BY genre, tag, rn`,
  );
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const k = `${r.genre} × ${r.tag}`;
    const a = m.get(k) ?? [];
    a.push(r.title);
    m.set(k, a);
  }
  return m;
}

/** Top-12 genre bars per portal, each group ranked on its own unit (#204 S3). A window genre with
 *  no measurable change has no bar rather than a zero one. */
export async function getGenreVelocityBars(
  db: Querier,
  platform: Platform,
  pds?: PortalGenreDates[],
  vols?: Map<string, Map<string, number>>,
): Promise<GenreVelocityBar[]> {
  pds ??= await genreVotesByDate(db, platform);
  const counts = vols ?? (await genreCounts(db, platform));
  const value = (b: GenreVelocityBar) =>
    b.voteBasis === "window" ? b.engagementPctPerWeek : b.votesPerDay;
  return pds.flatMap((pd) => {
    const vol = counts.get(pd.source) ?? new Map<string, number>();
    return pd.order
      .filter((g) => (vol.get(g) ?? 0) >= GENRE_MIN_VOL)
      .map((genre) => {
        const { source, voteBasis, votesPerDay, engagementPctPerWeek } = genreMomentumRead(
          pd,
          genre,
        );
        return { genre, source, voteBasis, votesPerDay, engagementPctPerWeek };
      })
      .filter((b) => value(b) != null)
      .sort((a, b) => value(b)! - value(a)!)
      .slice(0, 12);
  });
}

export async function getGenreLandscape(
  db: Querier,
  platform: Platform,
): Promise<GenreLandscapePoint[]> {
  const [rows, ex] = await Promise.all([
    db.query(
      `SELECT ${canonSql("l.genre")} AS genre, count(*)::int AS supply,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY l.rating)::float AS p75,
              avg(l.rating)::float AS avgr, coalesce(sum(l.votes),0)::float AS tv
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
       WHERE g.is_live AND l.genre IS NOT NULL AND l.rating IS NOT NULL ${pf(platform)}
       GROUP BY ${canonSql("l.genre")} HAVING count(*) >= 4 ORDER BY supply DESC`,
    ),
    genreExamples(db, platform),
  ]);
  return rows.map((r) => ({
    genre: r.genre,
    supply: num(r.supply),
    p75Rating: +num(r.p75).toFixed(2),
    avgRating: +num(r.avgr).toFixed(2),
    totalVotes: Math.round(num(r.tv)),
    examples: ex.get(r.genre) ?? [],
  }));
}

// Demand vs. Supply quadrant (B3 / R1.2). One point per genre with enough titles to read:
// x = supply, y = appetite (demand), bubble = commercial weight, colour = supply momentum.
export async function getGenreQuadrant(db: Querier, platform: Platform): Promise<QuadrantPoint[]> {
  const supply = await genreSupplyTrend(db, platform);
  const rows = await db.query(
    `SELECT ${canonSql("l.genre")} AS genre, count(*)::int AS supply,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.votes)::float AS appetite,
            coalesce(sum(l.votes), 0)::float AS weight
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL AND l.votes IS NOT NULL ${pf(platform)}
     GROUP BY ${canonSql("l.genre")} HAVING count(*) >= 4`,
  );
  return rows.map((r) => ({
    genre: r.genre,
    supply: num(r.supply),
    appetite: Math.round(num(r.appetite)),
    weight: Math.round(num(r.weight)),
    supplyTrend: supply.get(r.genre)?.trend ?? "quiet",
  }));
}

async function getTagGlossary(
  db: Querier,
  platform: Platform,
  tagNames: string[],
): Promise<GlossaryRow[]> {
  if (!tagNames.length) return [];
  const ph = tagNames.map((_, i) => `$${i + 1}`).join(",");
  const rows = await db.query(
    `SELECT tag, title, cnt FROM (
       SELECT ${canonSql("t.name")} AS tag, gg.title AS title,
              row_number() OVER (PARTITION BY ${canonSql("t.name")} ORDER BY l.votes DESC NULLS LAST) AS rn,
              count(*) OVER (PARTITION BY ${canonSql("t.name")}) AS cnt
       FROM tags t
       JOIN game_tags gt ON gt.tag_id = t.id
       JOIN games gg ON gg.id = gt.game_id
       JOIN sources src ON src.id = gg.source_id
       JOIN v_latest l ON l.game_id = gg.id
       WHERE gg.is_live AND ${canonSql("t.name")} IN (${ph}) ${pf(platform)}
     ) x WHERE rn <= 3 ORDER BY tag, rn`,
    tagNames,
  );
  const m = new Map<string, { count: number; examples: string[] }>();
  for (const r of rows) {
    const e = m.get(r.tag) ?? { count: num(r.cnt), examples: [] };
    e.examples.push(r.title);
    m.set(r.tag, e);
  }
  // preserve the requested order
  return tagNames
    .filter((t) => m.has(t))
    .map((label) => ({
      label,
      kind: "tag" as const,
      count: m.get(label)!.count,
      examples: m.get(label)!.examples,
      definition: defineTag(label),
    }));
}

export async function getOverview(db: Querier, platform: Platform): Promise<Overview> {
  const [pds, vols, gemRows, tags, heatmap, gapsRanked, landscape, quadrant, pressure, settings] =
    await Promise.all([
      genreVotesByDate(db, platform),
      genreCounts(db, platform),
      gemBase(db, platform),
      getTagFrequency(db, platform),
      getFeatureHeatmap(db, platform),
      rankMarketGaps(db, platform),
      getGenreLandscape(db, platform),
      getGenreQuadrant(db, platform),
      genreSupplyPressure(db, platform),
      getSettingFacets(db, platform),
    ]);
  const gaps = gapsRanked.slice(0, GAPS_TOP_N);
  const scatter = await getScatter(db, platform, gemRows);
  const gems = await getHiddenGems(db, platform, gemRows);
  const momentum = await getGenreMomentum(db, platform, pds);
  const velocityBars = await getGenreVelocityBars(db, platform, pds, vols);
  const insights = await getInsights(db, platform, { pds, gaps, landscape, gems });
  // Biggest mover per portal (KPI + read): the strongest genre with enough volume to matter.
  const movers = pds.flatMap((pd) => topMover(pd, vols.get(pd.source) ?? new Map()) ?? []);
  const kpi = await getKPI(
    db,
    platform,
    gaps,
    movers.map((m) => m.rising),
  );
  const tagNames = [...new Set([...gaps.map((g) => g.tag), ...tags.map((t) => t.tag)])];
  const glossary: GlossaryRow[] = await getTagGlossary(db, platform, tagNames);
  const read = composeBrowserRead({
    gap: gaps[0],
    movers: movers.map((m) => m.mover),
    byPortal: platform === "all",
    pressure,
  });
  return {
    kpi,
    read,
    momentum,
    tags,
    scatter,
    heatmap,
    gaps,
    // Read over the FULL ranked set with the cut passed in, so `applied` means "this flag found
    // a market" and a match that landed below the cut is named with its rank instead of being
    // reported as no match at all (#167) — the same wiring as getSteamOverview.
    steering: steeringLens((await getBriefSteering(db)).flags, gapsRanked, GAPS_TOP_N),
    insights,
    landscape,
    quadrant,
    velocityBars,
    glossary,
    settings,
    platform,
    subtitle: subtitleFor(platform),
  };
}
