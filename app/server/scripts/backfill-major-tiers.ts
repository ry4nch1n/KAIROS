// Maintenance one-off (idempotent): promote existing Steam rows whose developer is a known
// major backer to scale_tier='aaa' — e.g. Sucker Punch Productions → Ghost of Tsushima, which
// a scale-only classifier had left as est_indie and which won't be re-crawled (not indie-tagged).
// Only PROMOTES to aaa; self-published megahits mis-stored as aaa are corrected by re-crawl.
// Publisher isn't stored, so this keys off the developer field (catches first-party studios).
// Runs in CI (Backfill Major Tiers workflow) where the DATABASE_URL secret is available —
// Netlify masks the secret for local `dev:exec`, so this can't run from a dev machine.
import { makePg } from "../src/db/db.ts";
import { isMajorBacked } from "../src/crawler/steam.ts";

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("no DATABASE_URL — run in CI or with the Neon secret set"); process.exit(1); }
  const db = await makePg(url);

  const rows = await db.query(
    `SELECT l.game_id, g.title, g.developer, l.scale_tier
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources s ON s.id = g.source_id
     WHERE s.name = 'steam' AND (l.scale_tier IS NULL OR l.scale_tier <> 'aaa') AND g.developer IS NOT NULL`
  );
  const toFix = rows.filter((r) => isMajorBacked([r.developer], []));
  console.log(`steam rows below aaa: ${rows.length} | major-backed to promote: ${toFix.length}`);
  for (const r of toFix) console.log(`  ${r.title}  [${r.developer}]  ${r.scale_tier ?? "null"} -> aaa`);

  let updated = 0;
  for (const r of toFix) {
    await db.query(
      `UPDATE game_snapshots SET scale_tier = 'aaa'
       WHERE game_id = $1 AND captured_at = (SELECT max(captured_at) FROM game_snapshots WHERE game_id = $1)`,
      [r.game_id]
    );
    updated++;
  }
  console.log(`✔ updated ${updated} latest snapshots -> aaa`);
  process.exit(0);
})();
