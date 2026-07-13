import type { Pitch } from "shared";

// Loop-family coverage (in-rails slice of #71 / #12). The weekly routine hand-aggregates
// the News Brief's loop-family signal every run to decide which candidate loops to pitch;
// this turns the SUPPLY half of that read — how many pitches the Library has already bet on
// per loop family, and (crucially) which families have ZERO coverage — into a first-class,
// glance-able view. Derived client-side from the pitches array already loaded by the Library
// service, exactly like the sibling `rankPitches` leaderboard.
//
// The demand half (per-family brief signals / wishlist·CCU numbers / trend) is deliberately
// NOT here: brief items don't yet carry a loopFamily field, and lifting the family from brief
// prose happens at build time in the (separate) indie-brief tool. That's the design-heavy
// residual tracked on the parent #12 — this ships the coverage backbone it plugs into.

export interface FamilyCoverage {
  family: string;
  total: number; // pitches tagged to this family
  active: number; // non-shelved pitches (the live bets)
  byStatus: Record<string, number>; // status -> count (proposed | prototyping | shipped | shelved | …)
  titles: string[]; // up to 3 example titles, live ones first
}

/**
 * Roll pitches up by loop family. `families` is the full family universe (the contract
 * loopFamilies enum) so families with no pitches still appear as a row — a zero-coverage
 * family is the signal, not an omission. Rows sort by live coverage (active) desc, then total.
 */
export function loopFamilyCoverage(pitches: Pitch[], families: string[]): FamilyCoverage[] {
  const mk = (family: string): FamilyCoverage => ({ family, total: 0, active: 0, byStatus: {}, titles: [] });
  const base = new Map<string, FamilyCoverage>();
  for (const f of families) base.set(f, mk(f)); // seed every known family (incl. zero-coverage)

  for (const p of pitches) {
    const f = p.loopFamily;
    if (!f) continue; // untagged pitch contributes to no family
    const row = base.get(f) ?? mk(f); // a pitch on a family outside the enum still counts
    row.total++;
    const st = p.status || "proposed";
    row.byStatus[st] = (row.byStatus[st] || 0) + 1;
    if (st !== "shelved") row.active++;
    base.set(f, row);
  }

  // Example titles: live (non-shelved) pitches first, then shelved to fill, capped at 3.
  const addTitle = (wantShelved: boolean) => {
    for (const p of pitches) {
      if (!p.loopFamily) continue;
      const row = base.get(p.loopFamily);
      if (!row || row.titles.length >= 3) continue;
      const shelved = (p.status || "") === "shelved";
      if (shelved === wantShelved && !row.titles.includes(p.title)) row.titles.push(p.title);
    }
  };
  addTitle(false);
  addTitle(true);

  return [...base.values()].sort(
    (a, b) => b.active - a.active || b.total - a.total || a.family.localeCompare(b.family)
  );
}
