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
