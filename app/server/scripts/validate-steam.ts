// Phase 2 live validation (TEST_PLAN §E). Pulls real Steam data through the full
// pipeline (seed → enrich → load → analytics) into an in-memory PGlite and prints
// evidence. Set STEAM_DUMP_JSON=<path> to also write a machine-readable result.
// Network-dependent; not a unit test. Run: npx tsx server/scripts/validate-steam.ts
import { writeFileSync } from "node:fs";
import { makePglite, applySchema } from "../src/db/db.ts";
import { steamCrawl } from "../src/crawler/steam.ts";
import { loadGames } from "../src/crawler/load.ts";
import {
  getScaleTierBreakdown,
  getSteamGenreEconomics,
  getSteamComparables,
} from "../src/queries/index.ts";
import { assessSteamDataQuality } from "../src/checks/steamDataQuality.ts";

const limit = Number(process.env.STEAM_VALIDATE_LIMIT || 10);
const db = await makePglite();
await applySchema(db);

const { games, baseUrl } = await steamCrawl(limit, (m) => process.stdout.write(m));
const res = await loadGames(db, "steam", baseUrl, games, new Date().toISOString().slice(0, 10));

const fill = (
  await db.query(
    `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE rating IS NOT NULL)::int AS rating,
          count(*) FILTER (WHERE votes IS NOT NULL)::int AS votes,
          count(*) FILTER (WHERE owners_est IS NOT NULL)::int AS owners,
          count(*) FILTER (WHERE price_cents IS NOT NULL)::int AS price
   FROM game_snapshots`,
  )
)[0];

const tiers = await getScaleTierBreakdown(db, "steam");
const indie = await getSteamGenreEconomics(db, { cohort: "indie" });
const all = await getSteamGenreEconomics(db, { cohort: "all" });
const indieN = indie.reduce((s, r) => s + r.games, 0);
const allN = all.reduce((s, r) => s + r.games, 0);

const sample = await db.query(
  `SELECT g.title, l.scale_tier AS tier, l.genre, l.rating, l.votes,
          l.owners_est AS owners, l.price_cents AS price, l.ccu, l.median_playtime_min AS playtime, g.developer
   FROM v_latest l JOIN games g ON g.id = l.game_id ORDER BY l.owners_est DESC NULLS LAST`,
);

console.log(`\nE2 load: inserted=${res.inserted}/${games.length}`);
console.log("E2 field fill:", fill);
console.log("E4 tier distribution:", tiers.map((t) => `${t.tier}:${t.games}`).join(" "));
console.log(`E3 cohort sizes: indie=${indieN} < all=${allN} ?`, indieN < allN);
console.log("E3 indie genre economics (top 6):");
console.table(
  indie.slice(0, 6).map((r) => ({
    genre: r.genre,
    games: r.games,
    medPrice$: (r.medianPriceCents / 100).toFixed(2),
    medRating: r.medianRating,
    owners: r.totalOwners,
    revenueProxy$: r.revenueProxy,
  })),
);
console.table(sample.slice(0, 8));

// E5 — recency + accuracy gate (same invariants as the post-crawl canary). Asserts the live
// pipeline produced fresh, correctly-classified data — the class of bug shape-tests miss.
const comparables = await getSteamComparables(db, 14);
const aaaN = tiers.find((t) => t.tier === "aaa")?.games ?? 0;
// The validator crawls one fresh sample, so the whole sample IS the fresh cohort.
const dq = assessSteamDataQuality(
  {
    crawled: games.length,
    withDate: games.filter((g) => g.releaseDate).length,
    rated: games.filter((g) => g.rating != null).length,
    indie: games.length - aaaN,
    comparables: comparables.length,
  },
  // Small sample (STEAM_VALIDATE_LIMIT) — scale the size floors down; fill ratios stay meaningful.
  {
    minCrawled: Math.min(10, games.length),
    minDateFill: 0.5,
    minRatedFill: 0.4,
    minIndie: 3,
    minComparables: 1,
  },
);
console.log("\nE5 data-quality:", dq.metrics, dq.ok ? "✅" : "❌");
console.log(
  "E5 comparables (recent, indie):",
  comparables.map((c) => `${c.releaseDate ?? "—"} ${c.title}`).slice(0, 8),
);
if (!dq.ok) {
  for (const f of dq.failures) console.error("   - " + f);
}

const out = {
  generatedAtUTC: new Date().toISOString(),
  limit,
  parsed: games.length,
  inserted: res.inserted,
  fill,
  tiers,
  cohort: { indie: indieN, all: allN },
  indieEconomics: indie,
  allEconomics: all,
  sample,
  dataQuality: dq,
  comparables,
};
if (process.env.STEAM_DUMP_JSON) {
  writeFileSync(process.env.STEAM_DUMP_JSON, JSON.stringify(out, null, 2));
  console.log("wrote", process.env.STEAM_DUMP_JSON);
}
process.exit(dq.ok ? 0 : 1);
