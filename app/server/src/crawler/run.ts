// Live crawl CLI:  tsx src/crawler/run.ts crazygames    (CRAWL_LIMIT env to cap)
import { crazygames } from "./crazygames.ts";
import { loadGames } from "./load.ts";
import { politeFetch, sleep, type SourceAdapter } from "./base.ts";
import { appDb, applySchema, usingNeon } from "../db/db.ts";

const ADAPTERS: Record<string, SourceAdapter> = { crazygames };

const which = process.argv[2] || "crazygames";
const limit = Number(process.env.CRAWL_LIMIT || 30);
const adapter = ADAPTERS[which];
if (!adapter) {
  console.error("unknown source:", which, "available:", Object.keys(ADAPTERS).join(", "));
  process.exit(1);
}

const db = await appDb();
if (!usingNeon()) await applySchema(db);

console.log(`[${adapter.name}] enumerating (limit ${limit})…`);
const urls = await adapter.listGameUrls(limit);
console.log(`[${adapter.name}] ${urls.length} game urls`);

const raw = [];
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

const date = new Date().toISOString();
const res = await loadGames(db, adapter.name, adapter.baseUrl, raw, date);
console.log(`✔ loaded crawlId=${res.crawlId} inserted=${res.inserted}/${raw.length}`);
process.exit(0);
