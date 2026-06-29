import { applySchema, type Querier } from "../src/db/db.ts";

const DAYS = ["2026-06-25", "2026-06-26", "2026-06-27"]; // 3 consecutive crawl days
const GENRES_POKI = ["Puzzle", "Casual", "Idle", "Adventure"];
const GENRES_CG = ["Shooter", ".io", "Driving", "Horror"];
const TAGS: Record<string, string[]> = {
  Puzzle: ["puzzle", "logic"], Casual: ["casual"], Idle: ["idle", "merge"], Adventure: ["adventure"],
  Shooter: ["shooter", "action"], ".io": ["io", "multiplayer"], Driving: ["driving"], Horror: ["horror"],
};

async function one(db: Querier, sql: string, p: unknown[]) { return (await db.query(sql, p))[0]; }

// featured ALWAYS false — mirrors what the live crawler writes.
export async function seedRealShape(db: Querier): Promise<void> {
  await applySchema(db);
  await db.exec(`TRUNCATE library_items, brief_editions, game_tags, game_snapshots, tags, games, crawls, sources RESTART IDENTITY CASCADE;`);
  const tagId = new Map<string, number>();
  const ensureTag = async (n: string) => tagId.get(n) ?? (tagId.set(n, (await one(db, "INSERT INTO tags(name) VALUES ($1) RETURNING id", [n])).id), tagId.get(n)!);

  const sources = [
    { name: "poki", base: "https://poki.com", genres: GENRES_POKI, dev: true },
    { name: "crazygames", base: "https://crazygames.com", genres: GENRES_CG, dev: false },
  ];
  for (const src of sources) {
    const sid = (await one(db, "INSERT INTO sources(name, base_url) VALUES ($1,$2) RETURNING id", [src.name, src.base])).id;
    const crawlIds: number[] = [];
    for (const d of DAYS) crawlIds.push((await one(db, "INSERT INTO crawls(source_id, started_at, finished_at, status, games_seen) VALUES ($1,$2,$2,'ok',0) RETURNING id", [sid, d])).id);
    let i = 0;
    for (const genre of src.genres) {
      for (let k = 0; k < 4; k++) { // 4 games per genre = 16/source
        i++;
        const slug = `${genre.toLowerCase().replace(/[^a-z]/g, "")}-${src.name}-${i}`;
        const baseVotes = Math.floor(50 + (i * 137 % 4000));       // deterministic spread 50..4050
        const rating = +(3.2 + ((i * 53) % 17) / 10).toFixed(2);   // 3.2..4.9 deterministic
        const gid = (await one(db,
          `INSERT INTO games(source_id, source_game_id, url, title, developer, first_seen_at, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [sid, slug, `${src.base}/g/${slug}`, `${genre} ${i}`, src.dev ? `Dev ${(i % 5) + 1}` : null, DAYS[0], DAYS[2]])).id;
        for (const tn of [...(TAGS[genre] ?? [genre.toLowerCase()])]) {
          await db.query("INSERT INTO game_tags(game_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [gid, await ensureTag(tn)]);
        }
        for (let di = 0; di < DAYS.length; di++) {
          await db.query(
            `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, featured, genre)
             VALUES ($1,$2,$3,$4,$5,false,$6)`,
            [gid, crawlIds[di], DAYS[di], rating, baseVotes + di * (10 + (i % 20)), genre]); // votes rise each day
        }
      }
    }
  }
}
