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
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// 2026-08 research batch (#9): the studios actually appearing in the Steam comparables window.
// Kept one entry per line — a 33-row citation table is only readable as a table, so formatting is
// suppressed here on purpose. Same shape, same rules as ESTIMATES below; merged into it verbatim.
// Suffixes matter: normalizeDev does NOT strip "Ltd"/"Inc"/punctuation, so keys carry them, and
// alias keys (iron gate ab / iron gate studio) cover both strings Steam has shipped.
// biome-ignore format: one line per studio keeps this citation table scannable
const RESEARCHED_2026_08: Record<string, TeamSizeEstimate> = {
  "aggro crab": { bucket: "mid", headcount: "13 (studio; PEAK co-developed with Landfall)", source: "https://en.wikipedia.org/wiki/Aggro_Crab", confidence: "high", asOf: "2026-06" },
  "billy basso": { bucket: "solo", headcount: "1 (solo — 7 years, own C++ engine)", source: "https://en.wikipedia.org/wiki/Animal_Well", confidence: "high", asOf: "2024-05" },
  "black salt games": { bucket: "small", headcount: "4 founders on DREDGE; ~12 now", source: "https://www.rnz.co.nz/news/national/487649/how-four-kiwis-made-new-zealand-s-latest-gaming-success", confidence: "high", asOf: "2023-03" },
  "black tabby games": { bucket: "solo", headcount: "2 (Abby Howard + Tony Howard-Arias)", source: "https://en.wikipedia.org/wiki/Slay_the_Princess", confidence: "high", asOf: "2023-10" },
  "blackfoot studios": { bucket: "small", headcount: "5 named dev team (remote)", source: "https://sandbox.blackfootstudios.com/index.php/about/dev-team/", confidence: "medium", asOf: "2026-08" },
  blobfish: { bucket: "solo", headcount: "1 (solo — Thomas Gervraud)", source: "https://thomasgervraud.com/press/", confidence: "high", asOf: "2023-06" },
  "coffee stain studios": { bucket: "mid", headcount: "~24 (2018, Satisfactory era); 123 (2022)", source: "https://en.wikipedia.org/wiki/Coffee_Stain_Studios", confidence: "medium", asOf: "2018-11" },
  "colossal order": { bucket: "mid", headcount: "30 (2022); smaller at Cities: Skylines' 2015 launch (unsourced)", source: "https://en.wikipedia.org/wiki/Colossal_Order", confidence: "medium", asOf: "2022-01" },
  "dimensionless games": { bucket: "solo", headcount: "1 (solo — 2 years of solo dev to 1.0)", source: "https://happygamer.com/sketchys-contract-1-0-launches-steam-solo-dev-159622/", confidence: "medium", asOf: "2026-07" },
  dogubomb: { bucket: "solo", headcount: "1 (solo — Tonda Ros; art/music commissioned)", source: "https://en.wikipedia.org/wiki/Blue_Prince", confidence: "high", asOf: "2025-04" },
  "endnight games ltd": { bucket: "small", headcount: "4 core studio; 5–10 incl. contractors", source: "https://endnightgames.com/about", confidence: "medium", asOf: "2026-08" },
  "facepunch studios": { bucket: "solo", headcount: "1 (Garry Newman built Garry's Mod alone); 50+ (2023), 92 now", source: "https://en.wikipedia.org/wiki/Facepunch_Studios", confidence: "high", asOf: "2025-01" },
  "frozen dungeon": { bucket: "solo", headcount: "1 (solo — Jared Scott Kellen)", source: "https://www.frozendungeon.com/", confidence: "high", asOf: "2026-08" },
  innersloth: { bucket: "small", headcount: "3 at Among Us' breakout (1 programmer)", source: "https://www.innersloth.com/hello-world/", confidence: "high", asOf: "2020-09" },
  "iron gate ab": { bucket: "small", headcount: "5 at Valheim's early-access launch; ~16 studio / 8 on Valheim now", source: "https://en.wikipedia.org/wiki/Valheim", confidence: "high", asOf: "2021-02" },
  "iron gate studio": { bucket: "small", headcount: "5 at Valheim's early-access launch; ~16 studio / 8 on Valheim now", source: "https://en.wikipedia.org/wiki/Valheim", confidence: "high", asOf: "2021-02" },
  "kinetic games": { bucket: "solo", headcount: "1 (solo — Daniel Knight) at Phasmophobia's launch; 50+ now", source: "https://www.pcgamesn.com/phasmophobia/developer-update", confidence: "high", asOf: "2021-01" },
  "klei entertainment": { bucket: "large", headcount: "~35 around Don't Starve (2013); ~100 now", source: "https://en.wikipedia.org/wiki/Klei_Entertainment", confidence: "high", asOf: "2013-05" },
  landfall: { bucket: "mid", headcount: "11 (studio); ~5 core on Content Warning", source: "https://en.wikipedia.org/wiki/Landfall_(company)", confidence: "high", asOf: "2026-06" },
  "ludeon studios": { bucket: "small", headcount: "2–3 through RimWorld's development; 7 after 1.0", source: "https://en.wikipedia.org/wiki/RimWorld", confidence: "high", asOf: "2018-10" },
  "magnum scriptum": { bucket: "small", headcount: "2–10 (self-described \"little but strong team\")", source: "https://www.linkedin.com/company/magnum-scriptum-ltd", confidence: "low", asOf: "2026-08" },
  mossmouth: { bucket: "small", headcount: "6 (Derek Yu, Jon Perry, Eirik Suhrke, Paul Hubans, Tyriq Plummer, Ojiro Fumoto)", source: "https://en.wikipedia.org/wiki/UFO_50", confidence: "high", asOf: "2024-09" },
  "motion twin": { bucket: "small", headcount: "7 (worker co-op)", source: "https://motiontwin.com/", confidence: "high", asOf: "2026-08" },
  pocketpair: { bucket: "large", headcount: "3–4 at Palworld's start; 40+ hired for it; ~55 now", source: "https://en.wikipedia.org/wiki/Palworld", confidence: "medium", asOf: "2024-01" },
  "pounce light": { bucket: "solo", headcount: "2 (Anastasia Opara + Tomasz Stachowiak)", source: "https://en.wikipedia.org/wiki/Tiny_Glade", confidence: "high", asOf: "2024-09" },
  "prideful sloth": { bucket: "small", headcount: "7 full-time + 2 part-time", source: "https://developer.microsoft.com/en-us/games/articles/2024/03/gdc-2024-meet-the-id-at-xbox-developers/", confidence: "high", asOf: "2024-03" },
  "redbeet interactive": { bucket: "small", headcount: "3 at start; 7 by Raft's 1.0", source: "https://en.wikipedia.org/wiki/Raft_(video_game)", confidence: "high", asOf: "2022-06" },
  "slavic magic": { bucket: "solo", headcount: "1 (solo — Grzegorz \"Greg\" Styczeń)", source: "https://en.wikipedia.org/wiki/Manor_Lords", confidence: "high", asOf: "2024-04" },
  "smartly dressed games": { bucket: "solo", headcount: "1 (solo — Nelson Sexton); 2 since 2019", source: "https://en.wikipedia.org/wiki/Unturned", confidence: "high", asOf: "2019-01" },
  "tour de pizza": { bucket: "solo", headcount: "2 core (McPig + Sertif) plus contract composers", source: "https://en.wikipedia.org/wiki/Pizza_Tower", confidence: "high", asOf: "2023-01" },
  vedinad: { bucket: "solo", headcount: "1 (solo)", source: "https://en.wikipedia.org/wiki/Megabonk", confidence: "high", asOf: "2025-09" },
  "wales interactive": { bucket: "small", headcount: "~10 (Wikipedia); ~14 (2025)", source: "https://en.wikipedia.org/wiki/Wales_Interactive", confidence: "low", asOf: "2025-07" },
  zeekerss: { bucket: "solo", headcount: "1 (solo)", source: "https://www.gamesradar.com/games/horror/life-after-lethal-company-solo-creator-zeekerss-says-weirdly-not-a-lot-has-changed-after-one-of-the-biggest-indie-hits-in-recent-memory-and-he-still-has-a-good-handful-of-ideas-for-games/", confidence: "high", asOf: "2023-10" },
};

// Keyed by normalized developer name (as it appears in games.developer from Steam appdetails).
const ESTIMATES: Record<string, TeamSizeEstimate> = {
  ...RESEARCHED_2026_08,
  localthunk: {
    bucket: "solo",
    headcount: "1 (solo)",
    source: "https://en.wikipedia.org/wiki/Balatro",
    confidence: "high",
    asOf: "2026-07",
  },
  concernedape: {
    bucket: "solo",
    headcount: "1 (solo)",
    source: "https://en.wikipedia.org/wiki/Stardew_Valley",
    confidence: "high",
    asOf: "2026-07",
  },
  "mega crit games": {
    bucket: "solo",
    headcount: "2 founders (Slay the Spire)",
    source: "https://en.wikipedia.org/wiki/Slay_the_Spire",
    confidence: "high",
    asOf: "2026-07",
  },
  "mega crit": {
    bucket: "solo",
    headcount: "2 founders (Slay the Spire)",
    source: "https://en.wikipedia.org/wiki/Slay_the_Spire",
    confidence: "high",
    asOf: "2026-07",
  },
  poncle: {
    bucket: "solo",
    headcount: "solo at VS launch (Luca Galante); ~25+ now",
    source: "https://en.wikipedia.org/wiki/Vampire_Survivors",
    confidence: "high",
    asOf: "2026-07",
  },
  tvgs: {
    bucket: "solo",
    headcount: "solo (Tyler); ~3–4 now",
    source:
      "https://www.pcgamer.com/games/life-sim/schedule-1-developer-tvgs-is-an-actual-game-studio-now-with-an-office-desks-and-a-new-guy-named-rob-by-the-end-of-the-year-there-will-likely-be-4-people-working-on-schedule-1/",
    confidence: "high",
    asOf: "2026-07",
  },
  "team cherry": {
    bucket: "small",
    headcount: "3 core",
    source: "https://en.wikipedia.org/wiki/Team_Cherry",
    confidence: "high",
    asOf: "2026-07",
  },
  "re-logic": {
    bucket: "small",
    headcount: "~10",
    source: "https://www.linkedin.com/company/re-logic",
    confidence: "medium",
    asOf: "2026-07",
  },
  "nokta games": {
    bucket: "small",
    headcount: "4",
    source:
      "https://gameworldobserver.com/2024/03/05/supermarket-simulator-viral-success-40k-ccu-turkish-devs",
    confidence: "medium",
    asOf: "2026-07",
  },
  tobyfox: {
    bucket: "small",
    headcount: "Toby Fox + core team (Undertale near-solo)",
    source: "https://en.wikipedia.org/wiki/Deltarune",
    confidence: "medium",
    asOf: "2026-07",
  },
  "supergiant games": {
    bucket: "mid",
    headcount: "~25 (>20 on Hades II)",
    source: "https://en.wikipedia.org/wiki/Supergiant_Games",
    confidence: "high",
    asOf: "2026-07",
  },
  "sandfall interactive": {
    bucket: "mid",
    headcount: "~30 core (publisher-backed)",
    source: "https://en.wikipedia.org/wiki/Clair_Obscur:_Expedition_33",
    confidence: "high",
    asOf: "2026-07",
  },
  "11 bit studios": {
    bucket: "large",
    headcount: "~265",
    source: "https://en.wikipedia.org/wiki/11_Bit_Studios",
    confidence: "high",
    asOf: "2026-07",
  },
};

/** Solo-reachable = a 1–2 (solo) or 3–10 (small) person team could realistically have shipped it. */
export function isSoloReachable(bucket: TeamSizeBucket): boolean {
  return bucket === "solo" || bucket === "small";
}

/** Curated team-size estimate for a developer, or null when the studio isn't researched yet. */
export function teamSizeFor(developer: string | null | undefined): TeamSizeEstimate | null {
  const key = normalizeDev(developer);
  return key ? (ESTIMATES[key] ?? null) : null;
}
