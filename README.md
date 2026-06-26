# KAIROS — Browser Game Market Intelligence Command Center

A solo-operable command center with three services behind one shell:

- **GameRadar** — market-intelligence dashboard for Poki & CrazyGames (the "what to build next" engine)
- **News Brief** — your Mon/Thu indie + gaming brief, rendered from the database
- **Library** — showcase of prototypes / design docs / art explorations (stub for now)

> Naming note: **KAIROS** is the umbrella hub. It matches your existing local-output convention (`Documents\KAIROS\Raw\<Tool>\`).

## Documents

| Doc | What |
|---|---|
| [DESIGN.md](DESIGN.md) | Architecture, DB schema, API, ETL, AI pipeline, roadmap, tradeoffs |
| [OPERATIONS.md](OPERATIONS.md) | How it runs & is maintained (crawl cron, hosting, DB) |
| [TEST_PLAN.md](TEST_PLAN.md) | Verification criteria + test inventory |
| [mockup/overview.html](mockup/overview.html) | Approved static design reference (light mode) |

## Stack (as built)

| Layer | Tech |
|---|---|
| Frontend | Vite + React + TypeScript + Apache ECharts |
| API | Express (local) / Netlify Functions (prod) — shared handlers |
| Database | PGlite (local dev, in-process Postgres) / Neon (prod) — same SQL |
| Crawler | TypeScript (`SourceAdapter` per site) |
| Tests | Vitest |

## Layout

```
app/
├─ web/        Vite + React SPA (the KAIROS shell + 3 services)
├─ server/     Express dev server, API handlers, crawler, seed, db layer
│  ├─ src/db/        db.ts (PGlite|Neon switch) · schema.sql · seed.ts
│  ├─ src/queries/   analytics queries (hidden gems, market gaps, momentum…)
│  ├─ src/api/       handlers (reused by Express + Netlify)
│  ├─ src/crawler/   SourceAdapter base + crazygames adapter
│  └─ test/          Vitest specs + fixtures
└─ shared/     TS types shared by web + server
```

## Run it locally

```bash
cd app
npm install
npm run db:seed      # creates ./.data/kairos.db (PGlite) + deterministic sample data
npm run dev          # starts API (Express) + web (Vite) together
# open the printed http://localhost:5173
```

Run the tests:

```bash
cd app
npm test
```

## Switch to Neon (prod) later

Set `DATABASE_URL` to your Neon pooled connection string. The DB layer auto-selects the Neon driver when `DATABASE_URL` is present; otherwise it uses local PGlite. No code change.

```bash
DATABASE_URL="postgres://...neon.tech/db?sslmode=require" npm run db:migrate
DATABASE_URL="postgres://..." npm run crawl:crazygames
```

## Deploy (prod, when accounts are ready)

1. **Neon**: create DB (or via Netlify's Neon integration), run `npm run db:migrate`.
2. **Netlify**: connect the repo; build `web`, publish `web/dist`; API handlers deploy as Functions; set `DATABASE_URL` env var.
3. **GitHub Actions**: daily cron runs `npm run crawl:crazygames` (+ Poki) against Neon.

See OPERATIONS.md for the full deployment + maintenance story.
