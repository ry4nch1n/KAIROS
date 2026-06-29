// Analytics queries — chart-ready shapes. All accept a Querier (DI) + platform.
import type { Querier } from "../db/db.ts";
import type {
  Platform, Overview, OverviewKPI, GenreMomentum, TagFreq, ScatterPoint,
  HiddenGem, MarketGap, FeatureHeatmap, Insight, BriefEditionMeta, BriefEdition,
  GenreRow, DeveloperRow, NewRelease, GenreLandscapePoint,
} from "shared";

const WEEK_LABEL_BASE = 15;

const fmtDate = (d: any) => new Date(d).toISOString().slice(5, 10); // "MM-DD"

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

// velocity = (last - first) / spanDays, guarded for <2 points or zero span
function velocity(values: number[], daySpan: number): number {
  if (values.length < 2 || daySpan <= 0) return 0;
  const first = values[0], last = values[values.length - 1];
  return (last - first) / daySpan;
}

function pf(platform: Platform): string {
  if (platform === "poki") return "AND src.name = 'poki'";
  if (platform === "crazygames") return "AND src.name = 'crazygames'";
  return "";
}
function subtitleFor(platform: Platform): string {
  if (platform === "poki") return "Poki · last 90 days";
  if (platform === "crazygames") return "CrazyGames · last 90 days";
  return "Poki + CrazyGames · last 90 days";
}
const num = (v: any) => (v === null || v === undefined ? 0 : Number(v));

// ── genre × week featured counts (shared by momentum + heatmap + insights) ──
interface GenreWeeks {
  weeks: string[];
  order: string[]; // genres by total featured desc
  byGenre: Record<string, number[]>;
  totals: Record<string, number>;
}
async function genreWeekFeatures(db: Querier, platform: Platform): Promise<GenreWeeks> {
  const rows = await db.query(
    `SELECT s.genre AS genre, s.captured_at AS wk,
            count(*) FILTER (WHERE s.featured)::int AS feats
     FROM game_snapshots s
     JOIN games g ON g.id = s.game_id
     JOIN sources src ON src.id = g.source_id
     WHERE g.is_live ${pf(platform)}
     GROUP BY s.genre, s.captured_at`
  );
  const times = [...new Set(rows.map((r) => new Date(r.wk).getTime()))].sort((a, b) => a - b);
  const weekIndex = new Map(times.map((t, i) => [t, i]));
  const weeks = times.map((_, i) => "W" + (WEEK_LABEL_BASE + i));
  const byGenre: Record<string, number[]> = {};
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const g = r.genre as string;
    if (!byGenre[g]) byGenre[g] = new Array(times.length).fill(0);
    const i = weekIndex.get(new Date(r.wk).getTime())!;
    byGenre[g][i] = num(r.feats);
    totals[g] = (totals[g] ?? 0) + num(r.feats);
  }
  const order = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  return { weeks, order, byGenre, totals };
}

// Least-squares trend over the whole window — robust to single-week noise.
// deltaPct = rise of the fitted line over the window, as % of the average level.
function trendStats(series: number[]): { deltaPct: number; total: number; slope: number; mean: number } {
  const n = series.length;
  const total = series.reduce((a, b) => a + b, 0);
  if (n < 2) return { deltaPct: 0, total, slope: 0, mean: total };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += series[i]; sxx += i * i; sxy += i * series[i];
  }
  const denom = n * sxx - sx * sx;
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const mean = sy / n;
  const deltaPct = mean > 0 ? (slope * (n - 1)) / mean * 100 : 0;
  return { deltaPct, total, slope, mean };
}
function growthPct(series: number[]): number {
  return trendStats(series).deltaPct;
}

export async function getGenreMomentum(db: Querier, platform: Platform): Promise<GenreMomentum> {
  const gd = await genreVotesByDate(db, platform);
  const top = gd.order.slice(0, 4);
  return { dates: gd.dates, building: gd.dates.length < 2, series: top.map((genre) => ({ genre, values: gd.byGenre[genre] })) };
}

export async function getFeatureHeatmap(db: Querier, platform: Platform): Promise<FeatureHeatmap> {
  const gw = await genreWeekFeatures(db, platform);
  const genres = gw.order.slice(0, 7);
  const cells = [];
  for (let gi = 0; gi < genres.length; gi++)
    for (let w = 0; w < gw.weeks.length; w++)
      cells.push({ genreIndex: gi, week: w, value: gw.byGenre[genres[gi]][w] });
  return { weeks: gw.weeks, genres, cells };
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

export async function getScatter(db: Querier, platform: Platform): Promise<ScatterPoint[]> {
  const rows = await gemBase(db, platform);
  return rows.map((r) => ({ title: r.title, genre: r.genre ?? "—", rating: num(r.rating), votes: num(r.votes), gem: !!r.gem }));
}

export async function getHiddenGems(db: Querier, platform: Platform): Promise<HiddenGem[]> {
  const rows = await gemBase(db, platform);
  return rows
    .filter((r) => r.gem)
    .sort((a, b) => (num(b.rp) - num(b.vp)) - (num(a.rp) - num(a.vp)))
    .slice(0, 30)
    .map((r) => ({ gameId: num(r.id), title: r.title, rating: num(r.rating), votes: num(r.votes), genre: r.genre ?? "—" }));
}

export async function getMarketGaps(db: Querier, platform: Platform): Promise<MarketGap[]> {
  const rows = await db.query(
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
  );
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
      supplyN: num(r.supply_n),
      appetite: Math.round(num(r.appetite)),
      qualityCeil: +num(r.quality_ceil).toFixed(2),
      score: +(zApp(num(r.appetite)) + zQual(num(r.quality_ceil)) - zSup(num(r.supply_n))).toFixed(2),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export async function getGenres(db: Querier, platform: Platform): Promise<GenreRow[]> {
  const rows = await db.query(
    `SELECT l.genre AS genre, count(*)::int AS games,
            avg(l.rating)::float AS avg_rating, avg(l.votes)::float AS avg_votes,
            avg(fd.df)::float AS days_featured
     FROM v_latest l
     JOIN games g ON g.id = l.game_id
     JOIN sources src ON src.id = g.source_id
     LEFT JOIN (SELECT game_id, count(*) FILTER (WHERE featured) AS df FROM game_snapshots GROUP BY game_id) fd ON fd.game_id = g.id
     WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
     GROUP BY l.genre ORDER BY games DESC`
  );
  const gw = await genreWeekFeatures(db, platform);
  return rows.map((r) => ({
    genre: r.genre,
    games: num(r.games),
    avgRating: +num(r.avg_rating).toFixed(2),
    avgVotes: Math.round(num(r.avg_votes)),
    daysFeatured: +num(r.days_featured).toFixed(1),
    deltaPct: gw.byGenre[r.genre] ? Math.round(trendStats(gw.byGenre[r.genre]).deltaPct) : 0,
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
     FROM games g
     JOIN sources src ON src.id = g.source_id
     JOIN v_latest l ON l.game_id = g.id
     JOIN (SELECT game_id, min(captured_at) AS fs FROM game_snapshots GROUP BY game_id) m ON m.game_id = g.id
     WHERE g.is_live AND m.fs = (SELECT max(captured_at) FROM game_snapshots) ${pf(platform)}
     ORDER BY l.votes DESC NULLS LAST LIMIT 60`
  );
  return rows.map((r) => ({
    gameId: num(r.id),
    title: r.title,
    genre: r.genre ?? "—",
    rating: num(r.rating),
    votes: num(r.votes),
    url: r.url,
  }));
}

export async function getInsights(db: Querier, platform: Platform): Promise<Insight[]> {
  const gd = await genreVotesByDate(db, platform);
  const vels = gd.order.map((genre) => ({ genre, v: velocity(gd.byGenre[genre], gd.daySpan) }));
  const out: Insight[] = [];
  if (vels.length) {
    const top = vels.reduce((best, cur) => (cur.v > best.v ? cur : best), vels[0]);
    out.push({ kind: "up", tag: "RISING", meta: `+${Math.round(top.v)} votes/day`, text: `<b>${top.genre}</b> is gaining the most votes/day across the window.` });
    const falling = vels.filter((s) => s.v < 0);
    if (falling.length) {
      const bot = falling.reduce((worst, cur) => (cur.v < worst.v ? cur : worst), falling[0]);
      out.push({ kind: "down", tag: "DECLINING", meta: `${Math.round(bot.v)} votes/day`, text: `<b>${bot.genre}</b> median votes are declining over the window.` });
    }
  }
  const gaps = await getMarketGaps(db, platform);
  if (gaps.length)
    out.push({ kind: "gap", tag: "OPPORTUNITY", meta: `${gaps[0].supplyN} games · ${gaps[0].appetite} median votes`, text: `<b>${gaps[0].label}</b> shows high demand with thin supply.` });
  const gems = await getHiddenGems(db, platform);
  if (gems.length)
    out.push({ kind: "gem", tag: "HIDDEN GEMS", meta: `${gems.length} found`, text: `<b>${gems.length} hidden gems</b> rank in the top 25% on rating with low vote volume.` });
  return out;
}

async function getKPI(db: Querier, platform: Platform, gaps: MarketGap[]): Promise<OverviewKPI> {
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
  const gd = await genreVotesByDate(db, platform);
  const MIN_VOL = 4;
  const counts = await db.query(
    `SELECT l.genre AS genre, count(*)::int AS n FROM v_latest l JOIN games g ON g.id=l.game_id JOIN sources src ON src.id=g.source_id WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)} GROUP BY l.genre`
  );
  const vol = new Map(counts.map((r) => [r.genre, num(r.n)]));
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

export async function getGenreLandscape(db: Querier, platform: Platform): Promise<GenreLandscapePoint[]> {
  const rows = await db.query(
    `SELECT l.genre AS genre, count(*)::int AS supply,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY l.rating)::float AS p75,
            avg(l.rating)::float AS avgr, coalesce(sum(l.votes),0)::float AS tv
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL AND l.rating IS NOT NULL ${pf(platform)}
     GROUP BY l.genre ORDER BY supply DESC`
  );
  return rows.map((r) => ({ genre: r.genre, supply: num(r.supply), p75Rating: +num(r.p75).toFixed(2), avgRating: +num(r.avgr).toFixed(2), totalVotes: Math.round(num(r.tv)) }));
}

export async function getOverview(db: Querier, platform: Platform): Promise<Overview> {
  const [momentum, tags, scatter, heatmap, gaps, insights, landscape] = await Promise.all([
    getGenreMomentum(db, platform),
    getTagFrequency(db, platform),
    getScatter(db, platform),
    getFeatureHeatmap(db, platform),
    getMarketGaps(db, platform),
    getInsights(db, platform),
    getGenreLandscape(db, platform),
  ]);
  const kpi = await getKPI(db, platform, gaps);
  return { kpi, momentum, tags, scatter, heatmap, gaps, insights, landscape, platform, subtitle: subtitleFor(platform) };
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
