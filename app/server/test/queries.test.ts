import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, applySchema, type Querier } from "../src/db/db.ts";
import { seed } from "../src/db/seed.ts";
import * as q from "../src/queries/index.ts";
import { MIN_MARKET_SUPPLY } from "../src/queries/shared.ts";
import { loadGames } from "../src/crawler/load.ts";
import { loopFamilyFor, MAPPED_FAMILIES } from "../src/data/loopFamilyMap.ts";
// Contract runtime values by RELATIVE path — never the bare "shared" specifier (which breaks the
// Netlify bundle); matches how queries/index.ts imports CONTRACT.
import { CONTRACT } from "../../shared/src/contract.ts";

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
    // steam joined the seed so Radar's DEFAULT panel is developable locally —
    // before that, every local `npm run dev` opened on an empty dashboard.
    expect(srcs.map((r) => r.name)).toEqual(["crazygames", "poki", "steam"]);
    const tags = await db.query("SELECT count(*)::int n FROM tags");
    expect(tags[0].n).toBeGreaterThan(0);
  });

  it("every game has at least one snapshot", async () => {
    const orphans = await db.query(
      "SELECT count(*)::int n FROM games g WHERE NOT EXISTS (SELECT 1 FROM game_snapshots s WHERE s.game_id = g.id)",
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
    // #204 S3: no single rising genre on `all` — one mover per portal, each in its own unit.
    expect(all.kpi.risingGenre).toBeNull();
    expect(all.kpi.risingVotesPerDay).toBeNull();
    expect(all.kpi.avgRatingP90).toBeGreaterThanOrEqual(all.kpi.avgRating);
    expect(all.kpi.risingByPortal.length).toBeGreaterThan(0);
    for (const r of all.kpi.risingByPortal) expect(r.genre.length).toBeGreaterThan(0);
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
    const portals = await q.getGenreMomentum(db, "all");
    expect(portals.length).toBeGreaterThan(0);
    for (const m of portals) {
      expect(Array.isArray(m.dates)).toBe(true);
      for (const s of m.series) expect(s.values.length).toBe(m.dates.length);
      expect(m.dates.every((d) => !/^W\d+$/.test(d))).toBe(true); // no fake "W15" labels
    }
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

describe("A5b setting/theme facet (#25)", () => {
  it("derives settings from tags, sorted desc, only vocabulary values, with examples", async () => {
    const { CONTRACT } = await import("shared");
    const vocab = new Set<string>(CONTRACT.taxonomy.settings as readonly string[]);
    const s = await q.getSettingFacets(db, "all");
    expect(s.length).toBeGreaterThan(0);
    for (let i = 1; i < s.length; i++) expect(s[i - 1].count).toBeGreaterThanOrEqual(s[i].count);
    for (const row of s) {
      expect(vocab.has(row.setting)).toBe(true); // never an unmapped/guessed setting
      expect(row.count).toBeGreaterThan(0);
      expect(row.examples.length).toBeGreaterThan(0);
      expect(row.examples.length).toBeLessThanOrEqual(3);
    }
    // orthogonal axis: per-platform totals never exceed the "all" (browser) total
    const poki = await q.getSettingFacets(db, "poki");
    const sum = (rows: typeof s) => rows.reduce((a, r) => a + r.count, 0);
    expect(sum(poki)).toBeLessThanOrEqual(sum(s));
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
    for (let i = 1; i < gaps.length; i++)
      expect(gaps[i - 1].score).toBeGreaterThanOrEqual(gaps[i].score);
    for (const c of gaps) {
      expect(c.appetite).toBeGreaterThanOrEqual(0);
      // On `all` the ceiling is a within-portal rating percentile, 0–100 (#243).
      expect(c.ratingUnit).toBe("ratingPercentile");
      expect(c.qualityCeil).toBeGreaterThan(0);
      expect(c.qualityCeil).toBeLessThanOrEqual(100);
    }
  });

  // #215 — the browser mirror of #211. The gap score negates supply, so a two-game cell earned the
  // biggest supply term exactly where its median-votes demand was least trustworthy; on the seed,
  // 4 of 6 shown rows (rank 1 included) sat at the old floor of 2. One shared floor, both surfaces.
  it("admits no ranked row below the shared market-supply floor (#215)", async () => {
    for (const p of ["all", "crazygames", "poki"] as const) {
      const ranked = await q.rankMarketGaps(db, p);
      expect(ranked.length).toBeGreaterThan(0);
      for (const g of ranked) expect(g.supplyN).toBeGreaterThanOrEqual(MIN_MARKET_SUPPLY);
    }
    expect(MIN_MARKET_SUPPLY).toBe(3);
  });

  // #230 — one row per distinct market. The seed carries Horror × horror / Cooking × cooking, which
  // held 2 of the 6 shown seats before the Steam-parity genre filter.
  it("never ranks a tag that restates its genre (#230)", async () => {
    for (const p of ["all", "crazygames", "poki"] as const)
      for (const g of await q.rankMarketGaps(db, p)) {
        expect(g.tag.toLowerCase()).not.toBe(g.genre.toLowerCase());
        expect(Array.isArray(g.aliasTags)).toBe(true);
      }
  });

  it("folds identical game sets into one row, keeping the broader tag (#230)", () => {
    const cell = (tag: string, ids: string) => ({ genre: "Puzzle", tag, ids });
    const counts = new Map([
      ["Stickman", 40],
      ["Henry Stickmin", 6],
      ["Logic", 90],
    ]);
    const out = q.collapseIdenticalCells(
      [cell("Henry Stickmin", "1,2,3"), cell("Stickman", "1,2,3"), cell("Logic", "1,2,3,4")],
      counts,
    );
    // Identical sets → one row with the alias; overlapping-but-unequal stays its own market.
    expect(out.map((r) => [r.tag, r.aliasTags])).toEqual([
      ["Stickman", ["Henry Stickmin"]],
      ["Logic", []],
    ]);
    // Same set in a different genre is a different market.
    expect(
      q.collapseIdenticalCells(
        [cell("A", "1,2,3"), { ...cell("B", "1,2,3"), genre: "Action" }],
        counts,
      ),
    ).toHaveLength(2);
    // Tie on catalogue count → alphabetical, independent of input order.
    const tie = q.collapseIdenticalCells([cell("Zed", "7,8,9"), cell("Ant", "7,8,9")], new Map());
    expect(tie.map((r) => [r.tag, r.aliasTags])).toEqual([["Ant", ["Zed"]]]);
  });

  it("ranks nothing rather than artifacts when every cell sits under the floor (#215)", async () => {
    const thin = await freshMemoryDb();
    const CG = "https://www.crazygames.com";
    const game = (id: string, tag: string, votes: number) => ({
      url: `${CG}/game/${id}`,
      title: `Game ${id}`,
      thumbnailUrl: null,
      developer: "Dev",
      description: null,
      engine: null,
      orientation: null,
      mobile: false,
      genre: "Casual",
      tags: [tag],
      rating: 4.5,
      votes,
      featured: false,
      releaseDate: null,
      plays: votes * 10,
      ownersEst: null,
      priceCents: null,
      discountPct: null,
      ccu: null,
      medianPlaytimeMin: null,
      metacritic: null,
      scaleTier: null,
      sourceGameId: id,
    });
    // Every cell is a pair — none is a market — and the pair with enormous demand would have
    // ranked first under the old floor.
    await loadGames(
      thin,
      "crazygames",
      CG,
      [
        game("a1", "merge", 9_000_000),
        game("a2", "merge", 9_000_000),
        game("b1", "physics", 1_000),
        game("b2", "physics", 2_000),
      ],
      "2026-06-30T00:00:00.000Z",
    );
    expect(await q.getMarketGaps(thin, "crazygames")).toEqual([]);
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
    // No raw level pooled across vote bases on `all` — the within-portal percentile instead (#204 S4).
    expect(genres[0].medianVotes).toBeNull();
    expect(genres[0].p90VotePct!).toBeGreaterThanOrEqual(genres[0].medianVotePct!);
    expect(genres[0].p90VotePct!).toBeLessThanOrEqual(100);
    const pokiLevels = (await q.getGenres(db, "poki"))[0];
    expect(pokiLevels.p90Votes!).toBeGreaterThanOrEqual(pokiLevels.medianVotes!);
    expect(pokiLevels.medianVotePct).toBeNull();
    expect(genres[0].p90Rating).toBeGreaterThan(0);
    expect(genres[0].votesPerDay).toBeNull(); // no pooled rate on `all` (#204 S3)
    expect(genres[0].momentum.length).toBeGreaterThan(0);
    const poki = await q.getGenres(db, "poki");
    expect(typeof poki[0].votesPerDay).toBe("number");
  });
  it("developers rollup is sorted by games desc with bounded ratings", async () => {
    const devs = await q.getDevelopers(db, "all");
    expect(devs.length).toBeGreaterThan(0);
    for (let i = 1; i < devs.length; i++)
      expect(devs[i - 1].games).toBeGreaterThanOrEqual(devs[i].games);
    for (const d of devs) {
      expect(d.avgRating).toBeGreaterThan(0);
      expect(d.avgRating).toBeLessThanOrEqual(5);
      expect(typeof d.topGenre).toBe("string");
    }
  });
  it("new releases respects the first_seen 14-day window", async () => {
    const nr = await q.getNewReleases(db, "all");
    const total = (await db.query("SELECT count(*)::int n FROM games"))[0].n;
    // The control query must carry the SAME platform predicate as the query it
    // checks. "all" means browser-only, and the 14-day anchor is scoped to that
    // catalog on purpose — an unscoped max(first_seen_at) lets one source's crawl
    // recency set another's window, which is the exact defect newAnchor() guards
    // against. This assertion silently relied on the seed being browser-only until
    // steam was added to it.
    const BROWSER = "AND src.name IN ('poki','crazygames')";
    const inWindow = (
      await db.query(
        `SELECT count(DISTINCT g.id)::int n FROM games g JOIN v_latest l ON l.game_id=g.id
         JOIN sources src ON src.id = g.source_id
       WHERE g.is_live ${BROWSER} AND g.first_seen_at >= (
         SELECT max(g2.first_seen_at) FROM games g2 JOIN sources src2 ON src2.id = g2.source_id
         WHERE g2.is_live AND src2.name IN ('poki','crazygames')
       ) - interval '14 days'`,
      )
    )[0].n;
    expect(nr.length).toBeGreaterThan(0);
    expect(nr.length).toBeLessThan(total); // the window must exclude older games
    expect(nr.length).toBe(Math.min(inWindow, 60)); // matches the window count (LIMIT 60)
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
      expect(p.p75Rating).toBeLessThanOrEqual(100); // within-portal rating percentile on `all` (#243)
      // `all` weighs by within-portal percentile, never a raw sum across vote bases (#204 S4).
      expect(p.totalVotes).toBeNull();
      expect(p.voteWeight!).toBeGreaterThanOrEqual(0);
      expect(p.voteWeight!).toBeLessThanOrEqual(p.supply);
    }
    for (const p of await q.getGenreLandscape(db, "poki")) {
      expect(p.totalVotes!).toBeGreaterThanOrEqual(0);
      expect(p.voteWeight).toBeNull();
    }
  });
});

describe("iter2 fixes", () => {
  it("velocity bars are sorted desc within each portal, each in exactly one unit", async () => {
    const bars = await q.getGenreVelocityBars(db, "all");
    expect(bars.length).toBeGreaterThan(0);
    const val = (b: (typeof bars)[number]) =>
      (b.voteBasis === "window" ? b.engagementPctPerWeek : b.votesPerDay) as number;
    for (const b of bars) {
      expect(typeof val(b)).toBe("number");
      expect(b.voteBasis === "window" ? b.votesPerDay : b.engagementPctPerWeek).toBeNull();
    }
    for (let i = 1; i < bars.length; i++)
      if (bars[i - 1].source === bars[i].source)
        expect(val(bars[i - 1])).toBeGreaterThanOrEqual(val(bars[i]));
  });
  it("landscape points and overview glossary carry example games", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.landscape.every((p) => Array.isArray(p.examples) && p.examples.length <= 3)).toBe(
      true,
    );
    expect(ov.glossary.length).toBeGreaterThan(0);
    expect(ov.glossary[0].examples.length).toBeGreaterThan(0);
    expect(ov.gaps.every((g) => Array.isArray(g.examples))).toBe(true);
  });
});

describe("iter3 fixes", () => {
  it("glossary explains tags shown on the dashboard, and gaps expose genre/tag", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.gaps.every((g) => typeof g.genre === "string" && typeof g.tag === "string")).toBe(
      true,
    );
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
    expect(
      ov.glossary.every((r) => typeof r.definition === "string" && r.definition.length > 0),
    ).toBe(true);
  });
});

describe("p11 memoization guard", () => {
  it("memoized getOverview matches standalone query results", async () => {
    const ov = await q.getOverview(db, "all");
    const [scatter, gems, gaps] = await Promise.all([
      q.getScatter(db, "all"),
      q.getHiddenGems(db, "all"),
      q.getMarketGaps(db, "all"),
    ]);
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
      // Per basis (#204): votes/day on cumulative rows, null (never 0) on window rows.
      if (r.voteBasis === "window") expect(r.votesPerDay).toBeNull();
      else expect(r.votesPerDay).toBeGreaterThanOrEqual(0);
      expect(["rising", "plateau", "decaying", "new"]).toContain(r.trajectory);
    }
  });
});

describe("D-curation isCurationTag / Market Gaps denylist (#14)", () => {
  it("flags platform-curation, brand, and device labels (case + ' Games' suffix insensitive)", () => {
    for (const t of [
      "Popular Games",
      "New Games",
      "Crazy Games",
      "Mobile Games",
      "poki",
      "TRENDING",
      "Featured",
    ])
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
    const solo = rows.filter(
      (c) => c.teamSize && (c.teamSize.bucket === "solo" || c.teamSize.bucket === "small"),
    );
    expect(solo.length).toBeLessThanOrEqual(rows.length);
    expect(solo.every((c) => c.teamSize!.bucket === "solo" || c.teamSize!.bucket === "small")).toBe(
      true,
    );
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
    for (const r of rows)
      for (const m of r.momentum)
        expect(["rising", "plateau", "decaying", "new"]).toContain(m.trajectory);
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
      genre: "Roguelike",
      games: 10,
      medianPriceCents: 999,
      medianRating: 4,
      totalOwners: 1_000_000,
      revenueProxy: 9_000_000,
      medianRevenuePerGame: 100_000,
      meanRevenuePerGame: 900_000,
      ...over,
    });
    const lines = q.composeSteamRead({ opportunity: [], indie: [econ({})] });
    const warn = lines[lines.length - 1];
    expect(warn).toContain("Roguelike");
    expect(warn).toContain("top-heavy");
    const calm = q.composeSteamRead({
      opportunity: [],
      indie: [econ({ meanRevenuePerGame: 150_000 })],
    });
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
    const samples = [
      "Simulation Games",
      "Puzzle",
      ".io",
      "Mouse Games",
      "3d",
      "Running Game",
      "Card Games",
      "Games",
      "Idle",
    ];
    for (const s of samples) {
      const row = await db.query(`SELECT ${q.canonSql("$1")} AS c`, [s]);
      expect(row[0].c).toBe(q.canonicalName(s));
    }
  });

  it("merges 'Puzzle Games' into 'Puzzle' across genres + tags (end-to-end)", async () => {
    const src = (await db.query("SELECT id FROM sources WHERE name='poki'"))[0].id;
    const crawl = (
      await db.query("SELECT id FROM crawls WHERE source_id=$1 ORDER BY id DESC LIMIT 1", [src])
    )[0].id;
    const before = await q.getGenres(db, "all");
    const puzzleBefore = before.find((r) => r.genre === "Puzzle")!;
    expect(puzzleBefore).toBeTruthy();

    const g = (
      await db.query(
        `INSERT INTO games(source_id, source_game_id, url, title, first_seen_at, last_seen_at, is_live)
       VALUES ($1,'dup-puzzle-games','http://x/dup','Dup Puzzle', now() - interval '60 days', now(), true) RETURNING id`,
        [src],
      )
    )[0].id;
    await db.query(
      `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre)
       VALUES ($1,$2, now(), 4.1, 500, 'Puzzle Games')`,
      [g, crawl],
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
    expect(q.classifySupply(1, 0)).toBe("steady"); // below the min-rising floor
    expect(q.classifySupply(3, 0)).toBe("rising"); // real burst, nothing prior
    expect(q.classifySupply(6, 2)).toBe("rising"); // 6 > 2×1.5
    expect(q.classifySupply(1, 5)).toBe("cooling"); // supply drying up
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
    const crawl = (
      await db.query("SELECT id FROM crawls WHERE source_id=$1 ORDER BY id DESC LIMIT 1", [src])
    )[0].id;
    for (let i = 0; i < 4; i++) {
      const g = (
        await db.query(
          `INSERT INTO games(source_id, source_game_id, url, title, first_seen_at, last_seen_at, is_live)
         VALUES ($1,$2,$3,$4, now(), now(), true) RETURNING id`,
          [src, `flood-${i}`, `http://x/flood${i}`, `Flood ${i}`],
        )
      )[0].id;
      await db.query(
        `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre) VALUES ($1,$2, now(), 4.0, 300, 'Floodtest')`,
        [g, crawl],
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
    for (let i = 1; i < gaps.length; i++)
      expect(gaps[i - 1].score).toBeGreaterThanOrEqual(gaps[i].score);
  });

  it("market gaps expose score components that recombine to the composite (#87)", async () => {
    const gaps = await q.getMarketGaps(db, "all");
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      expect(g.components).toMatchObject({
        demand: expect.any(Number),
        quality: expect.any(Number),
        supply: expect.any(Number),
      });
      // The three exposed terms ARE the score's own intermediates — they must sum to it
      // (each term independently rounded to 2dp, so allow ±0.02), so exposure can never
      // drift from the formula.
      const sum = g.components.demand + g.components.quality + g.components.supply;
      expect(Math.abs(sum - g.score)).toBeLessThanOrEqual(0.02);
    }
  });
});

describe("B3 demand/supply quadrant (R1.2)", () => {
  it("overview carries one quadrant point per well-populated genre", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.quadrant.length).toBeGreaterThan(0);
    for (const p of ov.quadrant) {
      expect(p.supply).toBeGreaterThanOrEqual(4); // HAVING count >= 4
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

describe("B4 small wins — conversion signal on Steam genre economics (R4.1)", () => {
  it("every economics row carries a conversion field (ConversionRef or null)", async () => {
    const rows = await q.getSteamGenreEconomics(db, { cohort: "indie" });
    // Seed is browser-only, so Steam economics may be empty — assert the shape when present.
    for (const r of rows) {
      expect("conversion" in r).toBe(true);
      if (r.conversion) {
        expect(["strong", "typical", "deliberation"]).toContain(r.conversion.signal);
        expect(typeof r.conversion.source).toBe("string");
      }
    }
  });
});

// The migrate-time backfill that links EXISTING prototype cards to their pitch by URL
// convention (…/<slug>/). This is what converts the already-posted cards (Jester's War,
// Starbind, Duskloom) — the ones not in the curated seed — onto the derived status, so it
// has to keep working or those cards silently keep their stale stored status.
describe("library_items.pitch_slug backfill", () => {
  it("self-links a card whose media_url embeds a pitch slug, then derives that pitch's status", async () => {
    const fresh = await freshMemoryDb();
    await fresh.query(
      `INSERT INTO pitches (slug, title, status, pitch_date) VALUES ($1,$2,$3,$4)`,
      ["backfill-me-20260719", "Backfill Me", "building", "2026-07-19"],
    );
    // a card posted before pitch_slug existed: link is NULL, stored status is stale
    await fresh.query(
      `INSERT INTO library_items (kind, title, media_url, status) VALUES ($1,$2,$3,$4)`,
      [
        "prototype",
        "Backfill Me — Loop Toy",
        "https://kairos-prototypes.netlify.app/backfill-me-20260719/",
        "prototyping",
      ],
    );

    await applySchema(fresh); // idempotent re-apply = what a migrate does

    const [row] = await fresh.query(
      `SELECT pitch_slug FROM library_items WHERE title = 'Backfill Me — Loop Toy'`,
    );
    expect(row.pitch_slug).toBe("backfill-me-20260719");

    const card = (await q.libraryItems(fresh)).find((c) => c.pitchSlug === "backfill-me-20260719");
    expect(card?.status).toBe("building"); // derived, not the stale "prototyping"
  });

  it("leaves an unmatched card unlinked and falls back to its own status", async () => {
    const fresh = await freshMemoryDb();
    await fresh.query(
      `INSERT INTO library_items (kind, title, media_url, status) VALUES ($1,$2,$3,$4)`,
      ["prototype", "Off-Host Toy", "https://some-other-host.netlify.app", "prototyping"],
    );
    await applySchema(fresh);
    const card = (await q.libraryItems(fresh)).find((c) => c.title === "Off-Host Toy");
    expect(card?.pitchSlug).toBeNull();
    expect(card?.status).toBe("prototyping");
  });
});

describe("#108 loop-family map", () => {
  const families = new Set<string>(CONTRACT.pitch.loopFamilies as readonly string[]);

  it("every mapped family is a live contract loopFamilies value (rename ⇒ CI fails here)", () => {
    expect(MAPPED_FAMILIES.length).toBeGreaterThan(0);
    for (const f of MAPPED_FAMILIES) expect(families.has(f)).toBe(true);
  });

  it("pins genre default + genre × tag override + unmapped fallthrough", () => {
    expect(loopFamilyFor("Idle")).toBe("idle-tycoon"); // genre default, case-insensitive
    expect(loopFamilyFor("Cooking")).toBe("cozy-craft");
    expect(loopFamilyFor("Strategy")).toBeNull(); // no genre claim; the tag routes it
    expect(loopFamilyFor("Strategy", "tower-defense")).toBe("wave-defense-prep");
    expect(loopFamilyFor("Shooter")).toBeNull(); // unmapped never force-fits
    expect(loopFamilyFor("nope", "nonsense")).toBeNull();
  });

  it("#179 resolves the widened keys, and still refuses the genres no family holds", () => {
    // `driving` was a key and `racing` was not, so the top-velocity browser genre fed nothing.
    expect(loopFamilyFor("Racing")).toBe(loopFamilyFor("Driving"));
    expect(loopFamilyFor("Racing")).toBe("route-planning");
    expect(loopFamilyFor("Car")).toBe("route-planning");
    expect(loopFamilyFor("Escape")).toBe("contained-systemic");
    expect(loopFamilyFor("Tycoon")).toBe("idle-tycoon");
    expect(loopFamilyFor("Decoration")).toBe("cozy-craft");
    expect(loopFamilyFor("Restaurant")).toBe("cozy-craft");
    // Steam spells the same tags in prose, browser portals in slugs; both forms must resolve.
    expect(loopFamilyFor("Strategy", "Tower Defense")).toBe("wave-defense-prep");
    expect(loopFamilyFor("Shooter", "Looter Shooter")).toBe("extraction-lite");
    // Deliberately unmapped: a shelf label or a loop no family holds stays null, never force-fit.
    for (const g of ["Sports", "Fighting", "Battle Royale", ".io", "Arcade", "Beauty", "Skill"])
      expect(loopFamilyFor(g)).toBeNull();
    // Steam's genre axis is five grab-bags, so a Steam sub-genre tag resolves on the TAG alone.
    expect(loopFamilyFor("Action", "Looter Shooter")).toBe("extraction-lite");
    expect(loopFamilyFor("Indie", "Roguelike Deckbuilder")).toBe("synergy-builder");
    expect(loopFamilyFor("Casual", "Idler")).toBe("idle-tycoon");
    expect(loopFamilyFor("Adventure", "Farming Sim")).toBe("cozy-craft");
    expect(loopFamilyFor("RPG", "Automation")).toBe("automation-under-pressure");
    // …but a genre carrying its own default is never yanked off it by a minority tag.
    expect(loopFamilyFor("Puzzle", "Idler")).toBe("route-planning");
    // Setting/mode tags and shelves no one family holds stay null on the tag axis too.
    for (const t of ["Open World", "Survival", "Crafting", "Souls-like", "Card Battler"])
      expect(loopFamilyFor("Action", t)).toBeNull();
  });

  it("#217 a co-tag pair places a game neither tag places alone, under the same guard", () => {
    const fam = (genre: string, tags: string[]) =>
      q.tagSlices([{ genre, tags }]).map((s) => [s.family, s.label]);
    // The intersection is the survivors shelf; each tag alone stays unmapped (Hades; shmups).
    expect(fam("Action", ["Action Roguelike", "Bullet Hell", "Pixel Graphics"])).toEqual([
      ["minimal-input-survivors", "Action × Action Roguelike + Bullet Hell"],
    ]);
    expect(fam("Indie", ["Action Roguelike", "Pixel Graphics"])).toEqual([]);
    expect(fam("Action", ["Bullet Hell", "Shoot 'Em Up"])).toEqual([]);
    for (const t of ["Action Roguelike", "Bullet Hell"])
      expect(loopFamilyFor("Action", t)).toBeNull();
    // A pair is one vote, not an override: another tag naming a different family ⇒ unassigned.
    expect(fam("Action", ["Action Roguelike", "Bullet Hell", "Tower Defense"])).toEqual([]);
    // …and it agrees with a single tag naming the same family.
    expect(fam("Indie", ["Bullet Hell", "Survivors-like", "Action Roguelike"])).toHaveLength(1);
    // A genre default still wins outright; the pair never pulls a defaulted genre off it.
    expect(fam("Idle", ["Action Roguelike", "Bullet Hell"])).toEqual([["idle-tycoon", "Idle"]]);
  });
});

describe("#108 getLoopFamilyMarket", () => {
  it("rolls the browser market up by family, distinct-counted, with uncovered families", async () => {
    const m = await q.getLoopFamilyMarket(db, "all");
    expect(m.platform).toBe("all");
    const families = new Set<string>(CONTRACT.pitch.loopFamilies as readonly string[]);
    const covered = new Set(m.rows.map((r) => r.family));

    // Every emitted + uncovered family is real; covered ∪ uncovered partitions the universe.
    for (const r of m.rows) expect(families.has(r.family)).toBe(true);
    for (const f of m.uncovered) expect(families.has(f) && !covered.has(f)).toBe(true);
    expect(covered.size + m.uncovered.length).toBe(families.size);
    expect(covered.size).toBeGreaterThan(0);

    for (const r of m.rows) {
      expect(r.supplyN > 0).toBe(r.genres.length > 0); // a Steam-only row carries neither (#67)
      expect(["rising", "steady", "cooling", "quiet"]).toContain(r.supplyTrend);
    }

    // #179: the tag axis may now SPLIT a genre across families, so a slice reads "Genre × Tag"
    // and a family's supply is bounded by the genres its slices came out of. The no-double-count
    // rule survives the split as a global invariant — every game is attributed at most once.
    const genres = await q.getGenres(db, "all");
    const bySupply = new Map(genres.map((g) => [g.genre, g.games]));
    for (const r of m.rows) {
      let cap = 0;
      for (const label of r.genres) {
        const g = label.split(" × ")[0];
        expect(bySupply.has(g)).toBe(true);
        cap += bySupply.get(g) ?? 0;
      }
      expect(r.supplyN).toBeLessThanOrEqual(cap);
    }
    expect(m.rows.reduce((a, r) => a + r.supplyN, 0)).toBeLessThanOrEqual(
      genres.reduce((a, g) => a + g.games, 0),
    );

    // #179: the tag split reaches families the genre-whole fold could not — on the seed the
    // browser read answers for 8 of 9, where genre-grain coverage left most of the menu blank.
    expect(covered.size).toBeGreaterThanOrEqual(8);
  });

  it("#67 sets Steam economics and a route lean beside the browser read", async () => {
    const st = (pull: number | null, crowding = false) => ({ pull, crowding, mapped: true });
    expect(q.marketRouteLean(2, false, st(0.5))).toBe("browser");
    expect(q.marketRouteLean(0.5, false, st(2))).toBe("steam");
    expect(q.marketRouteLean(1, false, st(1))).toBe("contested");
    expect(q.marketRouteLean(1.3, true, st(1))).toBe("contested"); // crowding damps the lead away
    expect(q.marketRouteLean(1, false, st(null))).toBe("browser"); // MEASURED absence IS the lean
    expect(q.marketRouteLean(null, false, st(1))).toBe("steam");
    expect(q.marketRouteLean(null, false, st(null))).toBeNull();

    // #179 — an UNMEASURED Steam side is not a browser lean. Nothing maps in, so the comparison
    // the chip claims to have made never happened; only the mapped-but-empty case above is a lean.
    const un = (pull: number | null) => ({ pull, crowding: false, mapped: false });
    expect(q.marketRouteLean(1, false, un(null))).toBe("steam-unmapped");
    expect(q.marketRouteLean(9, false, un(null))).toBe("steam-unmapped"); // strength can't rescue it
    expect(q.marketRouteLean(null, false, un(null))).toBeNull(); // neither surface read at all

    const m = await q.getLoopFamilyMarket(db, "all");
    expect(m.rows.some((r) => r.steam)).toBe(true);
    for (const r of m.rows) {
      // No Steam coverage is null, NEVER a zero-economics row; no browser supply is a null
      // appetite, and such a family is a row on Steam's strength alone rather than whitespace.
      expect(r.steam === null || r.steam.games > 0).toBe(true);
      expect(r.supplyN > 0).toBe(r.appetite != null);
      // #179: an empty Steam side reports WHY it is empty. Unmapped ⇒ never a browser lean.
      expect(Array.isArray(r.steamGenres)).toBe(true);
      if (r.steam) expect(r.steamGenres.length).toBeGreaterThan(0);
      else expect(r.routeLean).toBe(r.steamGenres.length ? "browser" : "steam-unmapped");
      if (r.steam && !r.supplyN) expect(r.routeLean).toBe("steam");
    }
    // The defect this closes: a row with no Steam mapping must not claim the browser won.
    for (const r of m.rows) expect(r.routeLean === "browser" && !r.steamGenres.length).toBe(false);
    // The single-surface read makes no cross-platform claim.
    expect((await q.getLoopFamilyMarket(db, "steam")).rows.every((r) => !r.routeLean)).toBe(true);
  });
});

// #243 — rating AGGREGATES on `all` use within-portal rating percentiles. Both portals carry the
// same within-portal rating shape, but CrazyGames' ratings sit a flat +0.4 higher (its rating
// culture, not better games). On `all` a CrazyGames-only cell must not out-score a Poki-only one on
// quality; a single portal must still read raw 0–5 ratings.
const T0 = Date.UTC(2026, 8, 20, 12);
const OFFSET: Record<string, number> = { poki: 0, crazygames: 0.4 };
// Poki carries Puzzle, CrazyGames carries Racing — each genre×tag cell is one portal's titles only.
const GENRE: Record<string, string> = { poki: "Puzzle", crazygames: "Racing" };

async function seedRatings(db: Querier) {
  const one = async (sql: string, p: unknown[]) => (await db.query(sql, p))[0];
  const ts = new Date(T0).toISOString();
  for (const name of ["poki", "crazygames"]) {
    const sid = (
      await one(`INSERT INTO sources(name, base_url) VALUES ($1,$2) RETURNING id`, [
        name,
        `https://${name}.com`,
      ])
    ).id;
    const cid = (
      await one(
        `INSERT INTO crawls(source_id, started_at, finished_at, status, games_seen) VALUES ($1,$2,$2,'ok',0) RETURNING id`,
        [sid, ts],
      )
    ).id;
    // Two tags → two cells per portal (Merge: the 4 best-rated, Casual: all 8).
    for (let i = 0; i < 8; i++) {
      const gid = (
        await one(
          `INSERT INTO games(source_id, source_game_id, url, title, first_seen_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [sid, `${name}-${i}`, `https://x.com/${name}-${i}`, `${name}-${i}`, ts],
        )
      ).id;
      await db.query(
        `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre) VALUES ($1,$2,$3,$4,$5,$6)`,
        [gid, cid, ts, 3.8 + i * 0.1 + OFFSET[name], 100 * (i + 1), GENRE[name]],
      );
      for (const tag of i >= 4 ? ["Merge", "Casual"] : ["Casual"]) {
        const tid = (
          await one(
            `INSERT INTO tags(name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [tag],
          )
        ).id;
        await db.query(`INSERT INTO game_tags(game_id, tag_id) VALUES ($1,$2)`, [gid, tid]);
      }
    }
  }
}

describe("#243 rating percentiles on `all`", () => {
  let rdb: Querier;
  beforeAll(async () => {
    rdb = await freshMemoryDb();
    await seedRatings(rdb);
  }, 60000);

  describe("R1 the rating-percentile building block", () => {
    it("one portal keeps the raw rating; `all` joins the within-portal percentile", () => {
      expect(q.ratingLevel("poki")).toEqual({ join: "", level: "l.rating" });
      expect(q.ratingLevel("all").level).toBe("rl.pct");
      expect(q.ratingLevel("all").join).toContain("PARTITION BY src.name ORDER BY l.rating");
      expect([q.ratingUnitOf("all"), q.ratingUnitOf("poki"), q.ratingUnitOf("crazygames")]).toEqual(
        ["ratingPercentile", "rating", "rating"],
      );
    });
  });

  describe("R2 aggregates on `all` carry no portal offset", () => {
    it("a CrazyGames-only cell gets no quality lift from the portal's higher ratings", async () => {
      const gaps = await q.getMarketGaps(rdb, "all");
      const by = (label: string) => gaps.find((g) => g.label === label)!;
      const pk = by("Puzzle × Merge");
      const cg = by("Racing × Merge");
      expect(pk && cg).toBeTruthy();
      expect(cg.ratingUnit).toBe("ratingPercentile");
      expect(cg.qualityCeil).toBe(pk.qualityCeil);
      expect(cg.components.quality).toBe(pk.components.quality);
      expect(cg.qualityCeil).toBeGreaterThan(50); // a percentile, not a 0–5 score
    });
    it("genre and landscape ratings are percentiles, equal across the two portals", async () => {
      const g = await q.getGenres(rdb, "all");
      const [pk, cg] = ["Puzzle", "Racing"].map((n) => g.find((r) => r.genre === n)!);
      expect([pk.ratingUnit, pk.avgRating, pk.p90Rating]).toEqual([
        "ratingPercentile",
        cg.avgRating,
        cg.p90Rating,
      ]);
      const l = await q.getGenreLandscape(rdb, "all");
      const [lp, lc] = ["Puzzle", "Racing"].map((n) => l.find((r) => r.genre === n)!);
      expect(lp.p75Rating).toBe(lc.p75Rating);
      expect(lp.ratingUnit).toBe("ratingPercentile");
    });
    it("TOP QUALITY names the within-portal unit on `all`", async () => {
      const top = (await q.getInsights(rdb, "all")).find((i) => i.tag === "TOP QUALITY")!;
      expect(top.meta).toMatch(/^P75 rating percentile P\d+$/);
      expect(top.text).toContain("ranked within each portal");
    });
  });

  describe("R3 a single portal is unchanged", () => {
    it("reads raw 0–5 ratings, two decimals", async () => {
      const [gap] = (await q.getMarketGaps(rdb, "crazygames")).filter(
        (x) => x.label === "Racing × Merge",
      );
      expect(gap.ratingUnit).toBe("rating");
      // P90 of 4.6..4.9 (+0.4 offset on 4.2..4.5) = 4.87
      expect(gap.qualityCeil).toBe(4.87);
      const [row] = await q.getGenres(rdb, "poki");
      expect([row.ratingUnit, row.avgRating, row.p90Rating]).toEqual(["rating", 4.15, 4.43]);
      const top = (await q.getInsights(rdb, "poki")).find((i) => i.tag === "TOP QUALITY")!;
      expect(top.meta).toBe("P75 rating 4.33");
    });
  });
});
