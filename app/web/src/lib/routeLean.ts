// Route Lens (C2) — the route compass the strategy runs on, read off a pitch's two co-equal
// platform-fit scores. This is the realized, pitch-level form of the evaluation's "route
// lean": the market-level cross-platform view it also sketched needs the loop-family map
// (backlog) to join browser and Steam on a shared vocabulary — genre alone is too thin.
//
// Browser-heavy → portal-ad / catalogue revenue (Routes 2/3 — validate-then-Steam or the
// AI pipeline). Steam-heavy → premium demo-funnel / wishlist play (Route 1 — the Solar Forge
// shape). Both strong → keep the Phase-0 doors open (optionality). A null score means that
// platform doesn't apply, which is itself a firm lean. Null only when neither axis is scored.

export type RouteLean = { label: string; cls: string; tip: string } | null;

const R23: RouteLean = {
  label: "leans Routes 2/3",
  cls: "route-23",
  tip: "Browser-heavy — fits portal-ad / catalogue revenue (validate-then-Steam or AI-pipeline routes).",
};
const R1: RouteLean = {
  label: "leans Route 1",
  cls: "route-1",
  tip: "Steam-heavy — fits the premium demo-funnel / wishlist play (Solar Forge shape).",
};

export function routeLean(browserFit: number | null, steamFit: number | null): RouteLean {
  const b = browserFit, s = steamFit;
  if (b == null && s == null) return null;
  if (s == null) return R23; // browser-only ladder
  if (b == null) return R1;  // steam-only ladder
  if (b > s) return R23;
  if (s > b) return R1;
  return {
    label: b >= 2 ? "optionality" : "unclear lean",
    cls: "route-both",
    tip: b >= 2
      ? "Both platform fits are strong — keep the Phase-0 routes open; the toy test decides."
      : "Neither platform fit is strong yet — the route isn't legible from the scores.",
  };
}
