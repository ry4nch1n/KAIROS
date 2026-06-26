// Append-only loader. Upserts identity, creates/reuses a crawl for the day,
// inserts immutable snapshots (idempotent per crawl day via UNIQUE(game_id, crawl_id)).
import type { Querier } from "../db/db.ts";
import type { RawGame } from "./base.ts";

async function one(db: Querier, sql: string, params: unknown[]) {
  return (await db.query(sql, params))[0];
}

export async function loadGames(
  db: Querier,
  sourceName: string,
  baseUrl: string,
  games: RawGame[],
  crawlDateISO: string
): Promise<{ crawlId: number; inserted: number }> {
  const src = await one(
    db,
    `INSERT INTO sources(name, base_url) VALUES ($1,$2)
     ON CONFLICT (name) DO UPDATE SET base_url = EXCLUDED.base_url RETURNING id`,
    [sourceName, baseUrl]
  );
  const sourceId = src.id as number;

  // find or create the crawl for this day (so re-running the same day is idempotent)
  let crawl = await one(db, `SELECT id FROM crawls WHERE source_id = $1 AND started_at = $2`, [
    sourceId,
    crawlDateISO,
  ]);
  if (!crawl) {
    crawl = await one(
      db,
      `INSERT INTO crawls(source_id, started_at, status) VALUES ($1,$2,'running') RETURNING id`,
      [sourceId, crawlDateISO]
    );
  }
  const crawlId = crawl.id as number;

  // coerce to a string|null so a stray object/number never poisons a TEXT column
  const s = (v: unknown): string | null =>
    v == null ? null : typeof v === "string" ? v : typeof v === "object" ? (((v as any).name ?? (v as any).title) ?? null) : String(v);

  let inserted = 0;
  let skipped = 0;
  for (const r of games) {
    try {
      const game = await one(
        db,
        `INSERT INTO games(source_id, source_game_id, url, title, thumbnail_url, developer, description, engine, orientation, mobile, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (source_id, source_game_id) DO UPDATE SET
           url = EXCLUDED.url, title = EXCLUDED.title, thumbnail_url = EXCLUDED.thumbnail_url,
           developer = EXCLUDED.developer, description = EXCLUDED.description, engine = EXCLUDED.engine,
           orientation = EXCLUDED.orientation, mobile = EXCLUDED.mobile, last_seen_at = EXCLUDED.last_seen_at,
           is_live = true
         RETURNING id`,
        [sourceId, s(r.sourceGameId), s(r.url), s(r.title), s(r.thumbnailUrl), s(r.developer), s(r.description), s(r.engine), s(r.orientation), r.mobile, crawlDateISO]
      );
      const gameId = game.id as number;

      const before = await db.query(
        `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, featured, genre)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (game_id, crawl_id) DO NOTHING RETURNING id`,
        [gameId, crawlId, crawlDateISO, r.rating, r.votes, r.featured, s(r.genre)]
      );
      if (before.length) inserted++;

      for (const tn of r.tags) {
        const name = s(tn);
        if (!name) continue;
        const tag = await one(
          db,
          `INSERT INTO tags(name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [name]
        );
        await db.query(`INSERT INTO game_tags(game_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [gameId, tag.id]);
      }
    } catch (e) {
      skipped++;
      console.warn(`  skip load ${r.sourceGameId}: ${String(e)}`);
    }
  }
  if (skipped) console.warn(`  ${skipped} records skipped on load`);

  await db.query(`UPDATE crawls SET finished_at = $2, status = 'ok', games_seen = $3 WHERE id = $1`, [
    crawlId,
    crawlDateISO,
    games.length,
  ]);
  return { crawlId, inserted };
}
