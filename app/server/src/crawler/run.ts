// Live crawl CLI:  tsx src/crawler/run.ts <crazygames|poki|steam>   (CRAWL_LIMIT env to cap)
import { crazygames } from "./crazygames.ts";
import { poki } from "./poki.ts";
import { steamCrawl } from "./steam.ts";
import { loadGames } from "./load.ts";
import { politeFetch, sleep, type SourceAdapter, type RawGame } from "./base.ts";
import { appDb, applySchema, usingNeon } from "../db/db.ts";

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
  console.log(`[${adapter.name}] enumerating (limit ${limit})…`);
  const urls = await adapter.listGameUrls(limit);
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
console.log(`✔ [${sourceName}] loaded crawlId=${res.crawlId} inserted=${res.inserted}/${raw.length}`);
process.exit(0);
