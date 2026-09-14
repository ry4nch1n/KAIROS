# KAIROS — Browser Game Market Intelligence Command Center

A solo-operable command center with four services behind one shell:

- **Radar** (GameRadar) — market-intelligence dashboard for CrazyGames, Poki & Steam (the "what to build next" engine): demand-vs-supply reads, a "this week's read" answer strip, hidden gems, market gaps, and a demand/supply quadrant
- **Brief** — the indie + gaming brief, rendered from the database
- **Library** — the idea-exploration collection: dated **Pitches** (contract-validated game concepts, scored across five factors) + playable **Prototypes**, plus a candidate **Leaderboard**
- **Revenue** — a browser/Steam revenue model (scenario bands, engine terms) with a private, per-browser monthly target

## Documents

| Doc | What |
|---|---|
| [DESIGN.md](DESIGN.md) | Architecture, design reasoning and tradeoffs, and the stack, as built |
| [OPERATIONS.md](OPERATIONS.md) | How it runs & is maintained (hosting, workflows, secrets, crawl) |
| [TEST_PLAN.md](TEST_PLAN.md) | What "working" means: gate layers, data-quality gate, definition of done |
| [docs/reference/](docs/reference/) | Generated reference: schema, API routes, contract, architecture diagram |
| [docs/decisions/](docs/decisions/) | Dated decision records |
| [mockup/overview.html](mockup/overview.html) | Approved static design reference (light mode) |

## Layout

```
app/
├─ web/        Vite + React SPA (the KAIROS shell + 4 services) · e2e/ Playwright specs
├─ server/     Express dev server, analytics, crawler, data-quality checks, db layer
│  ├─ src/db/        db.ts (PGlite|Neon switch) · schema.sql · seed.ts · migrate.ts
│  ├─ src/queries/   analytics handlers, shared by Express and the Netlify Function
│  ├─ src/api/       Express routes only
│  ├─ src/crawler/   SourceAdapter base + crazygames / poki / steam adapters
│  ├─ src/checks/    data-quality assessors
│  ├─ scripts/       data-quality gate, tier backfill, live Steam validation
│  └─ test/          Vitest specs + captured fixtures
├─ netlify/    production Function + edge auth gate
└─ shared/     the data contract and types shared by web + server
```

## Run it locally

```bash
cd app
npm install
npm run db:seed      # creates ./server/.data/kairos (PGlite) + deterministic sample data
npm run dev          # starts API (Express) + web (Vite) together
# open the printed http://localhost:5173
```

Run the tests:

```bash
cd app
npm test
```

## Run against Neon

Set `DATABASE_URL` to the Neon connection string. The DB layer selects the Neon driver when `DATABASE_URL` is present and local PGlite otherwise, with no code change.

```bash
DATABASE_URL="postgres://...neon.tech/db?sslmode=require" npm run db:migrate
DATABASE_URL="postgres://..." npm run crawl:crazygames
```

Production crawls, migrations and deploys run from GitHub Actions; see [OPERATIONS.md](OPERATIONS.md).
