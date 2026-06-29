# GameRadar Phase 1 — Display Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-point every GameRadar analytic from the uncollected `featured` signal onto data the crawl actually stores (rating, votes, genre, tags, day-over-day snapshots), with honest labels and on-screen definitions.

**Architecture:** Pure query functions in `server/src/queries/index.ts` produce typed shapes from `shared/src/types.ts`; the dev Express app and the Netlify function both route to that one module; the React UI renders ECharts option builders from `web/src/components/charts.ts`. We change metrics at the query layer, update the shared types, fix/extend the charts, and rewire the UI — keeping the build and test suite green at every commit.

**Tech Stack:** TypeScript, Node 22+, PGlite (test/local) / Neon (prod), Vitest, React + Vite, ECharts 5.5.

## Global Constraints

- Node version floor: **22** (`netlify.toml` sets `NODE_VERSION=22`; local is 24 — fine).
- SQL must run on **both PGlite and Postgres/Neon** — stick to standard SQL already used in the file (`percent_rank()`, `percentile_cont() WITHIN GROUP`, `FILTER`, `mode() WITHIN GROUP` are all proven to work here).
- The dev API (`server/src/api/app.ts`) and prod function (`netlify/functions/api.ts`) must expose the **same** routes — any new endpoint goes in **both**.
- `shared/src/types.ts` is the single contract for web + server; a type change must update its producer (query) and consumers (chart/UI) in the **same commit** so the build stays green.
- No new runtime dependencies. ECharts only for charts.
- Keep all existing 23 Vitest tests green (adjust assertions that encode old semantics, don't delete coverage).
- Run commands one at a time in PowerShell (no `&&`).
- Work on branch `phase1-display-pivot` off `main`. Commit per task.

**Test runner:** from `app/server`: `npx vitest run test/<file>` (targeted) or from `app`: `npm -w server run test` (full suite). Typecheck: from `app/web` and `app/server` the build is `npm run build` at `app` root (`npm --prefix app run build`).

---

### Task 0: Branch + real-shape test fixture

Production data has `featured=false` everywhere and a few daily snapshots; the existing `seed.ts` fakes `featured`/`plays`, hiding the §02 bugs. We add a fixture that mimics production so anti-regression tests can assert "no silent zeros."

**Files:**
- Create: `app/server/test/fixtures.ts`
- Create: `app/server/test/realshape.test.ts`

**Interfaces:**
- Produces: `seedRealShape(db: Querier): Promise<void>` — inserts 2 sources, ~30 games, **3 daily** snapshots/game (captured_at = 3 consecutive dates), votes strictly rising per day, ratings in 3.2–4.9, `featured=false` and `homepage_position=null` everywhere, Poki games get a developer, CrazyGames none.

- [ ] **Step 1: Create branch**

Run: `git -C C:/Users/wj208/Documents/KAIROS/KAIROS checkout -b phase1-display-pivot`
Expected: `Switched to a new branch 'phase1-display-pivot'`

- [ ] **Step 2: Write the fixture**

`app/server/test/fixtures.ts`:
```ts
import { applySchema, type Querier } from "../src/db/db.ts";

const DAYS = ["2026-06-25", "2026-06-26", "2026-06-27"]; // 3 consecutive crawl days
const GENRES_POKI = ["Puzzle", "Casual", "Idle", "Adventure"];
const GENRES_CG = ["Shooter", ".io", "Driving", "Horror"];
const TAGS: Record<string, string[]> = {
  Puzzle: ["puzzle", "logic"], Casual: ["casual"], Idle: ["idle", "merge"], Adventure: ["adventure"],
  Shooter: ["shooter", "action"], ".io": ["io", "multiplayer"], Driving: ["driving"], Horror: ["horror"],
};

async function one(db: Querier, sql: string, p: unknown[]) { return (await db.query(sql, p))[0]; }

// featured ALWAYS false — mirrors what the live crawler writes.
export async function seedRealShape(db: Querier): Promise<void> {
  await applySchema(db);
  await db.exec(`TRUNCATE library_items, brief_editions, game_tags, game_snapshots, tags, games, crawls, sources RESTART IDENTITY CASCADE;`);
  const tagId = new Map<string, number>();
  const ensureTag = async (n: string) => tagId.get(n) ?? (tagId.set(n, (await one(db, "INSERT INTO tags(name) VALUES ($1) RETURNING id", [n])).id), tagId.get(n)!);

  const sources = [
    { name: "poki", base: "https://poki.com", genres: GENRES_POKI, dev: true },
    { name: "crazygames", base: "https://crazygames.com", genres: GENRES_CG, dev: false },
  ];
  for (const src of sources) {
    const sid = (await one(db, "INSERT INTO sources(name, base_url) VALUES ($1,$2) RETURNING id", [src.name, src.base])).id;
    const crawlIds: number[] = [];
    for (const d of DAYS) crawlIds.push((await one(db, "INSERT INTO crawls(source_id, started_at, finished_at, status, games_seen) VALUES ($1,$2,$2,'ok',0) RETURNING id", [sid, d])).id);
    let i = 0;
    for (const genre of src.genres) {
      for (let k = 0; k < 4; k++) { // 4 games per genre = 16/source
        i++;
        const slug = `${genre.toLowerCase().replace(/[^a-z]/g, "")}-${src.name}-${i}`;
        const baseVotes = Math.floor(50 + (i * 137 % 4000));       // deterministic spread 50..4050
        const rating = +(3.2 + ((i * 53) % 17) / 10).toFixed(2);   // 3.2..4.9 deterministic
        const gid = (await one(db,
          `INSERT INTO games(source_id, source_game_id, url, title, developer, first_seen_at, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [sid, slug, `${src.base}/g/${slug}`, `${genre} ${i}`, src.dev ? `Dev ${(i % 5) + 1}` : null, DAYS[0], DAYS[2]])).id;
        for (const tn of [...(TAGS[genre] ?? [genre.toLowerCase()])]) {
          await db.query("INSERT INTO game_tags(game_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [gid, await ensureTag(tn)]);
        }
        for (let di = 0; di < DAYS.length; di++) {
          await db.query(
            `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, featured, genre)
             VALUES ($1,$2,$3,$4,$5,false,$6)`,
            [gid, crawlIds[di], DAYS[di], rating, baseVotes + di * (10 + (i % 20)), genre]); // votes rise each day
        }
      }
    }
  }
}
```

- [ ] **Step 3: Write the meta-test (fixture is realistic)**

`app/server/test/realshape.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { seedRealShape } from "./fixtures.ts";

let db: Querier;
beforeAll(async () => { db = await freshMemoryDb(); await seedRealShape(db); }, 60000);

describe("real-shape fixture mirrors production", () => {
  it("featured is false everywhere", async () => {
    const r = await db.query("SELECT count(*) FILTER (WHERE featured)::int AS f, count(*)::int AS n FROM game_snapshots");
    expect(r[0].f).toBe(0);
    expect(r[0].n).toBeGreaterThan(0);
  });
  it("has at least 3 distinct capture days", async () => {
    const r = await db.query("SELECT count(DISTINCT captured_at)::int AS d FROM game_snapshots");
    expect(r[0].d).toBe(3);
  });
  it("votes rise across days for a sample game", async () => {
    const r = await db.query("SELECT votes FROM game_snapshots WHERE game_id=1 ORDER BY captured_at");
    expect(r[r.length - 1].votes).toBeGreaterThan(r[0].votes);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `cd C:/Users/wj208/Documents/KAIROS/KAIROS/app/server; npx vitest run test/realshape.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```
git add app/server/test/fixtures.ts app/server/test/realshape.test.ts
git commit -m "test: add production-shape fixture (featured=false, multi-day snapshots)"
```

---

### Task 1: Hidden gems + scatter → percentile-based, with names

Replace absolute thresholds (rating≥4.4 & votes<5000, catching 41%) with relative percentiles; carry `title`+`genre` into the scatter so the tooltip can name the game.

**Files:**
- Modify: `app/shared/src/types.ts` (ScatterPoint, HiddenGem)
- Modify: `app/server/src/queries/index.ts` (getScatter, getHiddenGems)
- Modify: `app/web/src/components/charts.ts` (scatterOption)
- Test: `app/server/test/queries.test.ts` (A6, A8) + new `test/realshape.test.ts` case

**Interfaces:**
- Produces: `ScatterPoint { title; genre; votes; rating; gem }`; gem = ratingPercentile ≥ 0.75 AND votesPercentile ≤ 0.25. `getHiddenGems` returns gems ordered by `(ratingPctile − votesPctile)` desc, ≤ 30.

- [ ] **Step 1: Update types**

In `types.ts` change:
```ts
export interface ScatterPoint { title: string; genre: string; votes: number; rating: number; gem: boolean; }
```
(`HiddenGem` unchanged — still `{ gameId, title, rating, votes, genre }`.)

- [ ] **Step 2: Write failing tests**

Replace describe `A6 hidden gems` and `A8 scatter` in `queries.test.ts`:
```ts
describe("A6 hidden gems (percentile)", () => {
  it("is a selective minority, not ~half the catalogue", async () => {
    const all = (await db.query("SELECT count(*)::int n FROM v_latest"))[0].n;
    const g = await q.getHiddenGems(db, "all");
    expect(g.length).toBeGreaterThan(0);
    expect(g.length).toBeLessThanOrEqual(Math.ceil(all * 0.15)); // < 15% of catalogue
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
```

- [ ] **Step 3: Run — expect fail**

Run: `cd C:/Users/wj208/Documents/KAIROS/KAIROS/app/server; npx vitest run test/queries.test.ts -t "scatter"`
Expected: FAIL (ScatterPoint has no `genre`; gem ratio off).

- [ ] **Step 4: Implement queries**

Replace `getHiddenGems` and `getScatter` in `queries/index.ts`:
```ts
const GEM_RATING_PCTILE = 0.75, GEM_VOTES_PCTILE = 0.25;

async function gemBase(db: Querier, platform: Platform) {
  return db.query(
    `WITH base AS (
       SELECT g.id, g.title, l.genre, l.rating, l.votes,
              percent_rank() OVER (ORDER BY l.rating) AS rp,
              percent_rank() OVER (ORDER BY l.votes)  AS vp
       FROM v_latest l
       JOIN games g ON g.id = l.game_id
       JOIN sources src ON src.id = g.source_id
       WHERE g.is_live AND l.rating IS NOT NULL AND l.votes IS NOT NULL ${pf(platform)}
     )
     SELECT id, title, genre, rating, votes, rp, vp,
            (rp >= ${GEM_RATING_PCTILE} AND vp <= ${GEM_VOTES_PCTILE}) AS gem
     FROM base`
  );
}

export async function getScatter(db: Querier, platform: Platform): Promise<ScatterPoint[]> {
  const rows = await gemBase(db, platform);
  return rows.map((r) => ({ title: r.title, genre: r.genre ?? "—", rating: num(r.rating), votes: num(r.votes), gem: !!r.gem }));
}

export async function getHiddenGems(db: Querier, platform: Platform): Promise<HiddenGem[]> {
  const rows = await gemBase(db, platform);
  return rows
    .filter((r) => r.gem)
    .sort((a, b) => (num(b.rp) - num(b.vp)) - (num(a.rp) - num(a.vp)))
    .slice(0, 30)
    .map((r) => ({ gameId: num(r.id), title: r.title, rating: num(r.rating), votes: num(r.votes), genre: r.genre ?? "—" }));
}
```

- [ ] **Step 5: Fix the scatter chart (names + quadrant)**

Replace `scatterOption` in `charts.ts`:
```ts
export function scatterOption(points: ScatterPoint[]): EChartsOption {
  // [votes, rating, title, genre] — title/genre kept for the tooltip
  const crowd = points.filter((p) => !p.gem).map((p) => [Math.max(p.votes, 1), p.rating, p.title, p.genre]);
  const gems  = points.filter((p) =>  p.gem).map((p) => [Math.max(p.votes, 1), p.rating, p.title, p.genre]);
  const fmtPt = (p: any) => `<b>${p.value[2]}</b><br>${p.value[3]} · rating ${p.value[1]}<br>${Number(p.value[0]).toLocaleString()} votes`;
  return {
    tooltip: { ...tip, formatter: fmtPt },
    grid: { ...baseGrid, left: 40, top: 18 },
    xAxis: { type: "log", name: "votes (visibility) →", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    yAxis: { type: "value", min: 2.5, max: 5, name: "rating", nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    series: [
      { name: "crowd", type: "scatter", symbolSize: 5, itemStyle: { color: "rgba(100,116,139,.28)" }, data: crowd },
      { name: "gems", type: "scatter", symbolSize: 11, itemStyle: { color: "#0891b2", borderColor: "#fff", borderWidth: 1.5, shadowBlur: 6, shadowColor: "rgba(8,145,178,.5)" }, data: gems,
        markLine: { silent: true, symbol: "none", lineStyle: { color: "#0891b2", type: "dashed", opacity: 0.5 },
          data: [{ yAxis: 4.4, label: { formatter: "high rating", color: AX, fontSize: 9 } }] } },
    ],
  };
}
```
(Note: gem cutoffs are percentile-relative in data; the dashed line at 4.4 is a visual cue only.)

- [ ] **Step 6: Run tests + targeted realshape gem test**

Add to `realshape.test.ts`:
```ts
import * as q from "../src/queries/index.ts";
describe("real-shape: gems are relative & named", () => {
  it("gem set is a small minority and points carry titles", async () => {
    const pts = await q.getScatter(db, "all");
    expect(pts.every((p) => p.title.length > 0)).toBe(true);
    expect(pts.filter((p) => p.gem).length).toBeLessThan(pts.length * 0.25);
  });
});
```
Run: `cd C:/Users/wj208/Documents/KAIROS/KAIROS/app/server; npx vitest run test/queries.test.ts test/realshape.test.ts`
Expected: PASS.

- [ ] **Step 7: Build (web typecheck) + commit**

Run: `cd C:/Users/wj208/Documents/KAIROS/KAIROS; npm --prefix app run build`
Expected: clean build (ScatterPoint.genre consumed only via chart `p.value[3]`, no TS break).
```
git add app/shared/src/types.ts app/server/src/queries/index.ts app/web/src/components/charts.ts app/server/test/
git commit -m "feat(radar): percentile hidden gems + named scatter tooltip"
```

---

### Task 2: Momentum → median-votes-over-real-dates + Rising-genre KPI

Repurpose the dead featured-count momentum into the real engagement trajectory: median votes per genre at each capture date, on a true date axis, with an honest "building" state when <2 days exist. Replace "Fastest Genre (features)" with "Rising Genre (votes/day)".

**Files:**
- Modify: `types.ts` (GenreMomentum + OverviewKPI), `queries/index.ts` (genreWeekFeatures→genreVotesByDate, getGenreMomentum, getKPI, getInsights), `charts.ts` (momentumOption tooltip/labels), `Radar.tsx` (KPI + chart subtitles), `test/queries.test.ts`

**Interfaces:**
- Produces: `GenreMomentum { dates: string[]; building: boolean; series: { genre; values: number[] }[] }` where `values` = median votes per genre per date. `OverviewKPI` gains `risingGenre: string; risingVotesPerDay: number` (replaces `fastestGenre`/`fastestGenreDeltaPct`).

- [ ] **Step 1: Update types**
```ts
export interface GenreMomentum { dates: string[]; building: boolean; series: MomentumSeries[]; }
export interface OverviewKPI {
  gamesTracked: number; newGames: number; avgRating: number; avgRatingP90: number;
  risingGenre: string; risingVotesPerDay: number; openGaps: number;
}
```

- [ ] **Step 2: Write failing tests**

Replace `A4 genre momentum` and adjust `A3 overview`:
```ts
describe("A4 momentum (median votes over dates)", () => {
  it("series align to real dates; building flag reflects history depth", async () => {
    const m = await q.getGenreMomentum(db, "all");
    expect(Array.isArray(m.dates)).toBe(true);
    expect(typeof m.building).toBe("boolean");
    for (const s of m.series) expect(s.values.length).toBe(m.dates.length);
    expect(m.dates.every((d) => !/^W\d+$/.test(d))).toBe(true); // no fake "W15" labels
  });
});
```
And in `A3 overview` replace the `fastestGenre` assertions with:
```ts
expect(typeof all.kpi.risingGenre).toBe("string");
expect(all.kpi.avgRatingP90).toBeGreaterThanOrEqual(all.kpi.avgRating);
```

- [ ] **Step 3: Run — expect fail.**
Run: `cd .../app/server; npx vitest run test/queries.test.ts -t "momentum"` → FAIL.

- [ ] **Step 4: Implement queries**

In `queries/index.ts` replace `genreWeekFeatures` + `getGenreMomentum` + the momentum part of `getKPI`/`getInsights`:
```ts
const fmtDate = (d: any) => new Date(d).toISOString().slice(5, 10); // "MM-DD"

interface GenreDates { dates: string[]; order: string[]; byGenre: Record<string, number[]>; }
async function genreVotesByDate(db: Querier, platform: Platform): Promise<GenreDates> {
  const rows = await db.query(
    `SELECT s.genre AS genre, s.captured_at AS d,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY s.votes) AS med
     FROM game_snapshots s
     JOIN games g ON g.id = s.game_id
     JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND s.votes IS NOT NULL AND s.genre IS NOT NULL ${pf(platform)}
     GROUP BY s.genre, s.captured_at`
  );
  const times = [...new Set(rows.map((r) => new Date(r.d).getTime()))].sort((a, b) => a - b);
  const idx = new Map(times.map((t, i) => [t, i]));
  const dates = times.map((t) => fmtDate(t));
  const byGenre: Record<string, number[]> = {};
  const totalVotes: Record<string, number> = {};
  for (const r of rows) {
    const g = r.genre as string;
    if (!byGenre[g]) byGenre[g] = new Array(times.length).fill(0);
    byGenre[g][idx.get(new Date(r.d).getTime())!] = num(r.med);
    totalVotes[g] = (totalVotes[g] ?? 0) + num(r.med);
  }
  const order = Object.keys(byGenre).sort((a, b) => totalVotes[b] - totalVotes[a]);
  return { dates, order, byGenre };
}

// velocity = (last - first) / spanDays, guarded for <2 points
function velocity(values: number[]): number {
  if (values.length < 2) return 0;
  const first = values[0], last = values[values.length - 1];
  const span = values.length - 1;
  return span > 0 ? (last - first) / span : 0;
}

export async function getGenreMomentum(db: Querier, platform: Platform): Promise<GenreMomentum> {
  const gd = await genreVotesByDate(db, platform);
  const top = gd.order.slice(0, 4);
  return { dates: gd.dates, building: gd.dates.length < 2, series: top.map((genre) => ({ genre, values: gd.byGenre[genre] })) };
}
```
Then in `getKPI` replace the fastest-genre block:
```ts
const gd = await genreVotesByDate(db, platform);
const MIN_VOL = 4;
const counts = await db.query(
  `SELECT l.genre AS genre, count(*)::int AS n FROM v_latest l JOIN games g ON g.id=l.game_id JOIN sources src ON src.id=g.source_id WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)} GROUP BY l.genre`
);
const vol = new Map(counts.map((r) => [r.genre, num(r.n)]));
const rising = gd.order
  .filter((g) => (vol.get(g) ?? 0) >= MIN_VOL)
  .map((g) => ({ genre: g, v: velocity(gd.byGenre[g]) }))
  .sort((a, b) => b.v - a.v)[0] ?? { genre: "—", v: 0 };
const p90 = await db.query(
  `SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS p FROM v_latest l JOIN games g ON g.id=l.game_id JOIN sources src ON src.id=g.source_id WHERE g.is_live AND l.rating IS NOT NULL ${pf(platform)}`
);
const newGames = await db.query(
  `SELECT count(*)::int AS n FROM games g JOIN sources src ON src.id=g.source_id
   WHERE g.is_live ${pf(platform)} AND g.first_seen_at >= (SELECT max(first_seen_at) FROM games) - interval '14 days'`
);
return {
  gamesTracked: num(g[0].n),
  newGames: num(newGames[0].n),
  avgRating: +num(avg[0].r).toFixed(2),
  avgRatingP90: +num(p90[0].p).toFixed(2),
  risingGenre: rising.genre,
  risingVotesPerDay: Math.round(rising.v),
  openGaps: gaps.filter((c) => c.score > 0).length,
};
```
**Do NOT delete `genreWeekFeatures`/`trendStats`/`growthPct`/`WEEK_LABEL_BASE` yet** — `getGenres` still references them until Task 6, so removing them now breaks the build. Add `genreVotesByDate` + `velocity` alongside the old helpers; switch only momentum + `getKPI` + `getInsights` to the new ones. Update `getInsights` to use `genreVotesByDate` + velocity: top riser = `up`, plus existing gap/gem insights; drop the featured-based down insight (or recompute from velocity < 0). Dead-helper removal happens in Task 6 once `getGenres` is migrated.

- [ ] **Step 5: Momentum chart honest labels**

In `charts.ts` `momentumOption`, change `xAxis.data: m.weeks` → `m.dates`, and tooltip/legend stay. Add y-axis name:
```ts
yAxis: { type: "value", name: "median votes", nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 10 } },
```
(Change the parameter reference: `data: m.dates`.)

- [ ] **Step 6: UI — KPI cards + subtitles (Radar.tsx)**

In `OverviewView`, replace the four KPI cards' dead/mislabelled bits:
- Card 2 (Avg rating): subtitle → `<span className="delta flat num">P90 {ov.kpi.avgRatingP90.toFixed(2)} · point-in-time</span>` (remove "rolling 12-week").
- Card 3: label "Rising genre"; value `{ov.kpi.risingGenre}`; subtitle `▲ +{ov.kpi.risingVotesPerDay} votes/day`.
- Card 1 subtitle: `▲ {ov.kpi.newGames} new (14d)`.
- Momentum card `head(...)` subtitle → `"median votes by genre over time"`; if `ov.momentum.building`, render `<div className="empty-inline">History building — need ≥2 crawl days</div>` instead of the chart.
Also in the shell `navItem("new-releases", ..., ov.kpi.newGames)` and remove `newThisWeek` references; `gems` count stays from scatter.

- [ ] **Step 7: Run full suite + build**
Run: `cd .../app/server; npx vitest run` → all green (existing tests adjusted).
Run: `cd .../KAIROS; npm --prefix app run build` → clean.

- [ ] **Step 8: Commit**
```
git add app/shared app/server app/web
git commit -m "feat(radar): vote-velocity momentum on real dates + rising-genre KPI"
```

---

### Task 3: Market gaps → absolute, interpretable opportunity

Kill "demand 100 / supply 0". Each cell carries real numbers (games, median votes/title, P90 rating) and a defined opportunity score; the UI reads in plain English.

**Files:** `types.ts` (MarketGap), `queries/index.ts` (getMarketGaps + openGaps + insights), `Radar.tsx` (GapList), `test/queries.test.ts` (A7).

**Interfaces:**
- Produces: `MarketGap { label: string; supplyN: number; appetite: number; qualityCeil: number; score: number }`. `score` = `z(appetite) + z(qualityCeil) − z(supplyN)`; sorted desc; ≤ 6. `appetite` = median votes per title; `qualityCeil` = P90 rating in cell.

- [ ] **Step 1: Types**
```ts
export interface MarketGap { label: string; supplyN: number; appetite: number; qualityCeil: number; score: number; }
```

- [ ] **Step 2: Failing test (A7)**
```ts
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
```

- [ ] **Step 3: Run — expect fail.**

- [ ] **Step 4: Implement `getMarketGaps`**
```ts
export async function getMarketGaps(db: Querier, platform: Platform): Promise<MarketGap[]> {
  const rows = await db.query(
    `SELECT l.genre AS genre, t.name AS tag,
            count(DISTINCT g.id)::int AS supply_n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.votes)::float AS appetite,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS quality_ceil
     FROM v_latest l
     JOIN games g ON g.id = l.game_id
     JOIN sources src ON src.id = g.source_id
     JOIN game_tags gt ON gt.game_id = g.id
     JOIN tags t ON t.id = gt.tag_id
     WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
     GROUP BY l.genre, t.name
     HAVING count(DISTINCT g.id) >= 2`
  );
  if (rows.length < 2) return [];
  const z = (vals: number[]) => { const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    return (v: number) => (v - m) / sd; };
  const zApp = z(rows.map((r) => num(r.appetite)));
  const zSup = z(rows.map((r) => num(r.supply_n)));
  const zQual = z(rows.map((r) => num(r.quality_ceil)));
  return rows
    .map((r) => ({
      label: `${r.genre} × ${r.tag}`,
      supplyN: num(r.supply_n),
      appetite: Math.round(num(r.appetite)),
      qualityCeil: +num(r.quality_ceil).toFixed(2),
      score: +(zApp(num(r.appetite)) + zQual(num(r.quality_ceil)) - zSup(num(r.supply_n))).toFixed(2),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}
```
Update `getInsights` gap line to: `meta: \`${gaps[0].supplyN} games · ${gaps[0].appetite} median votes\``.

- [ ] **Step 5: UI — GapList plain English (Radar.tsx)**

Replace `GapList` body rows:
```tsx
<div className="gap" key={i}><span className="rank num">{i + 1}</span>
  <div className="name">{g.label}<small>opportunity {g.score.toFixed(1)}</small></div>
  <div className="gap-stats num">
    <span><b>{fmt(g.appetite)}</b> median votes/title</span>
    <span><b>{g.supplyN}</b> games</span>
    <span>top rating <b>{g.qualityCeil.toFixed(2)}</b></span>
  </div>
</div>
```
Add a one-line legend under the card head: `"high appetite + high quality ceiling + low supply = opportunity"`. (Add `.gap-stats` flex styling to `styles.css` — small, muted, wrap.)

- [ ] **Step 6: Run tests + build → green. Commit.**
```
git add app/shared app/server app/web
git commit -m "feat(radar): interpretable market-gap opportunity (absolute numbers + defined score)"
```

---

### Task 4: Quality–Saturation genre map (flagship Overview visual)

New scatter: x = supply (games in genre), y = P75 rating (quality ceiling), bubble = total votes (audience). Green-field = low supply · high rating · big audience.

**Files:** `types.ts` (GenreLandscapePoint, Overview.landscape), `queries/index.ts` (getGenreLandscape + add to getOverview), `charts.ts` (landscapeOption), `Radar.tsx` (hero card), api layers unchanged (folded into Overview), `test/queries.test.ts`.

**Interfaces:**
- Produces: `GenreLandscapePoint { genre; supply; p75Rating; avgRating; totalVotes }`; `Overview.landscape: GenreLandscapePoint[]`. `landscapeOption(points)` → ECharts scatter.

- [ ] **Step 1: Types**
```ts
export interface GenreLandscapePoint { genre: string; supply: number; p75Rating: number; avgRating: number; totalVotes: number; }
// add to Overview:  landscape: GenreLandscapePoint[];
```

- [ ] **Step 2: Failing test**
```ts
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
```

- [ ] **Step 3: Run — expect fail.**

- [ ] **Step 4: Implement**
```ts
export async function getGenreLandscape(db: Querier, platform: Platform): Promise<GenreLandscapePoint[]> {
  const rows = await db.query(
    `SELECT l.genre AS genre, count(*)::int AS supply,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY l.rating)::float AS p75,
            avg(l.rating)::float AS avgr, coalesce(sum(l.votes),0)::float AS tv
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL AND l.rating IS NOT NULL ${pf(platform)}
     GROUP BY l.genre ORDER BY supply DESC`
  );
  return rows.map((r) => ({ genre: r.genre, supply: num(r.supply), p75Rating: +num(r.p75).toFixed(2), avgRating: +num(r.avgr).toFixed(2), totalVotes: Math.round(num(r.tv)) }));
}
```
Add `landscape` to `getOverview`'s Promise.all + return object.

- [ ] **Step 5: Chart**

Add to `charts.ts`:
```ts
import type { GenreLandscapePoint } from "shared";
export function landscapeOption(pts: GenreLandscapePoint[]): EChartsOption {
  const maxV = Math.max(1, ...pts.map((p) => p.totalVotes));
  const data = pts.map((p) => ({ value: [p.supply, p.p75Rating, p.totalVotes, p.genre], symbolSize: 12 + 34 * Math.sqrt(p.totalVotes / maxV) }));
  return {
    tooltip: { ...tip, formatter: (p: any) => `<b>${p.value[3]}</b><br>${p.value[0]} games · P75 rating ${p.value[1]}<br>${Number(p.value[2]).toLocaleString()} total votes` },
    grid: { ...baseGrid, left: 44, top: 18 },
    xAxis: { type: "value", name: "supply (games) →", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    yAxis: { type: "value", name: "quality ceiling (P75 rating)", min: 3, max: 5, nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    series: [{ type: "scatter", data, itemStyle: { color: "rgba(37,99,235,.55)", borderColor: "#1e3a8a", borderWidth: 1 },
      label: { show: true, formatter: (p: any) => p.value[3], position: "top", color: AX, fontFamily: FONT, fontSize: 9 } }],
  };
}
```

- [ ] **Step 6: UI — make it the Overview hero (Radar.tsx)**

In `OverviewView`, replace the first `g-2` row's momentum card position: put the landscape map as a full-width hero card at the top of the grid:
```tsx
<div className="card hero">{head(I.genres, "Genre landscape", "supply × quality × audience — top-left = green-field")}<EChart option={landscapeOption(ov.landscape)} style={{ minHeight: 320 }} /></div>
```
Keep momentum + insights in the following row. Import `landscapeOption`.

- [ ] **Step 7: Tests + build → green. Commit.**
```
git add app/shared app/server app/web
git commit -m "feat(radar): quality-saturation genre landscape (flagship what-to-build-next map)"
```

---

### Task 5: Feature heatmap → genre × rating-band density

Reuse the heatmap shape for a populated, meaningful signal: how each genre's games distribute across rating bands (quality profile).

**Files:** `queries/index.ts` (getFeatureHeatmap), `charts.ts` (heatmapOption tooltip), `Radar.tsx` (labels), `test/queries.test.ts` (A8b).

**Interfaces:** `FeatureHeatmap { weeks: string[]; genres: string[]; cells }` — `weeks` now holds **rating-band labels**; `cells[].value` = game count.

- [ ] **Step 1: Failing test (A8b)** — assert non-zero density exists:
```ts
describe("A8b rating-band density heatmap", () => {
  it("bands × genres with at least one non-zero cell", async () => {
    const h = await q.getFeatureHeatmap(db, "all");
    expect(h.genres.length).toBeGreaterThan(0);
    expect(h.weeks.length).toBe(5); // 5 rating bands
    expect(h.cells.length).toBe(h.weeks.length * h.genres.length);
    expect(h.cells.some((c) => c.value > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**
```ts
const RATING_BANDS = ["<3.5", "3.5–4.0", "4.0–4.4", "4.4–4.7", "≥4.7"];
function bandIndex(r: number): number { return r < 3.5 ? 0 : r < 4.0 ? 1 : r < 4.4 ? 2 : r < 4.7 ? 3 : 4; }

export async function getFeatureHeatmap(db: Querier, platform: Platform): Promise<FeatureHeatmap> {
  const rows = await db.query(
    `SELECT l.genre AS genre, l.rating AS rating, count(*)::int AS n
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL AND l.rating IS NOT NULL ${pf(platform)}
     GROUP BY l.genre, l.rating`
  );
  const totals: Record<string, number> = {};
  for (const r of rows) totals[r.genre] = (totals[r.genre] ?? 0) + num(r.n);
  const genres = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 7);
  const gi = new Map(genres.map((g, i) => [g, i]));
  const cells = genres.flatMap((_, g) => RATING_BANDS.map((_, w) => ({ genreIndex: g, week: w, value: 0 })));
  const at = (g: number, w: number) => cells[g * RATING_BANDS.length + w];
  for (const r of rows) { if (!gi.has(r.genre)) continue; at(gi.get(r.genre)!, bandIndex(num(r.rating))).value += num(r.n); }
  return { weeks: RATING_BANDS, genres, cells };
}
```

- [ ] **Step 4: Chart tooltip + UI labels**
- `charts.ts` `heatmapOption`: change formatter to `\`${h.genres[p.value[1]]} · ${h.weeks[p.value[0]]}<br><b>${p.value[2]}</b> games\``.
- `Radar.tsx`: heatmap card head subtitle → `"genre × rating band (game counts)"` (both Overview and Trends usages).

- [ ] **Step 5: Tests + build → green. Commit.**
```
git commit -am "feat(radar): rating-band density heatmap replaces dead feature heatmap"
```

---

### Task 6: Genre Explorer benchmarks (drop dead columns)

Replace "Days featured" + feature-momentum with engagement benchmarks: median votes, P90 votes (the "top-10% bar"), P90 rating, vote velocity.

**Files:** `types.ts` (GenreRow), `queries/index.ts` (getGenres), `Radar.tsx` (GenresView table), `test/queries.test.ts`.

**Interfaces:** `GenreRow { genre; games; avgRating; medianVotes; p90Votes; p90Rating; votesPerDay }`.

- [ ] **Step 1: Types**
```ts
export interface GenreRow { genre: string; games: number; avgRating: number; medianVotes: number; p90Votes: number; p90Rating: number; votesPerDay: number; }
```

- [ ] **Step 2: Failing test** — replace `genres rollup` test:
```ts
it("genres rollup has benchmarks", async () => {
  const genres = await q.getGenres(db, "all");
  expect(genres.length).toBeGreaterThan(0);
  expect(genres[0].games).toBeGreaterThan(0);
  expect(genres[0].p90Votes).toBeGreaterThanOrEqual(genres[0].medianVotes);
  expect(genres[0].p90Rating).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Implement `getGenres`**
```ts
export async function getGenres(db: Querier, platform: Platform): Promise<GenreRow[]> {
  const rows = await db.query(
    `SELECT l.genre AS genre, count(*)::int AS games, avg(l.rating)::float AS avg_rating,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY l.votes)::float AS med_votes,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY l.votes)::float AS p90_votes,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY l.rating)::float AS p90_rating
     FROM v_latest l JOIN games g ON g.id = l.game_id JOIN sources src ON src.id = g.source_id
     WHERE g.is_live AND l.genre IS NOT NULL ${pf(platform)}
     GROUP BY l.genre ORDER BY games DESC`
  );
  const gd = await genreVotesByDate(db, platform);
  return rows.map((r) => ({
    genre: r.genre, games: num(r.games), avgRating: +num(r.avg_rating).toFixed(2),
    medianVotes: Math.round(num(r.med_votes)), p90Votes: Math.round(num(r.p90_votes)),
    p90Rating: +num(r.p90_rating).toFixed(2),
    votesPerDay: gd.byGenre[r.genre] ? Math.round(velocity(gd.byGenre[r.genre], gd.daySpan)) : 0,
  }));
}
```

- [ ] **Step 4: UI — GenresView table (Radar.tsx)**
Header: `Genre · Games · Avg rating · Median votes · P90 votes (top-10% bar) · P90 rating · Votes/day`. Replace the two dead `<td>`s (Days feat. + Momentum) accordingly; keep the minibar on games; color `votesPerDay` with `deltaCls`.

- [ ] **Step 5: Remove now-dead helpers**

`getGenres` was the last consumer of the legacy feature-trend helpers. Delete from `queries/index.ts`: `genreWeekFeatures`, `growthPct`, `WEEK_LABEL_BASE`, and `trendStats` **only if** no remaining references (grep first: `grep -n "trendStats\|genreWeekFeatures\|growthPct\|WEEK_LABEL_BASE" app/server/src/queries/index.ts`). Keep `velocity` and `genreVotesByDate`.

Run: `cd C:/Users/wj208/Documents/KAIROS/KAIROS; npm --prefix app run build` → clean (no unused-symbol or missing-reference errors).

- [ ] **Step 6: Tests + build → green. Commit.**
```
git commit -am "feat(radar): genre benchmarks (median/P90 votes, P90 rating, votes/day) + remove dead feature helpers"
```

---

### Task 7: New Releases (first_seen), Trends repurpose, Tag/Dev/label sweep, insights finalize

Mechanical honesty + repurpose pass; no new metric maths beyond what earlier tasks defined.

**Files:** `queries/index.ts` (getNewReleases), `Radar.tsx` (NewReleasesView, TrendsView, TagsView, DevelopersView note, header strings), `test/queries.test.ts`.

- [ ] **Step 1: `getNewReleases` uses first_seen_at**
```ts
export async function getNewReleases(db: Querier, platform: Platform): Promise<NewRelease[]> {
  const rows = await db.query(
    `SELECT g.id AS id, g.title AS title, g.url AS url, l.genre AS genre, l.rating AS rating, l.votes AS votes
     FROM games g JOIN sources src ON src.id = g.source_id JOIN v_latest l ON l.game_id = g.id
     WHERE g.is_live ${pf(platform)} AND g.first_seen_at >= (SELECT max(first_seen_at) FROM games) - interval '14 days'
     ORDER BY g.first_seen_at DESC, l.votes DESC NULLS LAST LIMIT 60`
  );
  return rows.map((r) => ({ gameId: num(r.id), title: r.title, genre: r.genre ?? "—", rating: num(r.rating), votes: num(r.votes), url: r.url }));
}
```
Test: keep `new releases returns rows` (Array check) — still valid.

- [ ] **Step 2: UI sweep (Radar.tsx)**
- `TrendsView`: replace the two dead charts with the real time-series — momentum (median votes/date) + the genre-landscape map; head subtitles honest; if `ov.momentum.building`, show the "history building" inline note. (Reuse `momentumOption`/`landscapeOption`.)
- `NewReleasesView`: head subtitle → `${rows.length} new in last 14 days`.
- `DevelopersView`: keep empty-state copy; when populated and platform==="all"/"crazygames", show a small note line: `"Developer names come from Poki; CrazyGames doesn't expose them."`
- `TagsView`: keep treemap; add median-votes context is out of scope (leave count table) — only fix head copy to avoid implying opportunity.
- Global string sweep: remove any remaining "weekly homepage features", "rolling 12-week", "features / 12w", "demand ≫ supply" → defined copy. Search `Radar.tsx` for these literals.

- [ ] **Step 3: Insights finalize (queries/index.ts `getInsights`)**
Ensure 3–4 cards from live signals only: (1) rising genre by votes/day (kind `up`), (2) top opportunity gap (kind `gap`, meta = "N games · M median votes"), (3) hidden-gems count (kind `gem`), (4) optional highest-quality genre by P75 rating (kind `up`). No featured references.

- [ ] **Step 4: Label-honesty test**

Add to `realshape.test.ts`:
```ts
describe("real-shape: honest labels & no silent zeros", () => {
  it("momentum uses real dates, never W## tokens", async () => {
    const m = await q.getGenreMomentum(db, "all");
    expect(m.dates.every((d) => !/^W\d+$/.test(d))).toBe(true);
  });
  it("overview KPIs are populated from real data (no featured dependency)", async () => {
    const ov = await q.getOverview(db, "all");
    expect(ov.kpi.risingGenre.length).toBeGreaterThan(0);
    expect(ov.landscape.length).toBeGreaterThan(0);
    expect(ov.heatmap.cells.some((c) => c.value > 0)).toBe(true);
  });
});
```

- [ ] **Step 5: Full suite + build → green. Commit.**
```
git commit -am "feat(radar): first-seen new releases, repurposed Trends, honest-label sweep, live insights"
```

---

### Task 8: Verification, screenshots, deploy validation

**Files:** none (validation); may produce screenshots under scratchpad.

- [ ] **Step 1: Full regression**
Run: `cd .../app; npm run db:seed` then `npm -w server run test`
Expected: all tests green (original 23 adjusted + new). Record count.

- [ ] **Step 2: Local visual check**
Run dev (`npm run dev` from `app`), open `http://localhost:5173`, capture each tab. Confirm acceptance criteria from spec §08-C: scatter tooltip shows game title; gems are a small visible minority; KPIs populated; momentum on real dates (or "building" note on thin data); heatmap non-zero; gaps read in plain English; no "W##"/"rolling 12-week" strings; Developers note present.

- [ ] **Step 3: Deploy + production validation**
Run: `cd .../KAIROS; npx -y netlify-cli@latest deploy --build --prod --skip-functions-cache --site 007de021-8987-4e14-a490-50b49d936a44`
Then hit the live API for `overview`/`genres`/`developers` and confirm real production data renders the new shapes without all-zeros. (DATABASE_URL is the Netlify secret — only the deployed function reads it.)

- [ ] **Step 4: Open PR**
```
git push -u origin phase1-display-pivot
gh pr create --repo ry4nch1n/KAIROS --base main --head phase1-display-pivot --title "GameRadar Phase 1: display pivot onto real data" --body "..."
```

---

## Self-Review

**Spec coverage** (vs evaluation §06–§08):
- Vote Velocity → Task 2 ✓ · Rising Genre KPI → Task 2 ✓ · Hidden Gem percentile → Task 1 ✓ · Opportunity Score → Task 3 ✓ · Quality–Saturation map → Task 4 ✓ · Engagement Benchmark → Task 6 ✓ · New & Rising → Task 7 ✓ · Scatter name fix → Task 1 ✓ · Heatmap replacement → Task 5 ✓ · Honest labels → Task 7 ✓ · Real-shape + anti-regression tests → Tasks 0,1,7 ✓ · Deploy validation → Task 8 ✓.
- Tag Explorer depth: intentionally minimal in Phase 1 (kept as count view; deeper opportunity overlay deferred — noted in Task 7). Acceptable scope cut; flagged here so it isn't a silent gap.

**Type consistency:** `genreVotesByDate`/`velocity` defined in Task 2 and reused in Tasks 4/6; `GenreMomentum.dates` (not `weeks`) consumed by `momentumOption` in Task 2; `MarketGap` fields (`supplyN`,`appetite`,`qualityCeil`,`score`) consistent across Task 3 query + UI; `Overview.landscape` added Task 4 and consumed in Tasks 4/7. KPI field renames (`risingGenre`,`risingVotesPerDay`,`newGames`,`avgRatingP90`) applied in Task 2 and consumed by `Radar.tsx` shell + cards.

**Placeholder scan:** all query SQL, chart configs, and test code are concrete. UI edits specify exact cards/columns/strings. The only deliberately descriptive steps are mechanical UI string edits in Task 7 (search-and-replace literals), which are enumerated.
