// Post-crawl data-quality canary. Runs against the app DB (Neon in CI, local PGlite in dev),
// asserts recency + accuracy invariants on the CURRENT Steam data, and exits non-zero on failure
// so a crawl that silently produced stale/wrong data fails loudly instead of looking "green".
// Wired as the final step of the daily crawl. Run locally: npm run check:steam
import { appDb } from "../src/db/db.ts";
import { getSteamComparables } from "../src/queries/index.ts";
import { assessSteamDataQuality } from "../src/checks/steamDataQuality.ts";

// Golden appids: known-correct classifications that must hold regardless of thresholds.
const GOLDEN_INDIE = new Set(["1145360"]);            // Hades (self-pub megahit) → NOT aaa
const GOLDEN_AAA = new Set(["730", "578080"]);        // CS2 (Valve), PUBG (Krafton) → aaa

(async () => {
  const db = await appDb();

  // Accuracy/seed checks over the FRESHEST crawl cohort (games whose latest snapshot is from
  // the most recent crawl day) — not the whole append-only DB, whose legacy rows keep null
  // dates a single crawl can't fix and would false-fail the gate forever.
  const agg = (await db.query(
    `WITH steam AS (
       SELECT l.*, g.release_date
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources s ON s.id = g.source_id
       WHERE g.is_live AND s.name = 'steam'
     ), fresh AS (
       SELECT * FROM steam WHERE captured_at::date = (SELECT max(captured_at::date) FROM steam)
     )
     SELECT count(*)::int AS crawled,
            count(*) FILTER (WHERE release_date IS NOT NULL)::int AS with_date,
            count(*) FILTER (WHERE rating IS NOT NULL)::int AS rated,
            count(*) FILTER (WHERE scale_tier IS NULL OR scale_tier <> 'aaa')::int AS indie
     FROM fresh`
  ))[0];

  // Comparables is the actual queryable UI output over ALL live Steam games.
  const comparables = await getSteamComparables(db, 14);
  const res = assessSteamDataQuality({
    crawled: Number(agg.crawled), withDate: Number(agg.with_date),
    rated: Number(agg.rated), indie: Number(agg.indie), comparables: comparables.length,
  });

  const m = res.metrics;
  console.log("Steam data-quality (latest crawl cohort):", {
    crawled: m.crawled, dateFill: `${Math.round(m.dateFillPct * 100)}%`,
    rated: `${Math.round(m.ratedPct * 100)}%`, indie: m.indie, comparables: m.comparables,
  });

  // Golden spot-checks (only assert for appids actually present in the crawl).
  const golden = await db.query(
    `SELECT g.source_game_id AS appid, g.title, l.scale_tier AS tier
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources s ON s.id = g.source_id
     WHERE s.name = 'steam' AND g.source_game_id = ANY($1)`,
    [[...GOLDEN_INDIE, ...GOLDEN_AAA]]
  );
  for (const r of golden) {
    if (GOLDEN_INDIE.has(r.appid) && r.tier === "aaa")
      res.failures.push(`golden: ${r.title} classified aaa but should be indie-tier (backing≠scale)`);
    if (GOLDEN_AAA.has(r.appid) && r.tier !== "aaa")
      res.failures.push(`golden: ${r.title} classified ${r.tier} but is major-backed → should be aaa`);
  }
  if (golden.length) console.log("golden:", golden.map((r) => `${r.title}=${r.tier}`).join(", "));

  if (res.failures.length) {
    console.error("\n❌ STEAM DATA-QUALITY GATE FAILED:");
    for (const f of res.failures) console.error("   - " + f);
    process.exit(1);
  }
  console.log("\n✅ Steam data-quality gate passed");
  process.exit(0);
})();
