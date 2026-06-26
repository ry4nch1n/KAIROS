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
  const ed1 = {
    title: "Indie & Gaming Brief",
    refsTier1: [
      { rtag: "MECHANIC", title: "Vampire Survivors' weapon-evolution loop", src: "gamedeveloper.com · postmortem", body: "Auto-attack + evolution pairs create a 3-minute dopamine cadence. Transfers cleanly to short-session web." },
      { rtag: "UX", title: "Cozy onboarding without tutorials", src: "GDC talk · 22 min", body: "Diegetic first-five-minutes beats explicit tutorials for casual-web retention." },
    ],
    refsTier2: [
      { rtag: "SHIPPED", title: "1-dev survivor-like -> 4.6 on CrazyGames", src: "devlog · 6-week build", body: "WebGL build under 18 MB, Phaser. A one-person scope can hit the rising survivor-like wave." },
      { rtag: "REVENUE", title: "Rewarded-ad pacing for web", src: "solo-dev thread", body: "Offer-on-death + offer-on-revive monetizes without nagging. ~$2.1 RPM cited for action." },
    ],
    signals: [
      { kind: "up", tag: "SUSTAINED", meta: "4th week up", text: "Survivor-likes keep climbing on CrazyGames - cross-check the Radar gap list." },
      { kind: "gap", tag: "OPPORTUNITY", meta: "matches Radar gap #3", text: "Cozy + automation hybrids are under-served vs demand on Poki." },
    ],
    actions: [
      "Prototype a short-session survivor-like loop (validate against Radar gap #2).",
      "Test diegetic onboarding on next build - no tutorial popups.",
    ],
  };
  const ed2 = {
    title: "Indie & Gaming Brief",
    refsTier1: [
      { rtag: "MARKET", title: "Low-poly stylization rising on portals", src: "trend roundup", body: "Stylized low-poly is up ~28% QoQ in new releases - cheaper to produce solo." },
    ],
    refsTier2: [
      { rtag: "TOOLING", title: "WebGL size-reduction checklist", src: "engine blog", body: "Texture atlasing + Draco cut a typical build by ~35%." },
    ],
    signals: [
      { kind: "down", tag: "DECLINING", meta: "-21%", text: "Classic match-3 is slowly losing features to merge hybrids." },
    ],
    actions: ["Audit art pipeline for low-poly reuse."],
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
