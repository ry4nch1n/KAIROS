// Analytics queries — chart-ready shapes. All accept a Querier (DI) + platform.
import type { Querier } from "../db/db.ts";
import type {
  Platform, Overview, OverviewKPI, GenreMomentum, TagFreq, ScatterPoint,
  HiddenGem, MarketGap, FeatureHeatmap, Insight, BriefEditionMeta, BriefEdition,
  GenreRow, DeveloperRow, NewRelease, GenreLandscapePoint, GenreVelocityBar, GlossaryRow, BriefSteering,
  ScaleTierRow, SteamGenreEconomics, SteamCohort, SteamComparable, SteamOverview,
  SteamGap, SteamPriceBand, SteamOwnershipRow, SteamDeveloperRow, SteamNewRelease,
  Pitch, PitchInput,
} from "shared";
import { assertPitchInput, validateBriefPayload } from "shared";

const fmtDate = (d: any) => new Date(d).toISOString().slice(5, 10); // "MM-DD"

// Short, plain-language definitions for browser-game tags shown in the glossary.
// Keyed by lowercased tag name. Anything missing falls back to an inferred guess.
const TAG_DEFINITIONS: Record<string, string> = {
  "action": "Fast-paced games built on reflexes and real-time challenge.",
  "action games": "Fast-paced games built on reflexes and real-time challenge.",
  "adventure": "Exploration- and story-driven games.",
  "arcade": "Simple, score-chasing games with a classic arcade feel.",
  "racing": "Race-to-the-finish driving competition games.",
  "driving": "Vehicle-driving games (racing, parking, stunts).",
  "car": "Car-themed driving games.",
  "car games": "Car-themed driving games.",
  "bike": "Motorbike/bicycle riding and stunt games.",
  "truck": "Truck-driving and hauling games.",
  "parking": "Precision vehicle-parking challenge games.",
  "drift": "Drift-focused driving games.",
  "shooting": "Games centered on aiming and shooting.",
  "shooter": "Games centered on aiming and shooting.",
  "sniper": "Long-range precision shooting games.",
  "gun": "Firearm-based shooting games.",
  "puzzle": "Games about solving logic or spatial challenges.",
  "strategy": "Games rewarding planning, tactics, and resource management.",
  "tower defense": "Defend a path by placing defensive towers against waves.",
  "sports": "Games simulating real-world sports.",
  "soccer": "Football/soccer sports games.",
  "football": "Football sports games.",
  "basketball": "Basketball sports games.",
  "pool": "Pool/billiards cue-sports games.",
  "billiards": "Billiards/pool cue-sports games.",
  "golf": "Golf sports games.",
  "simulation": "Games that model a real-world activity or system.",
  "simulator": "Games that simulate operating a vehicle, job, or system.",
  "idle": "Incremental games that progress with minimal, often automated, input.",
  "clicker": "Tap/click games where repeated clicks drive progression.",
  "io": "Massively-multiplayer browser arena games in the '.io' style.",
  ".io": "Massively-multiplayer browser arena games in the '.io' style (e.g. Agar.io).",
  "horror": "Scary, tense, atmosphere-driven games.",
  "zombie": "Zombie-survival and shooting games.",
  "multiplayer": "Games played with or against other people online.",
  "2 player": "Games for two players sharing one device or playing online.",
  "two player": "Games for two players sharing one device or playing online.",
  "casual": "Easy-to-pick-up games with light, low-commitment sessions.",
  "board": "Digital versions of board games (chess, checkers, ludo).",
  "card": "Card-based games (solitaire, matching, collectible).",
  "mahjong": "Tile-matching games in the mahjong tradition.",
  "cooking": "Time-management games themed around cooking and food service.",
  "restaurant": "Restaurant-management time-management games.",
  "beauty": "Dress-up, makeover, and styling games.",
  "dress up": "Outfit and styling games.",
  "merge": "Games built around combining items to upgrade them.",
  "match 3": "Swap-and-match three-or-more puzzle games.",
  "bubble shooter": "Aim-and-pop bubble-matching games.",
  "platform": "Jump-and-run platforming games.",
  "runner": "Endless-runner games focused on dodging and timing.",
  "running": "Auto-run / endless-runner games focused on dodging and timing.",
  "running games": "Auto-run / endless-runner games focused on dodging and timing.",
  "stickman": "Games starring stick-figure characters.",
  "fighting": "One-on-one combat/brawler games.",
  "brain": "Puzzle/logic games that test memory, reasoning, or math.",
  "brain games": "Puzzle/logic games that test memory, reasoning, or math.",
  "number": "Math and number-based puzzle games.",
  "number games": "Math and number-based puzzle games.",
  "math": "Arithmetic and math-practice games.",
  "word": "Word, spelling, and vocabulary games.",
  "typing": "Keyboard typing-skill games.",
  "mouse": "Games controlled mainly with the mouse (point-click / aim).",
  "mouse games": "Games controlled mainly with the mouse (point-click / aim).",
  "music": "Rhythm and music-timing games.",
  "physics": "Games whose challenge comes from realistic physics.",
  "pixel": "Games with a retro pixel-art aesthetic.",
  "retro": "Games with a retro/old-school aesthetic.",
  "3d": "Games rendered with 3D graphics.",
  "3d games": "Games rendered with 3D graphics.",
  "2d": "Games with flat, two-dimensional graphics.",
  "flash": "Legacy Flash-style games (now HTML5), usually simple arcade titles.",
  "html5": "Games built in HTML5 to run natively in the browser.",
  "mobile": "Touch-friendly games that also play well on phones/tablets.",
  "mobile games": "Touch-friendly games that also play well on phones/tablets.",
  "girls": "Audience label for dress-up, care, and casual games aimed at girls.",
  "kids": "Games aimed at younger children.",
  "educational": "Learning-focused games.",
  "skill": "Games that reward dexterity and precise timing.",
  "ball": "Ball-physics and ball-control games.",
  "snake": "Snake-style grow-and-avoid games.",
  "tank": "Tank combat games.",
  "war": "Warfare-themed combat games.",
  "farm": "Farming and harvest management games.",
  "fishing": "Fishing-themed games.",
  "escape": "Room-escape puzzle games.",
  "hidden object": "Find-the-hidden-item search games.",
  "jigsaw": "Jigsaw-puzzle assembly games.",
  "solitaire": "Single-player card-sorting games.",
  // Platform curation / brand tags (not gameplay genres) — described honestly:
  "popular": "A platform curation label for trending/most-played titles — not a gameplay genre.",
  "popular games": "A platform curation label for trending/most-played titles — not a gameplay genre.",
  "new": "A platform curation label for recently added titles — not a gameplay genre.",
  "new games": "A platform curation label for recently added titles — not a gameplay genre.",
  "trending": "A platform curation label for currently-rising titles — not a gameplay genre.",
  "hot": "A platform curation label for currently-popular titles — not a gameplay genre.",
  "featured": "A platform curation label for editorially highlighted titles — not a gameplay genre.",
  "crazygames": "A platform/brand tag (CrazyGames) — not a gameplay descriptor.",
  "crazy games": "A platform/brand tag (CrazyGames) — not a gameplay descriptor.",
  "poki": "A platform/brand tag (Poki) — not a gameplay descriptor.",
  "fun": "A broad catch-all label with no specific gameplay meaning.",
};

function defineTag(name: string): string {
  const d = TAG_DEFINITIONS[name.toLowerCase().trim()];
  if (d) return d;
  const base = name.replace(/\s*games?$/i, "").trim();
  return base
    ? `Games themed around or tagged "${base}" (inferred — not a formally defined category).`
    : `A platform tag with no formal definition (inferred).`;
}

interface GenreDates { dates: string[]; order: string[]; byGenre: Record<string, number[]>; daySpan: number; }
async function genreVotesByDate(db: Querier, platform: Platform): Promise<GenreDates> {
  const rows = await db.query(
    `SELECT s.genre AS genre, s.captured_at AS d,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY s.votes) AS med
     FROM game_snapshots s
     JOIN games g ON g.id = s.game_id
     JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND s.votes IS NOT NULL AND s.genre IS NOT NULL ${pf(platform)}
     GROUP BY s.genre, s.captured_at`
  );
  const times = [...new Set(rows.map((r) => new Date(r.d).getTime()))].sort((a, b) => a - b);
  const idx = new Map(times.map((t, i) => [t, i]));
  const dates = times.map((t) => fmtDate(t));
  const daySpan = times.length > 1 ? (times[times.length - 1] - times[0]) / 86400000 : 0;
  const byGenre: Record<string, number[]> = {};
  const totalVotes: Record<string, number> = {};
  for (const r of rows) {
    const g = r.genre as string;
    if (!byGenre[g]) byGenre[g] = new Array(times.length).fill(0);
    byGenre[g][idx.get(new Date(r.d).getTime())!] = num(r.med);
    totalVotes[g] = (totalVotes[g] ?? 0) + num(r.med);
  }
  const order = Object.keys(byGenre).sort((a, b) => totalVotes[b] - totalVotes[a]);
  return { dates, order, byGenre, daySpan };
}

async function genreCounts(db: Querier, platform: Platform): Promise<Map<string, number>> {
  const rows = await db.query(
    `SELECT l.genre AS genre, count(*)::int AS n FROM v_latest l JOIN games g ON g.id=l.game_id JOIN sources src ON src.id=g.source_id WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)} GROUP BY l.genre`
  );
  return new Map(rows.map((r) => [r.genre, num(r.n)]));
}

// velocity = (last - first) / spanDays, guarded for <2 points or zero span
function velocity(values: number[], daySpan: number): number {
  if (values.length < 2 || daySpan <= 0) return 0;
  const first = values[0], last = values[values.length - 1];
  return (last - first) / daySpan;
}

function pf(platform: Platform): string {
  if (platform === "poki") return "AND src.name = 'poki'";
  if (platform === "crazygames") return "AND src.name = 'crazygames'";
  if (platform === "steam") return "AND src.name = 'steam'";
  // "all" = all BROWSER platforms only. Steam is an asymmetric surface (its own view,
  // different metric semantics + crawl cadence) and must never feed browser analytics —
  // mixing it corrupts vote-velocity/momentum via cross-source date misalignment.
  return "AND src.name IN ('poki','crazygames')";
}
function subtitleFor(platform: Platform): string {
  if (platform === "poki") return "Poki · last 90 days";
  if (platform === "crazygames") return "CrazyGames · last 90 days";
  if (platform === "steam") return "Steam (PC) · last 90 days";
  return "Poki + CrazyGames · last 90 days";
}
const num = (v: any) => (v === null || v === undefined ? 0 : Number(v));

export async function getGenreMomentum(db: Querier, platform: Platform, gd?: GenreDates): Promise<GenreMomentum> {
  gd ??= await genreVotesByDate(db, platform);
  const top = gd.order.slice(0, 4);
  return { dates: gd.dates, series: top.map((genre) => ({ genre, values: gd.byGenre[genre] })) };
}

const RATING_BANDS = ["<3.5", "3.5–4.0", "4.0–4.4", "4.4–4.7", "≥4.7"];
function bandIndex(r: number): number { return r < 3.5 ? 0 : r < 4.0 ? 1 : r < 4.4 ? 2 : r < 4.7 ? 3 : 4; }

export async function getFeatureHeatmap(db: Querier, platform: Platform): Promise<FeatureHeatmap> {
  const rows = await db.query(
    `SELECT l.genre AS genre, l.rating AS rating, count(*)::int AS n
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL AND l.rating IS NOT NULL ${pf(platform)}
     GROUP BY l.genre, l.rating`
  );
  const totals: Record<string, number> = {};
  for (const r of rows) totals[r.genre] = (totals[r.genre] ?? 0) + num(r.n);
  const genres = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 7);
  const gi = new Map(genres.map((g, i) => [g, i]));
  const cells = genres.flatMap((_, g) => RATING_BANDS.map((_, w) => ({ genreIndex: g, week: w, value: 0 })));
  const at = (g: number, w: number) => cells[g * RATING_BANDS.length + w];
  for (const r of rows) { if (!gi.has(r.genre)) continue; at(gi.get(r.genre)!, bandIndex(num(r.rating))).value += num(r.n); }
  return { weeks: RATING_BANDS, genres, cells };
}

export async function getTagFrequency(db: Querier, platform: Platform): Promise<TagFreq[]> {
  const rows = await db.query(
    `SELECT t.name AS tag, count(DISTINCT g.id)::int AS cnt
     FROM tags t
     JOIN game_tags gt ON gt.tag_id = t.id
     JOIN games g ON g.id = gt.game_id
     JOIN sources src ON src.id = g.source_id
     WHERE g.is_live ${pf(platform)}
     GROUP BY t.name ORDER BY cnt DESC LIMIT 12`
  );
  return rows.map((r) => ({ tag: r.tag, count: num(r.cnt) }));
}

const GEM_RATING_PCTILE = 0.75, GEM_VOTES_PCTILE = 0.25;

async function gemBase(db: Querier, platform: Platform) {
  return db.query(
    `WITH base AS (
       SELECT g.id, g.title, l.genre, l.rating, l.votes,
              percent_rank() OVER (ORDER BY l.rating) AS rp,
              percent_rank() OVER (ORDER BY l.votes)  AS vp
       FROM v_latest l
       JOIN games g ON g.id = l.game_id
       JOIN sources src ON src.id = g.source_id
       WHERE g.is_live AND l.rating IS NOT NULL AND l.votes IS NOT NULL ${pf(platform)}
     )
     SELECT id, title, genre, rating, votes, rp, vp,
            (rp >= ${GEM_RATING_PCTILE} AND vp <= ${GEM_VOTES_PCTILE}) AS gem
     FROM base`
  );
}

export async function getScatter(db: Querier, platform: Platform, rows?: Record<string, any>[]): Promise<ScatterPoint[]> {
  rows ??= await gemBase(db, platform);
  return rows.map((r) => ({ title: r.title, genre: r.genre ?? "—", rating: num(r.rating), votes: num(r.votes), gem: !!r.gem }));
}

export async function getHiddenGems(db: Querier, platform: Platform, rows?: Record<string, any>[]): Promise<HiddenGem[]> {
  rows ??= await gemBase(db, platform);
  return rows
    .filter((r) => r.gem)
    .sort((a, b) => (num(b.rp) - num(b.vp)) - (num(a.rp) - num(a.vp)))
    .slice(0, 30)
    .map((r) => ({ gameId: num(r.id), title: r.title, rating: num(r.rating), votes: num(r.votes), genre: r.genre ?? "—" }));
}

export async function getMarketGaps(db: Querier, platform: Platform): Promise<MarketGap[]> {
  const [rows, gex] = await Promise.all([
    db.query(
      `SELECT l.genre AS genre, t.name AS tag,
              count(DISTINCT g.id)::int AS supply_n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY l.votes)::float AS appetite,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS quality_ceil
       FROM v_latest l
       JOIN games g ON g.id = l.game_id
       JOIN sources src ON src.id = g.source_id
       JOIN game_tags gt ON gt.game_id = g.id
       JOIN tags t ON t.id = gt.tag_id
       WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
       GROUP BY l.genre, t.name
       HAVING count(DISTINCT g.id) >= 2`
    ),
    gapExamples(db, platform),
  ]);
  if (rows.length < 2) return [];
  const z = (vals: number[]) => { const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    return (v: number) => (v - m) / sd; };
  const zApp = z(rows.map((r) => num(r.appetite)));
  const zSup = z(rows.map((r) => num(r.supply_n)));
  const zQual = z(rows.map((r) => num(r.quality_ceil)));
  return rows
    .map((r) => ({
      label: `${r.genre} × ${r.tag}`,
      genre: r.genre,
      tag: r.tag,
      supplyN: num(r.supply_n),
      appetite: Math.round(num(r.appetite)),
      qualityCeil: +num(r.quality_ceil).toFixed(2),
      score: +(zApp(num(r.appetite)) + zQual(num(r.quality_ceil)) - zSup(num(r.supply_n))).toFixed(2),
      examples: gex.get(`${r.genre} × ${r.tag}`) ?? [],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export async function getGenres(db: Querier, platform: Platform): Promise<GenreRow[]> {
  const rows = await db.query(
    `SELECT l.genre AS genre, count(*)::int AS games, avg(l.rating)::float AS avg_rating,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.votes)::float AS med_votes,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY l.votes)::float AS p90_votes,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS p90_rating
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
     GROUP BY l.genre ORDER BY games DESC`
  );
  const gd = await genreVotesByDate(db, platform);
  return rows.map((r) => ({
    genre: r.genre, games: num(r.games), avgRating: +num(r.avg_rating).toFixed(2),
    medianVotes: Math.round(num(r.med_votes)), p90Votes: Math.round(num(r.p90_votes)),
    p90Rating: +num(r.p90_rating).toFixed(2),
    votesPerDay: gd.byGenre[r.genre] ? Math.round(velocity(gd.byGenre[r.genre], gd.daySpan)) : 0,
  }));
}

export async function getDevelopers(db: Querier, platform: Platform): Promise<DeveloperRow[]> {
  const rows = await db.query(
    `SELECT g.developer AS developer, count(DISTINCT g.id)::int AS games,
            avg(l.rating)::float AS avg_rating, avg(l.votes)::float AS avg_votes,
            mode() WITHIN GROUP (ORDER BY l.genre) AS top_genre
     FROM v_latest l
     JOIN games g ON g.id = l.game_id
     JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND g.developer IS NOT NULL AND g.developer <> '' ${pf(platform)}
     GROUP BY g.developer
     ORDER BY games DESC, avg_rating DESC LIMIT 60`
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
    `SELECT g.id AS id, g.title AS title, g.url AS url, l.genre AS genre, l.rating AS rating, l.votes AS votes
     FROM games g JOIN sources src ON src.id = g.source_id JOIN v_latest l ON l.game_id = g.id
     WHERE g.is_live ${pf(platform)} AND g.first_seen_at >= (SELECT max(first_seen_at) FROM games) - interval '14 days'
     ORDER BY g.first_seen_at DESC, l.votes DESC NULLS LAST LIMIT 60`
  );
  return rows.map((r) => ({ gameId: num(r.id), title: r.title, genre: r.genre ?? "—", rating: num(r.rating), votes: num(r.votes), url: r.url }));
}

export async function getInsights(db: Querier, platform: Platform, deps?: { gd?: GenreDates; gaps?: MarketGap[]; landscape?: GenreLandscapePoint[]; gems?: HiddenGem[] }): Promise<Insight[]> {
  const gd = deps?.gd ?? await genreVotesByDate(db, platform);
  const vels = gd.order.map((genre) => ({ genre, v: velocity(gd.byGenre[genre], gd.daySpan) }));
  const out: Insight[] = [];
  // (1) Rising genre by votes/day
  if (vels.length) {
    const top = vels.reduce((best, cur) => (cur.v > best.v ? cur : best), vels[0]);
    out.push({ kind: "up", tag: "RISING", meta: `+${Math.round(top.v)} votes/day`, text: `<b>${top.genre}</b> is gaining the most votes/day across the window.` });
  }
  // (2) Top opportunity gap
  const gaps = deps?.gaps ?? await getMarketGaps(db, platform);
  if (gaps.length)
    out.push({ kind: "gap", tag: "OPPORTUNITY", meta: `${gaps[0].supplyN} games · ${gaps[0].appetite} median votes`, text: `<b>${gaps[0].label}</b> shows high demand with thin supply.` });
  // (3) Hidden-gems count
  const gems = deps?.gems ?? await getHiddenGems(db, platform);
  if (gems.length)
    out.push({ kind: "gem", tag: "HIDDEN GEMS", meta: `${gems.length} found`, text: `<b>${gems.length} hidden gems</b> rank in the top 25% on rating with low vote volume.` });
  // (4) Optional highest-quality genre by P75 rating
  const landscape = deps?.landscape ?? await getGenreLandscape(db, platform);
  if (landscape.length) {
    const best = landscape.reduce((b, c) => (c.p75Rating > b.p75Rating ? c : b), landscape[0]);
    out.push({ kind: "up", tag: "TOP QUALITY", meta: `P75 rating ${best.p75Rating.toFixed(2)}`, text: `<b>${best.genre}</b> has the highest P75 rating across all genres.` });
  }
  return out;
}

async function getKPI(db: Querier, platform: Platform, gaps: MarketGap[], deps?: { gd?: GenreDates; vol?: Map<string, number> }): Promise<OverviewKPI> {
  const g = await db.query(
    `SELECT count(*)::int AS n FROM games g JOIN sources src ON src.id = g.source_id WHERE g.is_live ${pf(platform)}`
  );
  const avg = await db.query(
    `SELECT avg(l.rating)::float AS r FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id WHERE g.is_live ${pf(platform)}`
  );
  const newGames = await db.query(
    `SELECT count(*)::int AS n FROM games g JOIN sources src ON src.id = g.source_id
     WHERE g.is_live ${pf(platform)} AND g.first_seen_at >= (SELECT max(first_seen_at) FROM games) - interval '14 days'`
  );
  const gd = deps?.gd ?? await genreVotesByDate(db, platform);
  const vol = deps?.vol ?? await genreCounts(db, platform);
  const MIN_VOL = 4;
  const rising = gd.order
    .filter((genre) => (vol.get(genre) ?? 0) >= MIN_VOL)
    .map((genre) => ({ genre, v: velocity(gd.byGenre[genre], gd.daySpan) }))
    .sort((a, b) => b.v - a.v)[0] ?? { genre: "—", v: 0 };
  const p90 = await db.query(
    `SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS p FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id WHERE g.is_live AND l.rating IS NOT NULL ${pf(platform)}`
  );
  return {
    gamesTracked: num(g[0].n),
    newGames: num(newGames[0].n),
    avgRating: +num(avg[0].r).toFixed(2),
    avgRatingP90: +num(p90[0].p).toFixed(2),
    risingGenre: rising.genre,
    risingVotesPerDay: Math.round(rising.v),
    openGaps: gaps.filter((c) => c.score > 0).length,
  };
}

async function genreExamples(db: Querier, platform: Platform): Promise<Map<string, string[]>> {
  const rows = await db.query(
    `SELECT genre, title FROM (
       SELECT l.genre AS genre, g.title AS title,
              row_number() OVER (PARTITION BY l.genre ORDER BY l.votes DESC NULLS LAST) AS rn
       FROM v_latest l JOIN games g ON g.id=l.game_id JOIN sources src ON src.id=g.source_id
       WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
     ) t WHERE rn <= 3 ORDER BY genre, rn`
  );
  const m = new Map<string, string[]>();
  for (const r of rows) { const a = m.get(r.genre) ?? []; a.push(r.title); m.set(r.genre, a); }
  return m;
}

async function gapExamples(db: Querier, platform: Platform): Promise<Map<string, string[]>> {
  const rows = await db.query(
    `SELECT genre, tag, title FROM (
       SELECT l.genre AS genre, t.name AS tag, g.title AS title,
              row_number() OVER (PARTITION BY l.genre, t.name ORDER BY l.votes DESC NULLS LAST) AS rn
       FROM v_latest l JOIN games g ON g.id=l.game_id JOIN sources src ON src.id=g.source_id
       JOIN game_tags gt ON gt.game_id=g.id JOIN tags t ON t.id=gt.tag_id
       WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
     ) x WHERE rn <= 3 ORDER BY genre, tag, rn`
  );
  const m = new Map<string, string[]>();
  for (const r of rows) { const k = `${r.genre} × ${r.tag}`; const a = m.get(k) ?? []; a.push(r.title); m.set(k, a); }
  return m;
}

export async function getGenreVelocityBars(db: Querier, platform: Platform, gd?: GenreDates, vol?: Map<string, number>): Promise<GenreVelocityBar[]> {
  gd ??= await genreVotesByDate(db, platform);
  vol ??= await genreCounts(db, platform);
  const MIN_VOL = 4;
  return gd.order
    .filter((g) => (vol!.get(g) ?? 0) >= MIN_VOL)
    .map((g) => ({ genre: g, votesPerDay: Math.round(velocity(gd!.byGenre[g], gd!.daySpan)) }))
    .sort((a, b) => b.votesPerDay - a.votesPerDay)
    .slice(0, 12);
}

export async function getGenreLandscape(db: Querier, platform: Platform): Promise<GenreLandscapePoint[]> {
  const [rows, ex] = await Promise.all([
    db.query(
      `SELECT l.genre AS genre, count(*)::int AS supply,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY l.rating)::float AS p75,
              avg(l.rating)::float AS avgr, coalesce(sum(l.votes),0)::float AS tv
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
       WHERE g.is_live AND l.genre IS NOT NULL AND l.rating IS NOT NULL ${pf(platform)}
       GROUP BY l.genre HAVING count(*) >= 4 ORDER BY supply DESC`
    ),
    genreExamples(db, platform),
  ]);
  return rows.map((r) => ({ genre: r.genre, supply: num(r.supply), p75Rating: +num(r.p75).toFixed(2), avgRating: +num(r.avgr).toFixed(2), totalVotes: Math.round(num(r.tv)), examples: ex.get(r.genre) ?? [] }));
}

async function getTagGlossary(db: Querier, platform: Platform, tagNames: string[]): Promise<GlossaryRow[]> {
  if (!tagNames.length) return [];
  const ph = tagNames.map((_, i) => `$${i + 1}`).join(",");
  const rows = await db.query(
    `SELECT tag, title, cnt FROM (
       SELECT t.name AS tag, gg.title AS title,
              row_number() OVER (PARTITION BY t.name ORDER BY l.votes DESC NULLS LAST) AS rn,
              count(*) OVER (PARTITION BY t.name) AS cnt
       FROM tags t
       JOIN game_tags gt ON gt.tag_id = t.id
       JOIN games gg ON gg.id = gt.game_id
       JOIN sources src ON src.id = gg.source_id
       JOIN v_latest l ON l.game_id = gg.id
       WHERE gg.is_live AND t.name IN (${ph}) ${pf(platform)}
     ) x WHERE rn <= 3 ORDER BY tag, rn`,
    tagNames
  );
  const m = new Map<string, { count: number; examples: string[] }>();
  for (const r of rows) {
    const e = m.get(r.tag) ?? { count: num(r.cnt), examples: [] };
    e.examples.push(r.title);
    m.set(r.tag, e);
  }
  // preserve the requested order
  return tagNames.filter((t) => m.has(t)).map((label) => ({ label, kind: "tag" as const, count: m.get(label)!.count, examples: m.get(label)!.examples, definition: defineTag(label) }));
}

export async function getOverview(db: Querier, platform: Platform): Promise<Overview> {
  const [gd, vol, gemRows, tags, heatmap, gaps, landscape] = await Promise.all([
    genreVotesByDate(db, platform),
    genreCounts(db, platform),
    gemBase(db, platform),
    getTagFrequency(db, platform),
    getFeatureHeatmap(db, platform),
    getMarketGaps(db, platform),
    getGenreLandscape(db, platform),
  ]);
  const scatter = await getScatter(db, platform, gemRows);
  const gems = await getHiddenGems(db, platform, gemRows);
  const momentum = await getGenreMomentum(db, platform, gd);
  const velocityBars = await getGenreVelocityBars(db, platform, gd, vol);
  const insights = await getInsights(db, platform, { gd, gaps, landscape, gems });
  const kpi = await getKPI(db, platform, gaps, { gd, vol });
  const tagNames = [...new Set([...gaps.map((g) => g.tag), ...tags.map((t) => t.tag)])];
  const glossary: GlossaryRow[] = await getTagGlossary(db, platform, tagNames);
  return { kpi, momentum, tags, scatter, heatmap, gaps, insights, landscape, velocityBars, glossary, platform, subtitle: subtitleFor(platform) };
}

// ── Phase 2: Steam / PC analytics ──

// Distribution of games across inferred market-scale tiers (hobby → aaa).
export async function getScaleTierBreakdown(db: Querier, platform: Platform): Promise<ScaleTierRow[]> {
  const rows = await db.query(
    `SELECT l.scale_tier AS tier, count(*)::int AS games
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.scale_tier IS NOT NULL ${pf(platform)}
     GROUP BY l.scale_tier ORDER BY games DESC`
  );
  return rows.map((r) => ({ tier: r.tier, games: num(r.games) }));
}

// Per-genre economics for Steam, defaulting to the indie-addressable cohort
// (AAA excluded so its outliers don't distort the benchmark medians — see Phase 2 design).
export async function getSteamGenreEconomics(
  db: Querier,
  opts?: { cohort?: SteamCohort }
): Promise<SteamGenreEconomics[]> {
  const cohort = opts?.cohort ?? "indie";
  const tierFilter = cohort === "indie" ? "AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')" : "";
  const rows = await db.query(
    `SELECT l.genre AS genre, count(*)::int AS games,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price_cents)::float AS med_price,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.rating)::float AS med_rating,
            coalesce(sum(l.owners_est), 0)::float AS total_owners,
            coalesce(sum(l.owners_est * l.price_cents), 0)::float AS rev_cents
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND l.genre IS NOT NULL ${tierFilter}
     GROUP BY l.genre ORDER BY total_owners DESC`
  );
  return rows.map((r) => ({
    genre: r.genre,
    games: num(r.games),
    medianPriceCents: Math.round(num(r.med_price)),
    medianRating: r.med_rating == null ? null : +Number(r.med_rating).toFixed(2),
    totalOwners: num(r.total_owners),
    revenueProxy: Math.round(num(r.rev_cents) / 100),
  }));
}

// Indie-tier rated games — the realistic "comparables" peer set, focused on RECENT releases:
// a rolling ~2-year window (start of the current year minus 2 → 2024-01-01 today, keeping all
// of 2024 incl. Balatro; rolls forward automatically each year). Ordered newest first, with an
// owners floor so games shown still have real traction. Older classics are intentionally
// dropped here — the crawl seeds from indie TOP SELLERS so the recent set stays well populated.
const COMPARABLE_OWNERS_FLOOR = 20_000;
const COMPARABLE_RECENCY_YEARS = 2;
export async function getSteamComparables(db: Querier, limit = 12): Promise<SteamComparable[]> {
  const rows = await db.query(
    `SELECT g.title, l.scale_tier AS tier, l.genre, l.rating, l.votes,
            l.owners_est AS owners, l.price_cents AS price, g.developer, g.release_date
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND l.rating IS NOT NULL
       AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
       AND coalesce(l.owners_est, 0) >= ${COMPARABLE_OWNERS_FLOOR}
       AND g.release_date >= (date_trunc('year', CURRENT_DATE) - INTERVAL '${COMPARABLE_RECENCY_YEARS} years')
     ORDER BY g.release_date DESC NULLS LAST, l.owners_est DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    title: r.title, tier: r.tier ?? "—", genre: r.genre ?? "—",
    rating: r.rating == null ? null : +Number(r.rating).toFixed(2),
    votes: r.votes == null ? null : num(r.votes),
    owners: r.owners == null ? null : num(r.owners),
    priceCents: r.price == null ? null : num(r.price),
    developer: r.developer ?? null,
    releaseDate: r.release_date == null ? null : new Date(r.release_date).toISOString().slice(0, 10),
  }));
}

// Steam pricing: price-band breakdown over the indie cohort (how indies price + what each band is worth).
const PRICE_BANDS = ["Free", "<$5", "$5–10", "$10–20", "$20+"];
export async function getSteamPricing(db: Querier): Promise<SteamPriceBand[]> {
  const rows = await db.query(
    `SELECT CASE
              WHEN l.price_cents IS NULL OR l.price_cents = 0 THEN 'Free'
              WHEN l.price_cents < 500  THEN '<$5'
              WHEN l.price_cents < 1000 THEN '$5–10'
              WHEN l.price_cents < 2000 THEN '$10–20'
              ELSE '$20+'
            END AS band,
            count(*)::int AS games,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.rating)::float AS med_rating,
            coalesce(sum(l.owners_est), 0)::float AS total_owners,
            coalesce(sum(l.owners_est * l.price_cents), 0)::float AS rev_cents
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
     GROUP BY band`
  );
  const by = new Map(rows.map((r) => [r.band, r]));
  return PRICE_BANDS.filter((b) => by.has(b)).map((band) => {
    const r = by.get(band)!;
    return {
      band, games: num(r.games),
      medianRating: r.med_rating == null ? null : +Number(r.med_rating).toFixed(2),
      totalOwners: num(r.total_owners), revenueProxy: Math.round(num(r.rev_cents) / 100),
    };
  });
}

// Steam ownership/engagement by genre (indie cohort): market size + live CCU + playtime.
export async function getSteamOwnership(db: Querier): Promise<SteamOwnershipRow[]> {
  const rows = await db.query(
    `SELECT l.genre AS genre, count(*)::int AS games,
            coalesce(sum(l.owners_est), 0)::float AS total_owners,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.owners_est)::float AS med_owners,
            coalesce(sum(l.ccu), 0)::int AS ccu,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.median_playtime_min)::float AS med_play
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND l.genre IS NOT NULL AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
     GROUP BY l.genre ORDER BY total_owners DESC`
  );
  return rows.map((r) => ({
    genre: r.genre, games: num(r.games), totalOwners: num(r.total_owners),
    medianOwners: Math.round(num(r.med_owners)), ccu: num(r.ccu),
    medianPlaytimeMin: Math.round(num(r.med_play)),
  }));
}

// Top Steam studios (indie cohort) — Steam exposes real developer names.
export async function getSteamDevelopers(db: Querier): Promise<SteamDeveloperRow[]> {
  const rows = await db.query(
    `SELECT g.developer AS developer, count(DISTINCT g.id)::int AS games,
            coalesce(sum(l.owners_est), 0)::float AS owners, avg(l.rating)::float AS avg_rating,
            mode() WITHIN GROUP (ORDER BY l.genre) AS top_genre
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND g.developer IS NOT NULL AND g.developer <> ''
       AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
     GROUP BY g.developer ORDER BY owners DESC, games DESC LIMIT 40`
  );
  return rows.map((r) => ({
    developer: r.developer, games: num(r.games), totalOwners: num(r.owners),
    avgRating: +num(r.avg_rating).toFixed(2), topGenre: r.top_genre ?? "—",
  }));
}

// Recent Steam releases (indie cohort) by release date.
export async function getSteamNewReleases(db: Querier): Promise<SteamNewRelease[]> {
  const rows = await db.query(
    `SELECT g.title, l.genre, l.scale_tier AS tier, l.rating, l.owners_est AS owners, l.price_cents AS price, g.release_date
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam' AND g.release_date IS NOT NULL
       AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
     ORDER BY g.release_date DESC LIMIT 40`
  );
  return rows.map((r) => ({
    title: r.title, genre: r.genre ?? "—", tier: r.tier ?? "—",
    rating: r.rating == null ? null : +Number(r.rating).toFixed(2),
    owners: r.owners == null ? null : num(r.owners),
    priceCents: r.price == null ? null : num(r.price),
    releaseDate: r.release_date == null ? null : new Date(r.release_date).toISOString().slice(0, 10),
  }));
}

async function steamGapExamples(db: Querier): Promise<Map<string, string[]>> {
  const rows = await db.query(
    `SELECT genre, tag, title FROM (
       SELECT l.genre AS genre, t.name AS tag, g.title AS title,
              row_number() OVER (PARTITION BY l.genre, t.name ORDER BY l.owners_est DESC NULLS LAST) AS rn
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
       JOIN game_tags gt ON gt.game_id = g.id JOIN tags t ON t.id = gt.tag_id
       WHERE g.is_live AND src.name = 'steam' AND l.genre IS NOT NULL AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
         AND lower(t.name) <> lower(l.genre)
     ) x WHERE rn <= 3`
  );
  const m = new Map<string, string[]>();
  for (const r of rows) { const k = `${r.genre} × ${r.tag}`; const a = m.get(k) ?? []; a.push(r.title); m.set(k, a); }
  return m;
}

// Steam opportunity: indie genre×tag with high demand (owners) + quality, low supply, monetizable.
export async function getSteamOpportunity(db: Querier): Promise<SteamGap[]> {
  const [rows, ex] = await Promise.all([
    db.query(
      `SELECT l.genre AS genre, t.name AS tag,
              count(DISTINCT g.id)::int AS supply_n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY l.owners_est)::float AS demand,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS quality,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price_cents)::float AS med_price
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
       JOIN game_tags gt ON gt.game_id = g.id JOIN tags t ON t.id = gt.tag_id
       WHERE g.is_live AND src.name = 'steam' AND l.genre IS NOT NULL AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
         AND lower(t.name) <> lower(l.genre)
       GROUP BY l.genre, t.name HAVING count(DISTINCT g.id) >= 2`
    ),
    steamGapExamples(db),
  ]);
  if (rows.length < 2) return [];
  const z = (vals: number[]) => { const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    return (v: number) => (v - m) / sd; };
  const zDem = z(rows.map((r) => num(r.demand)));
  const zSup = z(rows.map((r) => num(r.supply_n)));
  const zQual = z(rows.map((r) => num(r.quality)));
  return rows
    .map((r) => ({
      label: `${r.genre} × ${r.tag}`, genre: r.genre, tag: r.tag,
      supplyN: num(r.supply_n), medianOwners: Math.round(num(r.demand)),
      qualityCeil: +num(r.quality).toFixed(2), medianPriceCents: Math.round(num(r.med_price)),
      score: +(zDem(num(r.demand)) + zQual(num(r.quality)) - zSup(num(r.supply_n))).toFixed(2),
      examples: ex.get(`${r.genre} × ${r.tag}`) ?? [],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

// Composed Steam screen payload: KPIs + tier mix + cohorts + comparables + all sub-sections.
export async function getSteamOverview(db: Querier): Promise<SteamOverview> {
  const [tiers, indie, all, comparables, opportunity, pricing, ownership, developers, newReleases] = await Promise.all([
    getScaleTierBreakdown(db, "steam"),
    getSteamGenreEconomics(db, { cohort: "indie" }),
    getSteamGenreEconomics(db, { cohort: "all" }),
    getSteamComparables(db, 14),
    getSteamOpportunity(db),
    getSteamPricing(db),
    getSteamOwnership(db),
    getSteamDevelopers(db),
    getSteamNewReleases(db),
  ]);
  const games = tiers.reduce((s, t) => s + t.games, 0);
  const aaa = tiers.find((t) => t.tier === "aaa")?.games ?? 0;
  const agg = (await db.query(
    `SELECT count(*) FILTER (WHERE l.rating IS NOT NULL)::int AS r, count(*)::int AS n,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY l.price_cents) FILTER (
              WHERE l.price_cents IS NOT NULL AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa')
            )::float AS indie_med_price
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND src.name = 'steam'`
  ))[0];
  return {
    kpi: {
      games, indie: games - aaa, aaa,
      ratedPct: num(agg.n) ? Math.round((num(agg.r) / num(agg.n)) * 100) : 0,
      indieMedianPriceCents: Math.round(num(agg.indie_med_price)),
    },
    tiers, indie, all, comparables, opportunity, pricing, ownership, developers, newReleases,
    subtitle: "Steam (PC) · indie-addressable cohort default",
  };
}

// ── Brief ──
export async function getBriefEditions(db: Querier): Promise<BriefEditionMeta[]> {
  const rows = await db.query(
    `SELECT id, edition_date, weekday, brief_type, source_count FROM brief_editions ORDER BY edition_date DESC`
  );
  return rows.map((r) => ({
    id: num(r.id),
    editionDate: typeof r.edition_date === "string" ? r.edition_date.slice(0, 10) : new Date(r.edition_date).toISOString().slice(0, 10),
    weekday: r.weekday,
    briefType: r.brief_type,
    sourceCount: num(r.source_count),
  }));
}

export interface PublishInput {
  editionDate: string;
  weekday?: string;
  briefType?: string;
  payload: unknown;
  renderedHtml?: string | null;
  localPath?: string | null;
  sourceCount?: number | null;
}

export async function publishEdition(db: Querier, e: PublishInput): Promise<void> {
  if (!e?.editionDate || !e?.payload) throw new Error("editionDate and payload required");
  // Advisory only — warn on format drift but never reject, so a lagging brief can't blank the dashboard.
  const bv = validateBriefPayload(e.payload);
  if (bv.warnings.length) console.warn(`[contract] brief ${e.editionDate}: ${bv.warnings.join("; ")}`);
  await db.query(
    `INSERT INTO brief_editions(edition_date, weekday, brief_type, payload, rendered_html, local_path, source_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (edition_date, brief_type) DO UPDATE SET
       weekday = EXCLUDED.weekday, payload = EXCLUDED.payload, rendered_html = EXCLUDED.rendered_html,
       local_path = EXCLUDED.local_path, source_count = EXCLUDED.source_count, created_at = now()`,
    [
      e.editionDate,
      e.weekday ?? null,
      e.briefType ?? "indie",
      JSON.stringify(e.payload),
      e.renderedHtml ?? null,
      e.localPath ?? null,
      e.sourceCount ?? null,
    ]
  );
}

export async function getBriefSteering(db: Querier): Promise<BriefSteering> {
  try {
    const rows = await db.query(`SELECT flags, updated_at FROM brief_steering WHERE id = 1`);
    if (!rows.length) return { flags: [], updatedAt: null };
    const raw = typeof rows[0].flags === "string" ? JSON.parse(rows[0].flags) : rows[0].flags;
    return {
      flags: Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [],
      updatedAt: rows[0].updated_at ? new Date(rows[0].updated_at).toISOString() : null,
    };
  } catch {
    return { flags: [], updatedAt: null }; // table not migrated yet → behave as empty
  }
}

export async function setBriefSteering(db: Querier, flags: string[]): Promise<void> {
  const clean = (Array.isArray(flags) ? flags : []).filter((x) => typeof x === "string").slice(0, 50);
  await db.query(
    `INSERT INTO brief_steering(id, flags, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET flags = EXCLUDED.flags, updated_at = now()`,
    [JSON.stringify(clean)]
  );
}

export async function getBriefEdition(db: Querier, editionDate: string): Promise<BriefEdition | null> {
  const rows = await db.query(
    `SELECT id, edition_date, weekday, brief_type, source_count, payload FROM brief_editions WHERE edition_date = $1 ORDER BY brief_type LIMIT 1`,
    [editionDate]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const payload = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
  return {
    id: num(r.id),
    editionDate: typeof r.edition_date === "string" ? r.edition_date.slice(0, 10) : new Date(r.edition_date).toISOString().slice(0, 10),
    weekday: r.weekday,
    briefType: r.brief_type,
    sourceCount: num(r.source_count),
    payload,
  };
}

// ---- pitches (Library "Pitches" collection) ----

function rowToPitch(r: any): Pitch {
  const d = r.pitch_date;
  return {
    id: num(r.id),
    slug: r.slug,
    rank: r.rank === null || r.rank === undefined ? null : num(r.rank),
    title: r.title,
    oneLiner: r.one_liner ?? null,
    loopFamily: r.loop_family ?? null,
    platformLadder: r.platform_ladder ?? null,
    status: r.status ?? "proposed",
    badge: r.badge ?? null,
    loopDetail: r.loop_detail ?? null,
    browserMvp: r.browser_mvp ?? null,
    steamLadder: r.steam_ladder ?? null,
    evidence: r.evidence ?? null,
    risk: r.risk ?? null,
    d1Fit: r.d1_fit === null || r.d1_fit === undefined ? null : num(r.d1_fit),
    steamCeiling: r.steam_ceiling === null || r.steam_ceiling === undefined ? null : num(r.steam_ceiling),
    buildCost: r.build_cost === null || r.build_cost === undefined ? null : num(r.build_cost),
    pitchDate: typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10),
    batch: r.batch ?? null,
    source: r.source ?? null,
  };
}

export async function getPitches(db: Querier): Promise<Pitch[]> {
  try {
    const rows = await db.query(
      `SELECT id, slug, rank, title, one_liner, loop_family, platform_ladder, status, badge,
              loop_detail, browser_mvp, steam_ladder, evidence, risk, d1_fit, steam_ceiling,
              build_cost, pitch_date, batch, source
       FROM pitches
       ORDER BY pitch_date DESC, COALESCE(rank, 999) ASC, id ASC`
    );
    return rows.map(rowToPitch);
  } catch {
    return []; // table not migrated yet → behave as empty
  }
}

export async function publishPitch(db: Querier, p: PitchInput): Promise<void> {
  assertPitchInput(p); // strict: validates required fields + taxonomy enums + score ranges against the contract
  await db.query(
    `INSERT INTO pitches
       (slug, rank, title, one_liner, loop_family, platform_ladder, status, badge,
        loop_detail, browser_mvp, steam_ladder, evidence, risk, d1_fit, steam_ceiling,
        build_cost, pitch_date, batch, source, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
     ON CONFLICT (slug) DO UPDATE SET
       rank = EXCLUDED.rank, title = EXCLUDED.title, one_liner = EXCLUDED.one_liner,
       loop_family = EXCLUDED.loop_family, platform_ladder = EXCLUDED.platform_ladder,
       status = EXCLUDED.status, badge = EXCLUDED.badge, loop_detail = EXCLUDED.loop_detail,
       browser_mvp = EXCLUDED.browser_mvp, steam_ladder = EXCLUDED.steam_ladder,
       evidence = EXCLUDED.evidence, risk = EXCLUDED.risk, d1_fit = EXCLUDED.d1_fit,
       steam_ceiling = EXCLUDED.steam_ceiling, build_cost = EXCLUDED.build_cost,
       pitch_date = EXCLUDED.pitch_date, batch = EXCLUDED.batch, source = EXCLUDED.source,
       updated_at = now()`,
    [
      p.slug,
      p.rank ?? null,
      p.title,
      p.oneLiner ?? null,
      p.loopFamily ?? null,
      p.platformLadder ?? "browser->steam",
      p.status ?? "proposed",
      p.badge ?? null,
      p.loopDetail ?? null,
      p.browserMvp ?? null,
      p.steamLadder ?? null,
      p.evidence ?? null,
      p.risk ?? null,
      p.d1Fit ?? null,
      p.steamCeiling ?? null,
      p.buildCost ?? null,
      p.pitchDate,
      p.batch ?? null,
      p.source ?? null,
    ]
  );
}
