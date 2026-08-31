// Post-crawl data-quality canary. Runs against the app DB (Neon in CI, local PGlite in dev),
// asserts recency + accuracy invariants on the CURRENT Steam data, and exits non-zero on failure
// so a crawl that silently produced stale/wrong data fails loudly instead of looking "green".
// Wired as the final step of the daily crawl. Run locally: npm run check:steam
//
// SCOPE, wider than the filename (#158): this is the daily crawl's ONLY gate step, so the
// cross-source capture-yield pass runs here too — the browser portals are crawled by the same
// workflow and had no gate of their own. Splitting it into a `check:browser` script would need
// a new npm script AND a new workflow step, both human-only surfaces; folding it in costs one
// import and keeps every invariant reporting in one place, which is the point of #158's
// placement decision. Renaming the script to match is a separate, human-owned change.
import { appDb } from "../src/db/db.ts";
import { getSteamComparables } from "../src/queries/index.ts";
import {
  assessCaptureYield,
  assessSteamDataQuality,
  DEFAULT_STEAM_QUALITY,
  type CaptureCohort,
} from "../src/checks/steamDataQuality.ts";
import { browserCaptureCohorts } from "../src/checks/browserCaptureYield.ts";
import { STEAM_AI_DISCLOSURE_MAX_AGE_DAYS } from "../src/crawler/steam.ts";

// Golden appids: known-correct classifications that must hold regardless of thresholds.
const GOLDEN_INDIE = new Set(["1145360"]); // Hades (self-pub megahit) → NOT aaa
const GOLDEN_AAA = new Set(["730", "578080"]); // CS2 (Valve), PUBG (Krafton) → aaa

(async () => {
  const db = await appDb();

  // Accuracy/seed checks over the FRESHEST crawl cohort (games whose latest snapshot is from
  // the most recent crawl day) — not the whole append-only DB, whose legacy rows keep null
  // dates a single crawl can't fix and would false-fail the gate forever.
  const agg = (
    await db.query(
      `WITH steam AS (
       SELECT l.*, g.release_date
       FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources s ON s.id = g.source_id
       WHERE g.is_live AND s.name = 'steam'
     ), fresh AS (
       SELECT *,
              -- Mirrors wantsAiDisclosure() in crawler/steam.ts: non-AAA, dated, released within
              -- the max-age window (+1 day of slack for future-dating). Both sides read the SAME
              -- persisted columns, so the two cohorts coincide; keep them in step if either moves.
              (scale_tier IS DISTINCT FROM 'aaa' AND release_date IS NOT NULL
               AND release_date BETWEEN (CURRENT_DATE - $1::int) AND (CURRENT_DATE + 1)) AS ai_wanted
       FROM steam WHERE captured_at::date = (SELECT max(captured_at::date) FROM steam)
     )
     SELECT count(*)::int AS crawled,
            count(*) FILTER (WHERE release_date IS NOT NULL)::int AS with_date,
            count(*) FILTER (WHERE rating IS NOT NULL)::int AS rated,
            count(*) FILTER (WHERE scale_tier IS NULL OR scale_tier <> 'aaa')::int AS indie,
            -- capture-yield cohorts (#158): eligible vs actually-carrying-a-value, per enrichment
            count(*) FILTER (WHERE coming_soon IS NOT NULL)::int AS release_state_captured,
            count(*) FILTER (WHERE coming_soon IS TRUE)::int AS upcoming,
            count(*) FILTER (WHERE coming_soon IS TRUE AND followers IS NOT NULL)::int AS followers_captured,
            count(*) FILTER (WHERE ai_wanted)::int AS ai_eligible,
            count(*) FILTER (WHERE ai_wanted AND ai_disclosure IS NOT NULL)::int AS ai_captured
     FROM fresh`,
      [STEAM_AI_DISCLOSURE_MAX_AGE_DAYS],
    )
  )[0];

  // Comparables is the actual queryable UI output over ALL live Steam games.
  const comparables = await getSteamComparables(db, 14);
  const res = assessSteamDataQuality({
    crawled: Number(agg.crawled),
    withDate: Number(agg.with_date),
    rated: Number(agg.rated),
    indie: Number(agg.indie),
    comparables: comparables.length,
  });

  const m = res.metrics;
  console.log("Steam data-quality (latest crawl cohort):", {
    crawled: m.crawled,
    dateFill: `${Math.round(m.dateFillPct * 100)}%`,
    rated: `${Math.round(m.ratedPct * 100)}%`,
    indie: m.indie,
    comparables: m.comparables,
  });

  // ── Capture yield (#158) ──────────────────────────────────────────────────
  // One row per OPTIONAL enrichment the Steam crawler attempts. Eligibility mirrors the
  // crawler's own gating predicate, so `captured/eligible` answers "did the fetch this run
  // actually made come back with anything", not "is the column populated across all time".
  // Adding the next enrichment = adding a row here plus its two counts above.
  // NOT listed, deliberately: teamSize is a static lookup table (data/teamSize.ts), not a
  // capture; reviewVelocity is derived from the `votes` series, whose fill the ratedFill floor
  // above already guards more tightly than 0%; featuredRank (homepage_position) is a
  // CrazyGames signal and belongs to a browser-source gate that does not exist yet.
  const n = (v: unknown) => Number(v ?? 0);
  const cohorts: CaptureCohort[] = [
    {
      key: "followers",
      eligible: n(agg.upcoming),
      captured: n(agg.followers_captured),
      why:
        "follower velocity cannot start — it needs >=2 snapshots carrying a value, and a " +
        "coming-soon title has no reviews and no owners to fall back on (#54).",
    },
    {
      key: "ai_disclosure",
      eligible: n(agg.ai_eligible),
      captured: n(agg.ai_captured),
      why: 'every reading collapses to "not checked", which reads identically to "no disclosure" (#110).',
    },
    {
      // The release-state marker is what makes the `followers` row above mean anything: if it
      // goes null wholesale the coming-soon cohort silently empties and the follower assertion
      // no-ops instead of failing. Floored at the crawl-size threshold, since a smaller cohort
      // is already a failure by minCrawled.
      key: "release_state",
      eligible: n(agg.crawled),
      captured: n(agg.release_state_captured),
      minCohort: DEFAULT_STEAM_QUALITY.minCrawled,
      why:
        "every market analytic silently includes unreleased titles AND the follower cohort " +
        "empties, taking its own 0%-capture assertion down with it (#54).",
    },
  ];
  const capture = assessCaptureYield(cohorts);
  console.log("Steam capture yield (latest crawl cohort):", capture.lines.join(" · "));
  res.failures.push(...capture.failures);

  // Browser portals (#56/#158). Their enrichments come from ONE shelf/listing fetch per crawl
  // whose failure is swallowed by design, so the same 0%-over-a-real-cohort rule applies — the
  // registry lives in checks/browserCaptureYield.ts and the cohorts are read from the rows the
  // browser crawls just wrote, in the same run of this workflow.
  const browser = assessCaptureYield(await browserCaptureCohorts(db));
  console.log("Browser capture yield (latest crawl cohort):", browser.lines.join(" · "));
  res.failures.push(...browser.failures);

  // Golden spot-checks (only assert for appids actually present in the crawl).
  const golden = await db.query(
    `SELECT g.source_game_id AS appid, g.title, l.scale_tier AS tier
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources s ON s.id = g.source_id
     WHERE s.name = 'steam' AND g.source_game_id = ANY($1)`,
    [[...GOLDEN_INDIE, ...GOLDEN_AAA]],
  );
  for (const r of golden) {
    if (GOLDEN_INDIE.has(r.appid) && r.tier === "aaa")
      res.failures.push(
        `golden: ${r.title} classified aaa but should be indie-tier (backing≠scale)`,
      );
    if (GOLDEN_AAA.has(r.appid) && r.tier !== "aaa")
      res.failures.push(
        `golden: ${r.title} classified ${r.tier} but is major-backed → should be aaa`,
      );
  }
  if (golden.length) console.log("golden:", golden.map((r) => `${r.title}=${r.tier}`).join(", "));

  if (res.failures.length) {
    console.error("\n❌ CRAWL DATA-QUALITY GATE FAILED:");
    for (const f of res.failures) console.error("   - " + f);
    process.exit(1);
  }
  console.log("\n✅ Crawl data-quality gate passed");
  process.exit(0);
})();
