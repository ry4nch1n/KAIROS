// Analytics queries — chart-ready shapes. All accept a Querier (DI) + platform.
//
// This module was split into domain modules (issue #33, pure code movement — no behavior
// change) and is now a thin BARREL. Every existing consumer imports from here — both the
// namespace form (`import * as q from ".../queries/index.ts"` in app.ts / api.ts / stats.ts)
// and named imports in tests/scripts — so re-exporting each domain keeps them all working
// unchanged. The four domains:
//   ./shared  — cross-cutting helpers/constants used by more than one domain (num, pf,
//               canonSql, canonicalName, isCurationTag, classifyTrajectory, classifySupply,
//               genreSupplyTrend, SupplyInfo). Kept separate to avoid a browser↔steam cycle.
//   ./browser — browser-portal analytics (Poki + CrazyGames).
//   ./steam   — Steam / PC analytics.
//   ./library — brief editions + steering, pitches, and Library CRUD.
export * from "./shared.ts";
export * from "./browser.ts";
export * from "./steam.ts";
export * from "./library.ts";
