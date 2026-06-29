// Analytics queries — chart-ready shapes. All accept a Querier (DI) + platform.
import type { Querier } from "../db/db.ts";
import type {
  Platform, Overview, OverviewKPI, GenreMomentum, TagFreq, ScatterPoint,
  HiddenGem, MarketGap, FeatureHeatmap, Insight, BriefEditionMeta, BriefEdition,
  GenreRow, DeveloperRow, NewRelease, GenreLandscapePoint, GenreVelocityBar, GlossaryRow,
} from "shared";

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

export async function getGenreMomentum(db: Querier, platform: Platform): Promise<GenreMomentum> {
  const gd = await genreVotesByDate(db, platform);
  const top = gd.order.slice(0, 4);
  return { dates: gd.dates, building: gd.dates.length < 2, series: top.map((genre) => ({ genre, values: gd.byGenre[genre] })) };
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

export async function getInsights(db: Querier, platform: Platform): Promise<Insight[]> {
  const gd = await genreVotesByDate(db, platform);
  const vels = gd.order.map((genre) => ({ genre, v: velocity(gd.byGenre[genre], gd.daySpan) }));
  const out: Insight[] = [];
  // (1) Rising genre by votes/day
  if (vels.length) {
    const top = vels.reduce((best, cur) => (cur.v > best.v ? cur : best), vels[0]);
    out.push({ kind: "up", tag: "RISING", meta: `+${Math.round(top.v)} votes/day`, text: `<b>${top.genre}</b> is gaining the most votes/day across the window.` });
  }
  // (2) Top opportunity gap
  const gaps = await getMarketGaps(db, platform);
  if (gaps.length)
    out.push({ kind: "gap", tag: "OPPORTUNITY", meta: `${gaps[0].supplyN} games · ${gaps[0].appetite} median votes`, text: `<b>${gaps[0].label}</b> shows high demand with thin supply.` });
  // (3) Hidden-gems count
  const gems = await getHiddenGems(db, platform);
  if (gems.length)
    out.push({ kind: "gem", tag: "HIDDEN GEMS", meta: `${gems.length} found`, text: `<b>${gems.length} hidden gems</b> rank in the top 25% on rating with low vote volume.` });
  // (4) Optional highest-quality genre by P75 rating
  const landscape = await getGenreLandscape(db, platform);
  if (landscape.length) {
    const best = landscape.reduce((b, c) => (c.p75Rating > b.p75Rating ? c : b), landscape[0]);
    out.push({ kind: "up", tag: "TOP QUALITY", meta: `P75 rating ${best.p75Rating.toFixed(2)}`, text: `<b>${best.genre}</b> has the highest P75 rating across all genres.` });
  }
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

export async function getGenreVelocityBars(db: Querier, platform: Platform): Promise<GenreVelocityBar[]> {
  const gd = await genreVotesByDate(db, platform);
  const counts = await db.query(
    `SELECT l.genre AS genre, count(*)::int AS n FROM v_latest l JOIN games g ON g.id=l.game_id JOIN sources src ON src.id=g.source_id WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)} GROUP BY l.genre`
  );
  const vol = new Map(counts.map((r) => [r.genre, num(r.n)]));
  const MIN_VOL = 4;
  return gd.order
    .filter((g) => (vol.get(g) ?? 0) >= MIN_VOL)
    .map((g) => ({ genre: g, votesPerDay: Math.round(velocity(gd.byGenre[g], gd.daySpan)) }))
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
  return tagNames.filter((t) => m.has(t)).map((label) => ({ label, kind: "tag" as const, count: m.get(label)!.count, examples: m.get(label)!.examples }));
}

export async function getOverview(db: Querier, platform: Platform): Promise<Overview> {
  const [momentum, tags, scatter, heatmap, gaps, insights, landscape, velocityBars] = await Promise.all([
    getGenreMomentum(db, platform),
    getTagFrequency(db, platform),
    getScatter(db, platform),
    getFeatureHeatmap(db, platform),
    getMarketGaps(db, platform),
    getInsights(db, platform),
    getGenreLandscape(db, platform),
    getGenreVelocityBars(db, platform),
  ]);
  const kpi = await getKPI(db, platform, gaps);
  const tagNames = [...new Set([...gaps.map((g) => g.tag), ...tags.map((t) => t.tag)])];
  const glossary: GlossaryRow[] = await getTagGlossary(db, platform, tagNames);
  return { kpi, momentum, tags, scatter, heatmap, gaps, insights, landscape, velocityBars, glossary, platform, subtitle: subtitleFor(platform) };
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
