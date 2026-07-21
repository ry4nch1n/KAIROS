<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: app/server/src/db/schema.sql
     Regenerate: npx tsx app/server/src/scripts/gen-docs.ts
     A drift check (app/server/test/docsDrift.test.ts) fails the suite if this is stale. -->

# Database schema reference

10 tables, 1 view (`v_latest`).
The same schema runs on PGlite locally and Neon in production. **Migrations are additive only** —
the implement loop's guard rejects any `DROP`, `RENAME`, or type narrowing.

## Entity relationships

```mermaid
erDiagram
  sources ||--o{ games : "source_id"
  sources ||--o{ crawls : "source_id"
  games ||--o{ game_snapshots : "game_id"
  crawls ||--o{ game_snapshots : "crawl_id"
  games ||--o{ game_tags : "game_id"
  tags ||--o{ game_tags : "tag_id"
  sources {
    serial id
    text name
    text base_url
    boolean active
  }
  games {
    bigserial id
    int source_id
    text source_game_id
    text url
    text title
    text thumbnail_url
    text developer
    text description
    text engine
    text orientation
    boolean mobile
    date release_date
    timestamptz first_seen_at
    timestamptz last_seen_at
    boolean is_live
  }
  crawls {
    bigserial id
    int source_id
    timestamptz started_at
    timestamptz finished_at
    text status
    int games_seen
  }
  game_snapshots {
    bigserial id
    bigint game_id
    bigint crawl_id
    timestamptz captured_at
    numeric(4,2) rating
    int votes
    bigint plays
    int homepage_position
    boolean featured
    boolean trending
    text genre
    int price_cents
    int discount_pct
    bigint owners_est
    int ccu
    int median_playtime_min
    int metacritic
    text scale_tier
  }
  tags {
    serial id
    text name
  }
  game_tags {
    bigint game_id
    int tag_id
  }
  brief_editions {
    bigserial id
    date edition_date
    text weekday
    text brief_type
    jsonb payload
    text rendered_html
    text local_path
    int source_count
    timestamptz created_at
  }
  brief_steering {
    int id
    jsonb flags
    timestamptz updated_at
  }
  library_items {
    bigserial id
    text kind
    text title
    text summary
    text media_url
    text tags
    text status
    timestamptz created_at
  }
  pitches {
    bigserial id
    text slug
    int rank
    text title
    text one_liner
    text loop_family
    text platform_ladder
    text status
    text badge
    text loop_detail
    text browser_mvp
    text steam_ladder
    text evidence
    text risk
    int d1_fit
    int steam_ceiling
    int build_cost
    date pitch_date
    text batch
    text source
    timestamptz created_at
    timestamptz updated_at
  }
```

## Tables

### `sources`

| Column | Type | References |
|--------|------|------------|
| `id` | `SERIAL PRIMARY KEY` |  |
| `name` | `TEXT UNIQUE NOT NULL` |  |
| `base_url` | `TEXT NOT NULL` |  |
| `active` | `BOOLEAN DEFAULT TRUE` |  |

### `games`

| Column | Type | References |
|--------|------|------------|
| `id` | `BIGSERIAL PRIMARY KEY` |  |
| `source_id` | `INT REFERENCES SOURCES(ID)` | → `sources` |
| `source_game_id` | `TEXT NOT NULL` |  |
| `url` | `TEXT NOT NULL` |  |
| `title` | `TEXT NOT NULL` |  |
| `thumbnail_url` | `TEXT` |  |
| `developer` | `TEXT` |  |
| `description` | `TEXT` |  |
| `engine` | `TEXT` |  |
| `orientation` | `TEXT` |  |
| `mobile` | `BOOLEAN` |  |
| `release_date` | `DATE` |  |
| `first_seen_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |  |
| `last_seen_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |  |
| `is_live` | `BOOLEAN DEFAULT TRUE` |  |

### `crawls`

| Column | Type | References |
|--------|------|------------|
| `id` | `BIGSERIAL PRIMARY KEY` |  |
| `source_id` | `INT REFERENCES SOURCES(ID)` | → `sources` |
| `started_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |  |
| `finished_at` | `TIMESTAMPTZ` |  |
| `status` | `TEXT DEFAULT` |  |
| `games_seen` | `INT` |  |

### `game_snapshots`

| Column | Type | References |
|--------|------|------------|
| `id` | `BIGSERIAL PRIMARY KEY` |  |
| `game_id` | `BIGINT REFERENCES GAMES(ID)` | → `games` |
| `crawl_id` | `BIGINT REFERENCES CRAWLS(ID)` | → `crawls` |
| `captured_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |  |
| `rating` | `NUMERIC(4,2)` |  |
| `votes` | `INT` |  |
| `plays` | `BIGINT` |  |
| `homepage_position` | `INT` |  |
| `featured` | `BOOLEAN DEFAULT FALSE` |  |
| `trending` | `BOOLEAN DEFAULT FALSE` |  |
| `genre` | `TEXT` |  |
| `price_cents` | `INT` |  |
| `discount_pct` | `INT` |  |
| `owners_est` | `BIGINT` |  |
| `ccu` | `INT` |  |
| `median_playtime_min` | `INT` |  |
| `metacritic` | `INT` |  |
| `scale_tier` | `TEXT` |  |

### `tags`

| Column | Type | References |
|--------|------|------------|
| `id` | `SERIAL PRIMARY KEY` |  |
| `name` | `TEXT UNIQUE NOT NULL` |  |

### `game_tags`

| Column | Type | References |
|--------|------|------------|
| `game_id` | `BIGINT REFERENCES GAMES(ID)` | → `games` |
| `tag_id` | `INT REFERENCES TAGS(ID)` | → `tags` |

### `brief_editions`

| Column | Type | References |
|--------|------|------------|
| `id` | `BIGSERIAL PRIMARY KEY` |  |
| `edition_date` | `DATE NOT NULL` |  |
| `weekday` | `TEXT` |  |
| `brief_type` | `TEXT` |  |
| `payload` | `JSONB NOT NULL` |  |
| `rendered_html` | `TEXT` |  |
| `local_path` | `TEXT` |  |
| `source_count` | `INT` |  |
| `created_at` | `TIMESTAMPTZ DEFAULT NOW()` |  |

### `brief_steering`

| Column | Type | References |
|--------|------|------------|
| `id` | `INT PRIMARY KEY DEFAULT 1` |  |
| `flags` | `JSONB NOT NULL DEFAULT` |  |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |  |

### `library_items`

| Column | Type | References |
|--------|------|------------|
| `id` | `BIGSERIAL PRIMARY KEY` |  |
| `kind` | `TEXT` |  |
| `title` | `TEXT NOT NULL` |  |
| `summary` | `TEXT` |  |
| `media_url` | `TEXT` |  |
| `tags` | `TEXT` |  |
| `status` | `TEXT DEFAULT` |  |
| `created_at` | `TIMESTAMPTZ DEFAULT NOW()` |  |

### `pitches`

| Column | Type | References |
|--------|------|------------|
| `id` | `BIGSERIAL PRIMARY KEY` |  |
| `slug` | `TEXT UNIQUE NOT NULL` |  |
| `rank` | `INT` |  |
| `title` | `TEXT NOT NULL` |  |
| `one_liner` | `TEXT` |  |
| `loop_family` | `TEXT` |  |
| `platform_ladder` | `TEXT DEFAULT` |  |
| `status` | `TEXT DEFAULT` |  |
| `badge` | `TEXT` |  |
| `loop_detail` | `TEXT` |  |
| `browser_mvp` | `TEXT` |  |
| `steam_ladder` | `TEXT` |  |
| `evidence` | `TEXT` |  |
| `risk` | `TEXT` |  |
| `d1_fit` | `INT` |  |
| `steam_ceiling` | `INT` |  |
| `build_cost` | `INT` |  |
| `pitch_date` | `DATE NOT NULL` |  |
| `batch` | `TEXT` |  |
| `source` | `TEXT` |  |
| `created_at` | `TIMESTAMPTZ DEFAULT NOW()` |  |
| `updated_at` | `TIMESTAMPTZ DEFAULT NOW()` |  |
