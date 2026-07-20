-- KAIROS schema (Postgres / PGlite compatible)
-- Layer 1: identity · Layer 2: append-only facts · brief + library namespaces.

CREATE TABLE IF NOT EXISTS sources (
  id        SERIAL PRIMARY KEY,
  name      TEXT UNIQUE NOT NULL,        -- 'poki' | 'crazygames' | 'steam'
  base_url  TEXT NOT NULL,
  active    BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS games (
  id             BIGSERIAL PRIMARY KEY,
  source_id      INT REFERENCES sources(id),
  source_game_id TEXT NOT NULL,
  url            TEXT NOT NULL,
  title          TEXT NOT NULL,
  thumbnail_url  TEXT,
  developer      TEXT,
  description    TEXT,
  engine         TEXT,
  orientation    TEXT,
  mobile         BOOLEAN,
  release_date   DATE,                   -- Phase 2: stable per-game (Steam appdetails)
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_live        BOOLEAN DEFAULT TRUE,
  UNIQUE (source_id, source_game_id)
);

CREATE TABLE IF NOT EXISTS crawls (
  id          BIGSERIAL PRIMARY KEY,
  source_id   INT REFERENCES sources(id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT DEFAULT 'running',
  games_seen  INT
);

-- append-only daily facts
CREATE TABLE IF NOT EXISTS game_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  game_id       BIGINT REFERENCES games(id),
  crawl_id      BIGINT REFERENCES crawls(id),
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  rating        NUMERIC(4,2),
  votes         INT,
  plays         BIGINT,
  homepage_position INT,
  featured      BOOLEAN DEFAULT FALSE,
  trending      BOOLEAN DEFAULT FALSE,
  genre         TEXT,
  -- Phase 2: Steam / PC time-varying metrics (null for browser sources)
  price_cents         INT,
  discount_pct        INT,
  owners_est          BIGINT,   -- SteamSpy owners-bucket midpoint
  ccu                 INT,      -- concurrent players
  median_playtime_min INT,      -- SteamSpy median_forever (minutes)
  metacritic          INT,
  scale_tier          TEXT,     -- 'hobby' | 'small_indie' | 'est_indie' | 'aaa'
  UNIQUE (game_id, crawl_id)
);
CREATE INDEX IF NOT EXISTS idx_snap_game_time ON game_snapshots (game_id, captured_at DESC);

-- Phase 2 additive migration for already-provisioned DBs (Neon). Idempotent.
ALTER TABLE games          ADD COLUMN IF NOT EXISTS release_date        DATE;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS price_cents         INT;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS discount_pct        INT;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS owners_est          BIGINT;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS ccu                 INT;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS median_playtime_min INT;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS metacritic          INT;
ALTER TABLE game_snapshots ADD COLUMN IF NOT EXISTS scale_tier          TEXT;

CREATE TABLE IF NOT EXISTS tags (
  id   SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS game_tags (
  game_id BIGINT REFERENCES games(id),
  tag_id  INT REFERENCES tags(id),
  PRIMARY KEY (game_id, tag_id)
);

-- latest snapshot per game
CREATE OR REPLACE VIEW v_latest AS
SELECT DISTINCT ON (game_id) *
FROM game_snapshots
ORDER BY game_id, captured_at DESC;

-- brief namespace
CREATE TABLE IF NOT EXISTS brief_editions (
  id            BIGSERIAL PRIMARY KEY,
  edition_date  DATE NOT NULL,
  weekday       TEXT,
  brief_type    TEXT,
  payload       JSONB NOT NULL,
  rendered_html TEXT,
  local_path    TEXT,
  source_count  INT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (edition_date, brief_type)
);

-- brief steering: current "Standing Flags" (interests) the routine reads from Notion,
-- mirrored here read-only so KAIROS can show what's steering the next brief. Single row.
CREATE TABLE IF NOT EXISTS brief_steering (
  id         INT PRIMARY KEY DEFAULT 1,
  flags      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- library namespace
CREATE TABLE IF NOT EXISTS library_items (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT,
  title      TEXT NOT NULL,
  summary    TEXT,
  media_url  TEXT,
  tags       TEXT[],
  status     TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prototype card art: a poster/thumbnail for the Library → Prototypes card.
-- Additive so prod migrates in place (existing rows keep NULL until backfilled).
ALTER TABLE library_items ADD COLUMN IF NOT EXISTS image_url TEXT;

-- pitches namespace: game-concept pitches (the Library "Pitches" collection).
-- Written by the weekly kairos-iterate routine (token-gated POST /api/pitches, upsert on slug).
-- Dated + classified so future batches stay cleanly grouped and sortable.
CREATE TABLE IF NOT EXISTS pitches (
  id              BIGSERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,          -- stable natural key for upsert
  rank            INT,                            -- presentation order within a batch
  title           TEXT NOT NULL,
  one_liner       TEXT,
  loop_family     TEXT,                           -- taxonomy enum — see CONTRACT.pitch.loopFamilies (contract.ts) for the authoritative, versioned list (9 as of pitch v8)
  platform_ladder TEXT DEFAULT 'browser->steam',
  status          TEXT DEFAULT 'proposed',        -- proposed | prototyping | shelved | shipped
  badge           TEXT,                           -- recommended | retention-safe | cashflow | cheapest-build | ...
  loop_detail     TEXT,
  browser_mvp     TEXT,
  steam_ladder    TEXT,
  evidence        TEXT,
  risk            TEXT,
  d1_fit          INT,                            -- 1..3 (retention-gate fit)
  steam_ceiling   INT,                            -- 1..3
  build_cost      INT,                            -- 1..3 (higher = cheaper/easier)
  pitch_date      DATE NOT NULL,                  -- as-of date (batch dating)
  batch           TEXT,                           -- cohort label, e.g. '2026-07-06'
  source          TEXT,                           -- provenance, e.g. 'kairos-review 2026-07-06'
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pitches_date ON pitches (pitch_date DESC, rank ASC);
-- Visual card (contract pitch v2): world/style dimensions + generated art. Additive so prod migrates in place.
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS setting    TEXT;
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS art_style  TEXT;
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS code_name  TEXT;   -- placeholder project name shown on the header capsule
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS header_url TEXT;   -- Steam-style header capsule image
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS shot_url   TEXT;   -- in-game screenshot image
-- Rating rework (contract pitch v3): browser & Steam become co-equal fit axes; build_ease renames
-- build_cost (same "higher = easier" semantics); provenance flags evidence strength. Additive +
-- one-time guarded backfill so prod migrates in place without blanking existing cards. Old columns
-- (d1_fit/steam_ceiling/build_cost) are kept as the backfill source, then left deprecated/unread.
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS browser_fit INT;   -- 1..3 browser-native viability (was d1_fit)
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS steam_fit   INT;   -- 1..3 paid-Steam laddering + ceiling (was steam_ceiling)
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS build_ease  INT;   -- 1..3 solo feasibility, higher = easier (renames build_cost)
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS provenance  TEXT;  -- market-backed | design-derived
UPDATE pitches SET browser_fit = d1_fit        WHERE browser_fit IS NULL AND d1_fit        IS NOT NULL;
UPDATE pitches SET steam_fit   = steam_ceiling WHERE steam_fit   IS NULL AND steam_ceiling IS NOT NULL;
UPDATE pitches SET build_ease  = build_cost    WHERE build_ease  IS NULL AND build_cost    IS NOT NULL;
-- Pitch v5 (contract pitch.version 5): read a pitch through BOTH lenses of the durable
-- methodology, not just the commercial half. Scope block (can the loop be proven fun before
-- it eats the year?), hook (does it capsule?), founder fit (would you still care in month
-- four?). Purely additive + null for existing cards — no backfill; the card omits an unset
-- field and the next routine run authors v5 fields going forward.
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS gray_box_days INT;   -- days to a testable gray-box loop
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS content_scope TEXT;  -- small | medium | large (vs genre expectation)
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS tech_risk     TEXT;  -- the scariest technical unknown, one line
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS hook          TEXT;  -- capsule promise / marketing beat
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS marketability INT;   -- 1..3 first-session pull (was #26 "Grab")
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS founder_fit   INT;   -- 1..3 personal pull + edge
ALTER TABLE pitches ADD COLUMN IF NOT EXISTS why_me        TEXT;  -- why this holds your attention / your edge
