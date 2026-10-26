import { beforeAll, describe, expect, it } from "vitest";
import { applySchema, freshMemoryDb, type Querier } from "../src/db/db.ts";
import { assessLoadVolume, CRAWLED_SOURCES, sourceLoadVolumes } from "../src/checks/loadVolume.ts";

// #269 — a crawl that loads 0 rows must fail the gate, per source, instead of letting every
// v_latest read silently re-evaluate the previous cohort. Drives the REAL query on PGlite.

let db: Querier;

/** Seed crawls per source: `counts[i]` snapshot rows on day i (oldest first). */
async function seed(bySource: Record<string, number[]>): Promise<void> {
  await db.exec(
    `TRUNCATE game_tags, game_snapshots, tags, games, crawls, sources RESTART IDENTITY CASCADE;`,
  );
  for (const [source, counts] of Object.entries(bySource)) {
    const sid = (
      await db.query(`INSERT INTO sources(name, base_url) VALUES ($1,$2) RETURNING id`, [
        source,
        `https://${source}.test`,
      ])
    )[0].id;
    for (const [d, n] of counts.entries()) {
      const day = `2026-10-${String(d + 1).padStart(2, "0")}`;
      const crawlId = (
        await db.query(
          `INSERT INTO crawls(source_id, started_at, status, games_seen) VALUES ($1,$2,'ok',$3) RETURNING id`,
          [sid, day, n],
        )
      )[0].id;
      for (let i = 0; i < n; i++) {
        const slug = `${source}-${i}`;
        const gid = (
          await db.query(
            `INSERT INTO games(source_id, source_game_id, url, title, last_seen_at)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (source_id, source_game_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
             RETURNING id`,
            [sid, slug, `https://${source}.test/${slug}`, slug, day],
          )
        )[0].id;
        await db.query(
          `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, votes) VALUES ($1,$2,$3,10)`,
          [gid, crawlId, day],
        );
      }
    }
  }
}

const healthy = [20, 20, 20, 20, 20, 20, 20, 20, 20];

async function assess() {
  return assessLoadVolume(await sourceLoadVolumes(db));
}

beforeAll(async () => {
  db = await freshMemoryDb();
  await applySchema(db);
});

describe("load volume per crawled source (#269)", () => {
  it("passes healthy loads and prints one line per source", async () => {
    await seed({ crazygames: healthy, poki: healthy, steam: healthy });
    const r = await assess();
    expect(r.failures).toEqual([]);
    expect(r.lines).toHaveLength(CRAWLED_SOURCES.length);
    expect(r.lines.find((l) => l.startsWith("steam:"))).toContain(
      "20 rows on 2026-10-09 vs median 20 over last 7",
    );
  });

  it("fails a 0-row Steam crawl even though v_latest still holds yesterday's cohort", async () => {
    await seed({ crazygames: healthy, poki: healthy, steam: [...healthy, 0] });
    const r = await assess();
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/steam loaded 0 rows on 2026-10-10/);
    expect(r.failures[0]).toMatch(/no skip reason is stored/);
  });

  it("scopes a dead browser portal to its own line without masking a healthy Steam", async () => {
    await seed({ crazygames: healthy, poki: [244, 3, 0, 0, 0, 0, 0, 0, 0], steam: healthy });
    const r = await assess();
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/^load volume: poki loaded 0 rows/);
    expect(r.lines.find((l) => l.startsWith("steam:"))).toMatch(/\(100%\)/);
  });

  it("fails a collapse below 25% of the 7-crawl median, but not a modest dip", async () => {
    await seed({ crazygames: [...healthy, 4], poki: [...healthy, 6], steam: healthy });
    const r = await assess();
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/crazygames loaded 4 rows .* 20% of its median 20/);
  });

  it("baseline is the 7 crawls BEFORE the latest, so old history cannot prop up a decline", async () => {
    // 100s long ago, then 7 days at 20 → median 20; latest 10 = 50%, passes.
    await seed({
      crazygames: [100, 100, 100, 20, 20, 20, 20, 20, 20, 20, 10],
      poki: healthy,
      steam: healthy,
    });
    const r = await assess();
    expect(r.failures).toEqual([]);
    expect(r.lines[0]).toContain("vs median 20 over last 7 (50%)");
  });

  it("fails a crawled source with no crawl at all; a first crawl has no baseline", async () => {
    await seed({ crazygames: [5], steam: healthy });
    const r = await assess();
    expect(r.lines[0]).toBe("crazygames: 5 rows on 2026-10-01 (no baseline yet)");
    expect(r.failures).toEqual([expect.stringMatching(/poki has no crawl recorded/)]);
  });
});
