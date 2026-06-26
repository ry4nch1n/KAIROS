// Quick DB health check:  tsx src/db/stats.ts   (set DATABASE_URL for Neon)
import { appDb, usingNeon } from "./db.ts";
import * as q from "../queries/index.ts";

const db = await appDb();
const n = async (sql: string) => Number((await db.query(sql))[0]?.n ?? 0);

const games = await n("SELECT count(*)::int n FROM games");
const snaps = await n("SELECT count(*)::int n FROM game_snapshots");
const bySource = await db.query(
  "SELECT s.name, count(g.id)::int n FROM sources s LEFT JOIN games g ON g.source_id = s.id GROUP BY s.name ORDER BY s.name"
);
const sample = await db.query("SELECT title, engine FROM games ORDER BY id LIMIT 6");

console.log(`DB: ${usingNeon() ? "Neon" : "local PGlite"}`);
console.log(`games=${games}  snapshots=${snaps}`);
console.log(`by source: ${bySource.map((r) => `${r.name}:${r.n}`).join(", ")}`);
console.log(`sample: ${sample.map((r) => `${r.title} [${r.engine}]`).join(" | ")}`);

if (games > 0) {
  const ov = await q.getOverview(db, "all");
  console.log(`overview KPI: ${JSON.stringify(ov.kpi)}`);
  console.log(`top tags: ${ov.tags.slice(0, 8).map((t) => `${t.tag}:${t.count}`).join(", ")}`);
}
process.exit(0);
