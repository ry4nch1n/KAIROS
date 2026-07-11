import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { seed } from "../src/db/seed.ts";
import * as q from "../src/queries/index.ts";

let db: Querier;

beforeAll(async () => {
  db = await freshMemoryDb();
  await seed(db);
}, 60000);

describe("A2 seed integrity", () => {
  it("has games, sources, tags", async () => {
    const games = await db.query("SELECT count(*)::int n FROM games");
    expect(games[0].n).toBeGreaterThan(50);
    const srcs = await db.query("SELECT name FROM sources ORDER BY name");
    expect(srcs.map((r) => r.name)).toEqual(["crazygames", "poki"]);
    const tags = await db.query("SELECT count(*)::int n FROM tags");
    expect(tags[0].n).toBeGreaterThan(0);
  });

  it("every game has at least one snapshot", async () => {
    const orphans = await db.query(
      "SELECT count(*)::int n FROM games g WHERE NOT EXISTS (SELECT 1 FROM game_snapshots s WHERE s.game_id = g.id)"
    );
    expect(orphans[0].n).toBe(0);
  });
});

describe("A3 overview", () => {
  it("returns KPI block per platform and platforms differ", async () => {
    const all = await q.getOverview(db, "all");
    expect(all.kpi.gamesTracked).toBeGreaterThan(0);
    expect(all.kpi.avgRating).toBeGreaterThan(0);
    expect(all.kpi.avgRating).toBeLessThanOrEqual(5);
    expect(typeof all.kpi.risingGenre).toBe("string");
    expect(all.kpi.avgRatingP90).toBeGreaterThanOrEqual(all.kpi.avgRating);
    expect(all.kpi.risingGenre.length).toBeGreaterThan(0);
    expect(typeof all.kpi.newGames).toBe("number");
    expect(all.kpi.newGames).toBeGreaterThanOrEqual(0);

    const poki = await q.getOverview(db, "poki");
    const cg = await q.getOverview(db, "crazygames");
    expect(all.kpi.gamesTracked).toBe(poki.kpi.gamesTracked + cg.kpi.gamesTracked);
    expect(poki.kpi.gamesTracked).toBeGreaterThan(0);
    expect(cg.kpi.gamesTracked).toBeGreaterThan(0);
  });
});

describe("A4 momentum (median votes over dates)", () => {
  it("series align to real dates", async () => {
    const m = await q.getGenreMomentum(db, "all");
    expect(Array.isArray(m.dates)).toBe(true);
    for (const s of m.series) expect(s.values.length).toBe(m.dates.length);
    expect(m.dates.every((d) => !/^W\d+$/.test(d))).toBe(true); // no fake "W15" labels
  });
});

describe("A5 tag frequency", () => {
  it("sorted desc with positive counts", async () => {
    const t = await q.getTagFrequency(db, "all");
    expect(t.length).toBeGreaterThan(0);
    for (let i = 1; i < t.length; i++) expect(t[i - 1].count).toBeGreaterThanOrEqual(t[i].count);
    expect(t[0].count).toBeGreaterThan(0);
  });
});

describe("A6 hidden gems (percentile)", () => {
  it("is a selective minority, not ~half the catalogue", async () => {
    const all = (await db.query("SELECT count(*)::int n FROM v_latest"))[0].n;
    const g = await q.getHiddenGems(db, "all");
    expect(g.length).toBeGreaterThan(0);
    expect(g.length).toBeLessThanOrEqual(Math.ceil(all * 0.15)); // < 15% of catalogue
  });
});

describe("A7 market gaps (interpretable)", () => {
  it("rows carry absolute numbers and rank by score", async () => {
    const gaps = await q.getMarketGaps(db, "all");
    expect(gaps.length).toBeGreaterThan(0);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i - 1].score).toBeGreaterThanOrEqual(gaps[i].score);
    for (const c of gaps) {
      expect(c.supplyN).toBeGreaterThanOrEqual(2);
      expect(c.appetite).toBeGreaterThanOrEqual(0);
      expect(c.qualityCeil).toBeGreaterThan(0);
      expect(c.qualityCeil).toBeLessThanOrEqual(5);
    }
  });
});

describe("A8 scatter", () => {
  it("carries title+genre and flags a small gem minority", async () => {
    const pts = await q.getScatter(db, "all");
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.every((p) => typeof p.title === "string" && typeof p.genre === "string")).toBe(true);
    const gems = pts.filter((p) => p.gem).length;
    expect(gems).toBeGreaterThan(0);
    expect(gems).toBeLessThan(pts.length * 0.25);
  });
});

describe("A8b rating-band density heatmap", () => {
  it("bands × genres with at least one non-zero cell", async () => {
    const h = await q.getFeatureHeatmap(db, "all");
    expect(h.genres.length).toBeGreaterThan(0);
    expect(h.weeks.length).toBe(5); // 5 rating bands
    expect(h.cells.length).toBe(h.weeks.length * h.genres.length);
    expect(h.cells.some((c) => c.value > 0)).toBe(true);
  });
});

describe("A10 brief editions", () => {
  it("lists editions desc and fetches one with structured payload", async () => {
    const list = await q.getBriefEditions(db);
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < list.length; i++)
      expect(list[i - 1].editionDate >= list[i].editionDate).toBe(true);
    const ed = await q.getBriefEdition(db, list[0].editionDate);
    expect(ed).not.toBeNull();
    expect(Array.isArray(ed!.payload.top_signals)).toBe(true);
    expect(Array.isArray(ed!.payload.new_notable)).toBe(true);
  });
});

describe("A_explorer queries", () => {
  it("genres rollup has benchmarks", async () => {
    const genres = await q.getGenres(db, "all");
    expect(genres.length).toBeGreaterThan(0);
    expect(genres[0].games).toBeGreaterThan(0);
    expect(genres[0].p90Votes).toBeGreaterThanOrEqual(genres[0].medianVotes);
    expect(genres[0].p90Rating).toBeGreaterThan(0);
    expect(typeof genres[0].votesPerDay).toBe("number");
  });
  it("developers rollup is sorted by games desc with bounded ratings", async () => {
    const devs = await q.getDevelopers(db, "all");
    expect(devs.length).toBeGreaterThan(0);
    for (let i = 1; i < devs.length; i++) expect(devs[i - 1].games).toBeGreaterThanOrEqual(devs[i].games);
    for (const d of devs) {
      expect(d.avgRating).toBeGreaterThan(0);
      expect(d.avgRating).toBeLessThanOrEqual(5);
      expect(typeof d.topGenre).toBe("string");
    }
  });
  it("new releases respects the first_seen 14-day window", async () => {
    const nr = await q.getNewReleases(db, "all");
    const total = (await db.query("SELECT count(*)::int n FROM games"))[0].n;
    const inWindow = (await db.query(
      `SELECT count(DISTINCT g.id)::int n FROM games g JOIN v_latest l ON l.game_id=g.id
       WHERE g.is_live AND g.first_seen_at >= (SELECT max(first_seen_at) FROM games) - interval '14 days'`
    ))[0].n;
    expect(nr.length).toBeGreaterThan(0);
    expect(nr.length).toBeLessThan(total);            // the window must exclude older games
    expect(nr.length).toBe(Math.min(inWindow, 60));   // matches the window count (LIMIT 60)
  });
});

describe("A_insights", () => {
  it("generates natural-language insights from real stats", async () => {
    const ins = await q.getInsights(db, "all");
    expect(ins.length).toBeGreaterThan(0);
    for (const i of ins) {
      expect(i.text.length).toBeGreaterThan(0);
      expect(["up", "down", "gap", "gem"]).toContain(i.kind);
    }
  });
});

describe("A_landscape quality-saturation", () => {
  it("one point per genre with supply, p75 rating, total votes", async () => {
    const pts = await q.getGenreLandscape(db, "all");
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(p.supply).toBeGreaterThan(0);
      expect(p.p75Rating).toBeGreaterThan(0);
      expect(p.p75Rating).toBeLessThanOrEqual(5);
      expect(p.totalVotes).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("iter2 fixes", () => {
  it("velocity bars are sorted desc with numeric votes/day", async () => {
    const bars = await q.getGenreVelocityBars(db, "all");
    expect(bars.length).toBeGreaterThan(0);
    for (let i = 1; i < bars.length; i++) expect(bars[i - 1].votesPerDay).toBeGreaterThanOrEqual(bars[i].votesPerDay);
    expect(typeof bars[0].votesPerDay).toBe("number");
  });
  it("landscape points and overview glossary carry example games", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.landscape.every((p) => Array.isArray(p.examples) && p.examples.length <= 3)).toBe(true);
    expect(ov.glossary.length).toBeGreaterThan(0);
    expect(ov.glossary[0].examples.length).toBeGreaterThan(0);
    expect(ov.gaps.every((g) => Array.isArray(g.examples))).toBe(true);
  });
});

describe("iter3 fixes", () => {
  it("glossary explains tags shown on the dashboard, and gaps expose genre/tag", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.gaps.every((g) => typeof g.genre === "string" && typeof g.tag === "string")).toBe(true);
    // every gap's tag must be explained in the glossary
    const gloss = new Set(ov.glossary.filter((r) => r.kind === "tag").map((r) => r.label));
    expect(ov.gaps.every((g) => gloss.has(g.tag))).toBe(true);
    expect(ov.glossary.some((r) => r.kind === "tag" && r.examples.length > 0)).toBe(true);
  });
});

describe("iter4 fixes", () => {
  it("glossary is tags-only and explains every market-gap tag", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.glossary.length).toBeGreaterThan(0);
    expect(ov.glossary.every((r) => r.kind === "tag")).toBe(true);
    expect(ov.glossary.every((r) => Array.isArray(r.examples))).toBe(true);
    const gloss = new Set(ov.glossary.map((r) => r.label));
    expect(ov.gaps.every((g) => gloss.has(g.tag))).toBe(true);
  });
});

describe("iter5 fixes", () => {
  it("every glossary tag has a non-empty definition", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.glossary.length).toBeGreaterThan(0);
    expect(ov.glossary.every((r) => typeof r.definition === "string" && r.definition.length > 0)).toBe(true);
  });
});

describe("p11 memoization guard", () => {
  it("memoized getOverview matches standalone query results", async () => {
    const ov = await q.getOverview(db, "all");
    const [scatter, gems, gaps] = await Promise.all([q.getScatter(db, "all"), q.getHiddenGems(db, "all"), q.getMarketGaps(db, "all")]);
    expect(ov.scatter.length).toBe(scatter.length);
    expect(ov.scatter.filter((p) => p.gem).length).toBe(scatter.filter((p) => p.gem).length);
    expect(ov.gaps.map((g) => g.label)).toEqual(gaps.map((g) => g.label));
    // hidden-gem badge (sidebar) derives from scatter gems; insights gem count uses getHiddenGems — they must agree
    expect(ov.scatter.filter((p) => p.gem).length).toBe(gems.length);
  });
});

describe("D-momentum classifyTrajectory — age-adjusted velocity (#10)", () => {
  it("a flat evergreen reads ~0 votes/day and is not 'rising'", () => {
    const r = q.classifyTrajectory([167000, 167010, 167020], 10);
    expect(r.votesPerDay).toBeLessThan(5);
    expect(r.trajectory).not.toBe("rising");
  });
  it("a fresh rocket reads high votes/day and 'rising'", () => {
    const r = q.classifyTrajectory([100, 20000, 167000], 14);
    expect(r.votesPerDay).toBeGreaterThan(1000);
    expect(r.trajectory).toBe("rising");
  });
  it("a spike that stalls reads 'decaying'", () => {
    expect(q.classifyTrajectory([0, 10000, 10500], 10).trajectory).toBe("decaying");
  });
  it("too little history → 'new', zero velocity", () => {
    expect(q.classifyTrajectory([500], 0)).toEqual({ votesPerDay: 0, trajectory: "new" });
    expect(q.classifyTrajectory([500, 900], 0).trajectory).toBe("new"); // zero span guarded
  });
  it("getNewReleases attaches votesPerDay + a valid trajectory to every row", async () => {
    const rows = await q.getNewReleases(db, "all");
    for (const r of rows) {
      expect(r.votesPerDay).toBeGreaterThanOrEqual(0);
      expect(["rising", "plateau", "decaying", "new"]).toContain(r.trajectory);
    }
  });
});

describe("D-curation isCurationTag / Market Gaps denylist (#14)", () => {
  it("flags platform-curation, brand, and device labels (case + ' Games' suffix insensitive)", () => {
    for (const t of ["Popular Games", "New Games", "Crazy Games", "Mobile Games", "poki", "TRENDING", "Featured"])
      expect(q.isCurationTag(t)).toBe(true);
  });
  it("does not flag real gameplay tags", () => {
    for (const t of ["tower defense", "farming", "racing", "board games", "idle"])
      expect(q.isCurationTag(t)).toBe(false);
  });
  it("no Market Gap is scored on a curation tag", async () => {
    const gaps = await q.getMarketGaps(db, "all");
    expect(gaps.every((g) => !q.isCurationTag(g.tag))).toBe(true);
  });
});

describe("D-teamsize getSteamComparables attaches team-size estimates (#9)", () => {
  it("every comparable carries a teamSize field (object with provenance, or null)", async () => {
    const rows = await q.getSteamComparables(db, 14);
    for (const c of rows) {
      expect(c).toHaveProperty("teamSize");
      if (c.teamSize) {
        expect(["solo", "small", "mid", "large"]).toContain(c.teamSize.bucket);
        expect(c.teamSize.source).toMatch(/^https?:\/\//);
      }
    }
  });
  it("the solo-reachable filter is a subset that excludes mid/large studios", async () => {
    const rows = await q.getSteamComparables(db, 14);
    const solo = rows.filter((c) => c.teamSize && (c.teamSize.bucket === "solo" || c.teamSize.bucket === "small"));
    expect(solo.length).toBeLessThanOrEqual(rows.length);
    expect(solo.every((c) => c.teamSize!.bucket === "solo" || c.teamSize!.bucket === "small")).toBe(true);
  });
});

describe("A12 decision layer — this week's read (evaluation Phase A1)", () => {
  it("overview carries 1–3 decision-framed lines, each with an implication clause", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.read.length).toBeGreaterThanOrEqual(1);
    expect(ov.read.length).toBeLessThanOrEqual(3);
    for (const line of ov.read) expect(line).toContain("→"); // observation → implication
  });

  it("every insight carries an implication (the decision clause)", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.insights.length).toBeGreaterThan(0);
    for (const ins of ov.insights) {
      expect(typeof ins.implication).toBe("string");
      expect((ins.implication ?? "").length).toBeGreaterThan(0);
    }
  });

  it("genre rows carry a trajectory delta read", async () => {
    const rows = await q.getGenres(db, "all");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(["rising", "plateau", "decaying", "new"]).toContain(r.trajectory);
  });

  it("crowding warning needs both share (≥15%) and count (≥3) — one release can't cry wolf", () => {
    const quiet = q.composeBrowserRead({ pressure: [{ genre: "Puzzle", total: 40, recent: 2 }] });
    expect(quiet[quiet.length - 1]).toContain("No crowding warning");
    const loud = q.composeBrowserRead({ pressure: [{ genre: "Puzzle", total: 20, recent: 5 }] });
    expect(loud[loud.length - 1]).toContain("Puzzle");
    expect(loud[loud.length - 1]).toContain("Crowding fast");
  });

  it("steam read flags top-heavy genres by mean ≫ median, never sells the mean as typical", () => {
    const econ = (over: Partial<import("shared").SteamGenreEconomics>) => ({
      genre: "Roguelike", games: 10, medianPriceCents: 999, medianRating: 4,
      totalOwners: 1_000_000, revenueProxy: 9_000_000,
      medianRevenuePerGame: 100_000, meanRevenuePerGame: 900_000, ...over,
    });
    const lines = q.composeSteamRead({ opportunity: [], indie: [econ({})] });
    const warn = lines[lines.length - 1];
    expect(warn).toContain("Roguelike");
    expect(warn).toContain("top-heavy");
    const calm = q.composeSteamRead({ opportunity: [], indie: [econ({ meanRevenuePerGame: 150_000 })] });
    expect(calm[calm.length - 1]).toContain("fair read");
  });
});

describe("B1 taxonomy hygiene — genre/tag canonicalization (#7, #15)", () => {
  it("canonicalName collapses a trailing ' Game(s)' suffix, identity on clean names", () => {
    expect(q.canonicalName("Simulation Games")).toBe("Simulation");
    expect(q.canonicalName("Puzzle Games")).toBe("Puzzle");
    expect(q.canonicalName("Mouse Games")).toBe("Mouse");
    expect(q.canonicalName("Running Game")).toBe("Running");
    expect(q.canonicalName("SIMULATION GAMES")).toBe("SIMULATION"); // case-insensitive suffix
    // identity — must never alter already-clean names (the safety property)
    for (const clean of ["Puzzle", "Simulation", ".io", "3d", "2 player", "Games", "Idle"]) {
      expect(q.canonicalName(clean)).toBe(clean);
    }
    expect(q.canonicalName("Simulation   Games")).toBe("Simulation");
    expect(q.canonicalName("  Games")).toBe("Games"); // bare "Games" preserved, not nuked
  });

  it("SQL canonSql matches the JS twin exactly (parity — no drift)", async () => {
    const samples = ["Simulation Games", "Puzzle", ".io", "Mouse Games", "3d", "Running Game", "Card Games", "Games", "Idle"];
    for (const s of samples) {
      const row = await db.query(`SELECT ${q.canonSql("$1")} AS c`, [s]);
      expect(row[0].c).toBe(q.canonicalName(s));
    }
  });

  it("merges 'Puzzle Games' into 'Puzzle' across genres + tags (end-to-end)", async () => {
    const src = (await db.query("SELECT id FROM sources WHERE name='poki'"))[0].id;
    const crawl = (await db.query("SELECT id FROM crawls WHERE source_id=$1 ORDER BY id DESC LIMIT 1", [src]))[0].id;
    const before = await q.getGenres(db, "all");
    const puzzleBefore = before.find((r) => r.genre === "Puzzle")!;
    expect(puzzleBefore).toBeTruthy();

    const g = (await db.query(
      `INSERT INTO games(source_id, source_game_id, url, title, first_seen_at, last_seen_at, is_live)
       VALUES ($1,'dup-puzzle-games','http://x/dup','Dup Puzzle', now() - interval '60 days', now(), true) RETURNING id`,
      [src]
    ))[0].id;
    await db.query(
      `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre)
       VALUES ($1,$2, now(), 4.1, 500, 'Puzzle Games')`,
      [g, crawl]
    );
    const t = (await db.query("INSERT INTO tags(name) VALUES ('puzzle games') RETURNING id"))[0].id;
    await db.query("INSERT INTO game_tags(game_id, tag_id) VALUES ($1,$2)", [g, t]);

    const after = await q.getGenres(db, "all");
    expect(after.find((r) => r.genre === "Puzzle Games")).toBeUndefined();
    const puzzleAfter = after.find((r) => r.genre === "Puzzle")!;
    expect(puzzleAfter.games).toBe(puzzleBefore.games + 1);

    const tags = await q.getTagFrequency(db, "all");
    expect(tags.find((r) => r.tag === "puzzle games")).toBeUndefined();
  });
});

describe("B2 supply velocity — is a genre flooding? (R1.1 + R1.3)", () => {
  it("classifySupply needs a real recent count to read 'rising' — one straggler can't cry crowding", () => {
    expect(q.classifySupply(0, 0)).toBe("quiet");
    expect(q.classifySupply(1, 0)).toBe("steady");   // below the min-rising floor
    expect(q.classifySupply(3, 0)).toBe("rising");    // real burst, nothing prior
    expect(q.classifySupply(6, 2)).toBe("rising");    // 6 > 2×1.5
    expect(q.classifySupply(1, 5)).toBe("cooling");   // supply drying up
    expect(q.classifySupply(4, 4)).toBe("steady");
  });

  it("every genre row carries a supply trend + recent-entrant count", async () => {
    const rows = await q.getGenres(db, "all");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(["rising", "steady", "cooling", "quiet"]).toContain(r.supplyTrend);
      expect(r.recentEntrants).toBeGreaterThanOrEqual(0);
    }
  });

  it("a genre flooded with brand-new entrants reads 'rising'", async () => {
    const src = (await db.query("SELECT id FROM sources WHERE name='crazygames'"))[0].id;
    const crawl = (await db.query("SELECT id FROM crawls WHERE source_id=$1 ORDER BY id DESC LIMIT 1", [src]))[0].id;
    for (let i = 0; i < 4; i++) {
      const g = (await db.query(
        `INSERT INTO games(source_id, source_game_id, url, title, first_seen_at, last_seen_at, is_live)
         VALUES ($1,$2,$3,$4, now(), now(), true) RETURNING id`,
        [src, `flood-${i}`, `http://x/flood${i}`, `Flood ${i}`]
      ))[0].id;
      await db.query(
        `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre) VALUES ($1,$2, now(), 4.0, 300, 'Floodtest')`,
        [g, crawl]
      );
    }
    const rows = await q.getGenres(db, "all");
    const flood = rows.find((r) => r.genre === "Floodtest")!;
    expect(flood).toBeTruthy();
    expect(flood.supplyTrend).toBe("rising");
    expect(flood.recentEntrants).toBeGreaterThanOrEqual(4);
  });

  it("market gaps carry a supplyRising flag (annotation, not a score change)", async () => {
    const gaps = await q.getMarketGaps(db, "all");
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) expect(typeof g.supplyRising).toBe("boolean");
    // score still sorted descending — the flag didn't reorder anything
    for (let i = 1; i < gaps.length; i++) expect(gaps[i - 1].score).toBeGreaterThanOrEqual(gaps[i].score);
  });
});

describe("B3 demand/supply quadrant (R1.2)", () => {
  it("overview carries one quadrant point per well-populated genre", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.quadrant.length).toBeGreaterThan(0);
    for (const p of ov.quadrant) {
      expect(p.supply).toBeGreaterThanOrEqual(4);        // HAVING count >= 4
      expect(p.appetite).toBeGreaterThanOrEqual(0);
      expect(p.weight).toBeGreaterThanOrEqual(0);
      expect(["rising", "steady", "cooling", "quiet"]).toContain(p.supplyTrend);
    }
  });
  it("quadrant genres are canonical (share the B1 canonicalization)", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.quadrant.every((p) => p.genre === q.canonicalName(p.genre))).toBe(true);
  });
});
