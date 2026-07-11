// Curated wishlist→sale conversion signal per genre (evaluation R4.1 / Factor 4).
// Steam's audience wants some genres more than others, so two genres with equal revenue
// can convert wishlists at very different rates — the factor solo devs most often skip.
// Like team sizes, these are RESEARCHED, directional signals, not a per-genre table Steam
// publishes: each carries a citation + as-of date, and a genre absent from the map makes
// NO claim (no chip), same discipline as teamSize.ts.
//
// Baseline (GameDiscoverCo 2024): median wishlist→sale ≈ 0.17× for >10k-wishlist launches,
// with a 10–20× spread across titles; titles over ~$10 run lower (~0.10×). Genre is a
// weaker, adjacent signal — crafty-buildy-strategy-sim, horror, and idle/incremental
// convert well because the Steam audience actively seeks them out.

export type ConversionSignal = "strong" | "typical" | "deliberation";
export interface ConversionRef {
  signal: ConversionSignal;
  note: string;   // one line, plain language
  source: string; // citation URL
  asOf: string;   // YYYY-MM
}

const GDC = "https://newsletter.gamediscover.co/p/the-state-of-steam-wishlist-conversions";

// Keyed by canonical (B1) genre, lowercased. Only genres with a clear directional signal
// appear; everything else returns null and shows no chip.
const REF: Record<string, ConversionRef> = {
  simulation: { signal: "strong", note: "Crafty-buildy sims convert well — Steam's audience actively seeks them.", source: GDC, asOf: "2026-07" },
  strategy:   { signal: "strong", note: "Strategy over-indexes on wishlist→sale conversion.", source: GDC, asOf: "2026-07" },
  horror:     { signal: "strong", note: "Horror converts strongly — a highly wishlist-driven genre.", source: GDC, asOf: "2026-07" },
  idle:       { signal: "strong", note: "Idle / incremental convert well; the audience buys the fantasy it wishlisted.", source: GDC, asOf: "2026-07" },
  rpg:        { signal: "deliberation", note: "Higher-priced, narrative-heavy RPGs run a lower median — more deliberation before buying.", source: GDC, asOf: "2026-07" },
  adventure:  { signal: "deliberation", note: "Story/adventure titles skew toward deliberation; conversion is price-sensitive.", source: GDC, asOf: "2026-07" },
};

/** Conversion reference for a (canonical) genre, or null when there's no clear signal. */
export function conversionFor(genre: string | null | undefined): ConversionRef | null {
  const key = String(genre ?? "").toLowerCase().trim();
  return key ? REF[key] ?? null : null;
}

export const CONVERSION_BASELINE =
  "Median wishlist→sale ≈ 0.17× for >10k-wishlist launches; titles over ~$10 run lower (~0.10×). A 10–20× spread across games — directional, not a forecast. GameDiscoverCo 2024.";
