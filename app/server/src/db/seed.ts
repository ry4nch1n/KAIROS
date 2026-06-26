// Deterministic sample-data generator. Powers local verification of every chart.
// Uses a fixed base date + seeded PRNG so results are stable across runs.
import { appDb, applySchema, type Querier } from "./db.ts";
import { fileURLToPath } from "node:url";

const WEEKS = 12;
const BASE_WEEK_NO = 15; // labels W15..W26
const BASE_DATE = Date.UTC(2026, 5, 26); // 2026-06-26 (latest week)

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GenreCfg {
  base: number;
  slope: number;
  w: number;
}
interface SourceCfg {
  name: string;
  base_url: string;
  genres: Record<string, GenreCfg>;
}

const SOURCES: SourceCfg[] = [
  {
    name: "poki",
    base_url: "https://poki.com",
    genres: {
      Puzzle: { base: 0.5, slope: -0.02, w: 5 },
      Casual: { base: 0.4, slope: 0.0, w: 4 },
      Idle: { base: 0.18, slope: 0.035, w: 3 },
      Cooking: { base: 0.25, slope: 0.005, w: 2 },
      Adventure: { base: 0.3, slope: 0.005, w: 2 },
      Driving: { base: 0.25, slope: -0.005, w: 2 },
      Survivor: { base: 0.2, slope: 0.015, w: 1 },
    },
  },
  {
    name: "crazygames",
    base_url: "https://crazygames.com",
    genres: {
      Survivor: { base: 0.15, slope: 0.035, w: 3 },
      ".io": { base: 0.5, slope: 0.015, w: 5 },
      Shooter: { base: 0.45, slope: 0.005, w: 4 },
      Driving: { base: 0.35, slope: -0.005, w: 3 },
      Horror: { base: 0.3, slope: 0.005, w: 2 },
      Puzzle: { base: 0.45, slope: -0.025, w: 2 },
      Strategy: { base: 0.3, slope: 0.005, w: 2 },
    },
  },
];

const GENRE_TAGS: Record<string, string[]> = {
  Puzzle: ["puzzle", "logic", "brain"],
  Casual: ["casual", "relaxing"],
  Idle: ["idle", "incremental", "cozy"],
  Cooking: ["cooking", "time-management"],
  Adventure: ["adventure", "story"],
  Driving: ["driving", "cars"],
  Survivor: ["survivor-like", "roguelite"],
  ".io": ["io", "multiplayer"],
  Shooter: ["shooter", "action"],
  Horror: ["horror", "atmosphere"],
  Strategy: ["strategy", "tower-defense"],
};
const CROSS_TAGS = ["physics", "pixel", "3d", "retro", "arcade", "mobile", "short-session", "merge"];
const DEVELOPERS = [
  "Nova Forge", "Pixel Cabin", "Loop Labs", "Mad Otter", "Solo Star", "Bitwave",
  "Hexa Games", "Cozy Knoll", "Drift Co", "Volt Studio", "Tiny Titan", "Glasshouse",
];
const ENGINES = ["HTML5", "Unity", "Phaser", "Three.js", "Construct"];
const ORIENT = ["landscape", "portrait", "both"];

function weekLabels(): string[] {
  return Array.from({ length: WEEKS }, (_, i) => "W" + (BASE_WEEK_NO + i));
}
function weekDate(i: number): string {
  const d = new Date(BASE_DATE - (WEEKS - 1 - i) * 7 * 86400000);
  return d.toISOString();
}
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

async function one(db: Querier, sql: string, params: unknown[]): Promise<Record<string, any>> {
  const r = await db.query(sql, params);
  return r[0];
}

export async function seed(db: Querier): Promise<void> {
  await db.exec(
    `TRUNCATE library_items, brief_editions, game_tags, game_snapshots, tags, games, crawls, sources RESTART IDENTITY CASCADE;`
  );

  const rng = mulberry32(20260626);
  const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

  // tags registry
  const tagId = new Map<string, number>();
  async function ensureTag(name: string): Promise<number> {
    if (tagId.has(name)) return tagId.get(name)!;
    const row = await one(db, "INSERT INTO tags(name) VALUES ($1) RETURNING id", [name]);
    tagId.set(name, row.id);
    return row.id;
  }

  for (const src of SOURCES) {
    const srcRow = await one(db, "INSERT INTO sources(name, base_url) VALUES ($1,$2) RETURNING id", [
      src.name,
      src.base_url,
    ]);
    const sourceId = srcRow.id as number;

    // weekly crawls for this source
    const crawlIds: number[] = [];
    for (let i = 0; i < WEEKS; i++) {
      const c = await one(
        db,
        "INSERT INTO crawls(source_id, started_at, finished_at, status, games_seen) VALUES ($1,$2,$2,'ok',0) RETURNING id",
        [sourceId, weekDate(i)]
      );
      crawlIds.push(c.id);
    }

    // genre distribution by weight → ~60 games
    const genreEntries = Object.entries(src.genres);
    const totalW = genreEntries.reduce((a, [, g]) => a + g.w, 0);
    const TARGET = 60;
    const plan: string[] = [];
    for (const [name, g] of genreEntries) {
      const n = Math.max(3, Math.round((g.w / totalW) * TARGET));
      for (let k = 0; k < n; k++) plan.push(name);
    }

    let idx = 0;
    for (const genre of plan) {
      idx++;
      const cfg = src.genres[genre];
      // hidden-gem injection: ~ first 4 games per source -> high rating, low votes, never featured
      const isGem = idx <= 4;
      const debut = !isGem && rng() < 0.18 ? 6 + Math.floor(rng() * 6) : 0; // some games debut mid-window
      const baseVotes = isGem
        ? Math.floor(200 + rng() * 2500)
        : Math.floor(Math.pow(10, 2 + rng() * 4)); // 100 .. ~1,000,000
      const baseRating = isGem ? 4.5 + rng() * 0.45 : 3.4 + rng() * 1.5;
      const slug = `${genre.toLowerCase().replace(/[^a-z]/g, "")}-${src.name}-${idx}`;
      const game = await one(
        db,
        `INSERT INTO games(source_id, source_game_id, url, title, thumbnail_url, developer, description, engine, orientation, mobile, first_seen_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          sourceId,
          slug,
          `${src.base_url}/en/g/${slug}`,
          `${genre} ${["Rush", "Quest", "Mania", "Arena", "World", "Saga", "Blast", "Dash"][idx % 8]} ${idx}`,
          `${src.base_url}/cdn/thumb/${slug}.png`,
          pick(DEVELOPERS),
          `A ${genre} browser game.`,
          pick(ENGINES),
          pick(ORIENT),
          rng() > 0.4,
          weekDate(debut),
          weekDate(WEEKS - 1),
        ]
      );
      const gameId = game.id as number;

      // tags
      const tagNames = new Set<string>(GENRE_TAGS[genre] ?? [genre.toLowerCase()]);
      const crossCount = 1 + Math.floor(rng() * 2);
      for (let c = 0; c < crossCount; c++) tagNames.add(pick(CROSS_TAGS));
      for (const tn of tagNames) {
        const tid = await ensureTag(tn);
        await db.query("INSERT INTO game_tags(game_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
          gameId,
          tid,
        ]);
      }

      // weekly snapshots (append-only)
      for (let i = debut; i < WEEKS; i++) {
        const featProb = isGem ? 0 : clamp(cfg.base + cfg.slope * i, 0, 0.95);
        const featured = rng() < featProb;
        const votes = Math.round(baseVotes * (0.5 + 0.5 * (i / (WEEKS - 1))));
        const rating = +clamp(baseRating + (rng() - 0.5) * 0.1, 2.5, 5).toFixed(2);
        await db.query(
          `INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, plays, homepage_position, featured, trending, genre)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            gameId,
            crawlIds[i],
            weekDate(i),
            rating,
            votes,
            Math.round(votes * (20 + rng() * 60)),
            featured ? 1 + Math.floor(rng() * 40) : null,
            featured,
            featured && rng() > 0.6,
            genre,
          ]
        );
      }
    }
  }

  // brief editions (2 samples)
  // Real indie-brief edition shape (matches build-brief.js brief-content-<date>.json)
  const ed1 = {
    weekday: "Thursday",
    phase_badge: "Recovery + discovery · Jun 2026 · study UEFN loops, no production",
    top_signals: [
      "**Survivor-likes still climbing** on CrazyGames — 4th week up; cross-check the Radar gap list.",
      "**Cozy automation** breaking out: management hybrids over-index in demand on browser portals.",
      "**WebGL load-time bar dropping**: three new size-reduction tools shipped this week.",
    ],
    new_notable: [
      { name: "Vampire Survivors-like (1-dev)", status: "Launched", category: "Loop reference", blurb: "Auto-attack + weapon-evolution loop in a 6-week Phaser build.", relevance: "For you: confirms a solo scope can hit the rising survivor-like wave on web.", figure: "4.6★ CrazyGames", team: "solo", source: "https://crazygames.com" },
      { name: "Cozy Merge Factory", status: "Demo", category: "Automation/logistics", blurb: "Merge + light logistics with a relaxing pace.", relevance: "For you: matches Radar gap #3 (cozy idle on Poki).", figure: "12k wishlists", source: "https://store.steampowered.com" },
    ],
    browser: [
      { name: "Smash Karts", kind: "Browser game", status: "Trending", blurb: ".io kart battler holding the CrazyGames homepage.", relevance: "For you: short-session multiplayer loop worth dissecting.", figure: "50M plays", source: "https://crazygames.com" },
    ],
    tooling: {
      headline: "WebGL build-size tooling had a strong week — relevant if load-time is your blocker.",
      items: [
        { group: "Web/Browser", headline: "Draco + texture atlasing preset", detail: "Cut a typical build by ~35%.", relevance: "For you: faster first-load = better web retention.", source: "https://example.com" },
      ],
    },
    market: [
      { headline: "CrazyGames rev-share at 70% for top earners", figure: "70%", detail: "Confirmed in their dev docs update.", source: "https://crazygames.com" },
    ],
    reference_shelf: "Vampire Survivors, Dome Keeper, Luck be a Landlord, Mini Motorways — see Routine Notes › Reference Shelf.",
    founder_take: [
      "Browser-first remains the cheapest way to prove a loop; the survivor-like wave is real but crowding fast.",
      "Lean into a contained-systemic cozy hybrid where the Radar shows demand-supply gaps — Ship · Prove · Sustain.",
    ],
  };
  const ed2 = {
    weekday: "Monday",
    phase_badge: "Recovery + discovery · Jun 2026",
    top_signals: ["**Low-poly stylization** up ~28% QoQ in new releases — cheaper to produce solo."],
    new_notable: [
      { name: "Tiny Glade-like builder", status: "Announced", category: "Cozy/management", blurb: "Relaxing diorama builder.", relevance: "For you: low-poly cozy reference.", source: "https://store.steampowered.com" },
    ],
    browser: [],
    tooling: { headline: "Engine size tooling continues to improve.", items: [] },
    market: [{ headline: "Match-3 losing features to merge hybrids", figure: "-21%", detail: "Across browser portals.", source: "https://example.com" }],
    reference_shelf: "Tiny Glade, Dorfromantik, Terra Nil.",
    founder_take: ["Audit the art pipeline for low-poly reuse before committing to a visual direction."],
  };

  await db.query(
    `INSERT INTO brief_editions(edition_date, weekday, brief_type, payload, source_count) VALUES ($1,$2,$3,$4,$5)`,
    ["2026-06-26", "thu", "indie", JSON.stringify(ed1), 14]
  );
  await db.query(
    `INSERT INTO brief_editions(edition_date, weekday, brief_type, payload, source_count) VALUES ($1,$2,$3,$4,$5)`,
    ["2026-06-23", "mon", "indie", JSON.stringify(ed2), 11]
  );
  // library_items intentionally empty (V2)
}

export { weekLabels };

// CLI: tsx src/db/seed.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = await appDb();
  await applySchema(db);
  await seed(db);
  console.log("✔ seeded");
  process.exit(0);
}
