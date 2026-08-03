import type { BriefFamilyRow } from "shared";

// Display helpers for the loop-family demand tracker (#12a); the rollup itself is server-side
// (it needs the curated map). Out of the component so it is testable like its sibling libs.

/** Compact count — 380000 → "380K", short enough for a 375px column. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return String(Math.round(n));
}

const ARROW = { up: "↑", down: "↓", flat: "→" } as const;
/** "6 signals ↑ · 380K wishlists (2/6)" — the issue's one-line read of a family. Parts the data
 *  can't support (no additive figure, no previous edition to compare) are left out entirely. */
export function rowSummary(r: BriefFamilyRow): string {
  const m = r.magnitude;
  const unit = !m ? "" : m.value === 1 ? m.unit : m.unit === "copy" ? "copies" : `${m.unit}s`;
  return [
    `${r.signals} signal${r.signals === 1 ? "" : "s"}${r.direction ? ` ${ARROW[r.direction]}` : ""}`,
    m && `${compact(m.value)} ${unit} (${m.sampled}/${r.signals})`,
  ]
    .filter(Boolean)
    .join(" · ");
}
