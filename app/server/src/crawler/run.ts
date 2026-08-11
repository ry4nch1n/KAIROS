// Live crawl CLI:  tsx src/crawler/run.ts <crazygames|poki|steam>   (CRAWL_LIMIT env to cap)
import { crazygames } from "./crazygames.ts";
import { poki } from "./poki.ts";
import { steamCrawl } from "./steam.ts";
import { crawlRotation, loadGames } from "./load.ts";
import { politeFetch, sleep, type SourceAdapter, type RawGame } from "./base.ts";
import { appDb, applySchema, usingNeon } from "../db/db.ts";
import { assessFollowerCapture } from "../checks/steamDataQuality.ts";

const ADAPTERS: Record<string, SourceAdapter> = { crazygames, poki };

const which = process.argv[2] || "crazygames";
const limit = Number(process.env.CRAWL_LIMIT || 30);

const db = await appDb();
if (!usingNeon()) await applySchema(db);
const date = new Date().toISOString().slice(0, 10); // date-only => one crawl per day (idempotent)

let raw: RawGame[] = [];
let sourceName: string;
let baseUrl: string;

if (which === "steam") {
  // Steam is JSON/multi-endpoint, not HTML-sitemap — uses its own orchestrator.
  const r = await steamCrawl(limit, (m) => process.stdout.write(m));
  raw = r.games;
  sourceName = "steam";
  baseUrl = r.baseUrl;
} else {
  const adapter = ADAPTERS[which];
  if (!adapter) {
    console.error("unknown source:", which, "available: crazygames, poki, steam");
    process.exit(1);
  }
  // Rotation = how many times this source has been crawled. Successive runs therefore start
  // at a different sitemap offset (#99) instead of re-fetching the same prefix forever.
  const rotation = await crawlRotation(db, adapter.name);
  console.log(`[${adapter.name}] enumerating (limit ${limit}, rotation ${rotation})…`);
  const urls = await adapter.listGameUrls(limit, { rotation });
  console.log(`[${adapter.name}] ${urls.length} game urls`);
  for (const url of urls) {
    try {
      const html = await politeFetch(url);
      raw.push(adapter.parseGame(html, url));
      process.stdout.write(".");
    } catch (e) {
      console.warn("\n  skip", url, String(e));
    }
    await sleep(2000); // polite ~1 req / 2s
  }
  console.log("");
  sourceName = adapter.name;
  baseUrl = adapter.baseUrl;
}

const res = await loadGames(db, sourceName, baseUrl, raw, date);
console.log(
  `✔ [${sourceName}] loaded crawlId=${res.crawlId} inserted=${res.inserted}/${raw.length}`,
);

// Follower-capture gate (#54). Asserted against the DB (the snapshots this run just wrote), not
// against the crawl log, and only for Steam — the coming-soon cohort is the follower cohort.
// Deliberately AFTER the load: append-only snapshots are still persisted, we only change the
// exit code, so a red run never costs a day of data.
if (sourceName === "steam") {
  const fc = (
    await db.query(
      `SELECT count(*) FILTER (WHERE coming_soon IS TRUE)::int AS eligible,
              count(*) FILTER (WHERE coming_soon IS TRUE AND followers IS NOT NULL)::int AS captured
       FROM game_snapshots WHERE crawl_id = $1`,
      [res.crawlId],
    )
  )[0];
  const eligible = Number(fc?.eligible ?? 0);
  const captured = Number(fc?.captured ?? 0);
  console.log(`[steam] followers captured ${captured}/${eligible} eligible (coming-soon cohort)`);
  const failure = assessFollowerCapture(eligible, captured);
  if (failure) {
    console.error(`\n❌ STEAM FOLLOWER-CAPTURE GATE FAILED:\n   - ${failure}`);
    process.exit(1);
  }
}
process.exit(0);
