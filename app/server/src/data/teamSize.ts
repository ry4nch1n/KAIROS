// Curated team-size estimates for indie comparables — the basis for the "solo-reachable"
// cohort (issue #9). Team size is NOT exposed by any Steam or third-party API (even
// MobyGames keeps credits out of its API), so these are RESEARCHED estimates. Each carries a
// citation, a confidence, and an as-of date; git history is the audit trail, so treat every
// edit as a sourced claim, not a guess.
//
// CONVENTION: `bucket` reflects the team that BUILT THE STUDIO'S BREAKOUT HIT — the signal a
// solo dev actually cares about ("is this a realistic aspiration for me?"). Post-hit headcount
// (studios often grow) lives in `headcount`. A studio absent from this map is UNKNOWN — it is
// excluded from the solo cohort, never assumed solo.
//
// Buckets: solo = 1–2 · small = 3–10 · mid = 11–30 · large = 30+.
import type { TeamSizeBucket, TeamSizeConfidence } from "shared";

export interface TeamSizeEstimate {
  bucket: TeamSizeBucket;
  headcount: string; // human-readable, e.g. "~25", "1 (solo)", "solo at launch; ~25 now"
  source: string; // citation URL
  confidence: TeamSizeConfidence;
  asOf: string; // YYYY-MM
}

/** Normalize a developer string for lookup: lowercase, trim, collapse internal whitespace. */
export function normalizeDev(name: string | null | undefined): string {
  return String(name ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Keyed by normalized developer name (as it appears in games.developer from Steam appdetails).
const ESTIMATES: Record<string, TeamSizeEstimate> = {
  "localthunk":           { bucket: "solo",  headcount: "1 (solo)",                                    source: "https://en.wikipedia.org/wiki/Balatro",                     confidence: "high",   asOf: "2026-07" },
  "concernedape":         { bucket: "solo",  headcount: "1 (solo)",                                    source: "https://en.wikipedia.org/wiki/Stardew_Valley",              confidence: "high",   asOf: "2026-07" },
  "mega crit games":      { bucket: "solo",  headcount: "2 founders (Slay the Spire)",                 source: "https://en.wikipedia.org/wiki/Slay_the_Spire",              confidence: "high",   asOf: "2026-07" },
  "mega crit":            { bucket: "solo",  headcount: "2 founders (Slay the Spire)",                 source: "https://en.wikipedia.org/wiki/Slay_the_Spire",              confidence: "high",   asOf: "2026-07" },
  "poncle":               { bucket: "solo",  headcount: "solo at VS launch (Luca Galante); ~25+ now",  source: "https://en.wikipedia.org/wiki/Vampire_Survivors",           confidence: "high",   asOf: "2026-07" },
  "tvgs":                 { bucket: "solo",  headcount: "solo (Tyler); ~3–4 now",                      source: "https://www.pcgamer.com/games/life-sim/schedule-1-developer-tvgs-is-an-actual-game-studio-now-with-an-office-desks-and-a-new-guy-named-rob-by-the-end-of-the-year-there-will-likely-be-4-people-working-on-schedule-1/", confidence: "high", asOf: "2026-07" },
  "team cherry":          { bucket: "small", headcount: "3 core",                                      source: "https://en.wikipedia.org/wiki/Team_Cherry",                 confidence: "high",   asOf: "2026-07" },
  "re-logic":             { bucket: "small", headcount: "~10",                                         source: "https://www.linkedin.com/company/re-logic",                 confidence: "medium", asOf: "2026-07" },
  "nokta games":          { bucket: "small", headcount: "4",                                           source: "https://gameworldobserver.com/2024/03/05/supermarket-simulator-viral-success-40k-ccu-turkish-devs", confidence: "medium", asOf: "2026-07" },
  "tobyfox":              { bucket: "small", headcount: "Toby Fox + core team (Undertale near-solo)",  source: "https://en.wikipedia.org/wiki/Deltarune",                   confidence: "medium", asOf: "2026-07" },
  "supergiant games":     { bucket: "mid",   headcount: "~25 (>20 on Hades II)",                       source: "https://en.wikipedia.org/wiki/Supergiant_Games",            confidence: "high",   asOf: "2026-07" },
  "sandfall interactive": { bucket: "mid",   headcount: "~30 core (publisher-backed)",                 source: "https://en.wikipedia.org/wiki/Clair_Obscur:_Expedition_33", confidence: "high",   asOf: "2026-07" },
  "11 bit studios":       { bucket: "large", headcount: "~265",                                        source: "https://en.wikipedia.org/wiki/11_Bit_Studios",              confidence: "high",   asOf: "2026-07" },
};

/** Solo-reachable = a 1–2 (solo) or 3–10 (small) person team could realistically have shipped it. */
export function isSoloReachable(bucket: TeamSizeBucket): boolean {
  return bucket === "solo" || bucket === "small";
}

/** Curated team-size estimate for a developer, or null when the studio isn't researched yet. */
export function teamSizeFor(developer: string | null | undefined): TeamSizeEstimate | null {
  const key = normalizeDev(developer);
  return key ? ESTIMATES[key] ?? null : null;
}
