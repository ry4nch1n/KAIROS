import { describe, it, expect } from "vitest";
import type { BriefPayload } from "shared";
import { buildDemandTracker, familyOfItem, parseFigure } from "../src/queries/briefFamily.ts";

// Fixture: the shape the real indie-brief tool publishes (labels + free-text figures), trimmed to
// the fields the rollup reads — mirrors the seeded editions in server/src/db/seed.ts.
const item = (name: string, category: string, figure?: string) => ({ name, category, figure });
const ed: BriefPayload = {
  new_notable: [
    item("Vampire Survivors-like (1-dev)", "Loop reference", "4.6★ CrazyGames"),
    item("Cozy Merge Factory", "Automation/logistics", "12k wishlists"),
    item("Conveyor Town", "Automation", "8,000 wishlists"),
    item("Tiny Glade-like builder", "Cozy/management"), // unmapped → unclassified
  ],
  browser: [{ name: "Smash Karts", kind: "Browser game", figure: "50M plays" }],
};
const prev: BriefPayload = { new_notable: [item("Old Automation Co", "Automation")] };

describe("#12a brief loop-family tagging + rollup", () => {
  it("tags from an item's labels and never force-fits", () => {
    expect(familyOfItem(ed.new_notable![0])).toBe("minimal-input-survivors");
    expect(familyOfItem(ed.new_notable![1])).toBe("automation-under-pressure");
    expect(familyOfItem(ed.new_notable![3])).toBeNull(); // unmapped labels, no prose → no claim
    expect(familyOfItem({ name: "Idle automation hybrid" })).toBeNull(); // two families → null
  });

  // Labels alone placed 0 of 12 signals on the real 2026-08-04 edition: this payload's
  // `category`/`kind` carry an EDITORIAL ROLE ("Loop reference", "Browser platform"), never a
  // genre, so the genre only ever appears in the blurb. Prose is now a second, lower-confidence
  // tier — consulted when labels are silent, never over them.
  it("falls back to prose when labels carry no genre", () => {
    // The real Talespinner/Blackout Jack/TEKO shape: role label + genre in the blurb.
    expect(
      familyOfItem({
        name: "Talespinner",
        category: "Loop reference",
        blurb: "Deck-building roguelite where you play the storyteller",
      }),
    ).toBe("synergy-builder");
    // Labels win when they DO carry a genre, even if the blurb suggests another.
    expect(
      familyOfItem({ name: "Conveyor Town", category: "Automation", blurb: "a cozy idle clicker" }),
    ).toBe("automation-under-pressure");
  });

  // `words()` collapses punctuation to spaces, so a hyphenated "Deck-building" arrives as two
  // tokens and could never match the single-token key "deckbuilding". Every surface form the
  // real editions used must resolve to the same family.
  it("matches the surface forms real prose actually uses", () => {
    const f = (blurb: string) => familyOfItem({ name: "x", category: "Loop reference", blurb });
    expect(f("roguelike deckbuilder shipped a 2.0 update")).toBe("synergy-builder");
    expect(f("Deck-building roguelite")).toBe("synergy-builder");
    expect(f("a 500-card synergy engine, combo-driven runs")).toBe("synergy-builder");
    // The contract defines this family as the "spin/deck … Balatro" lineage — so slots count.
    expect(f("Balatro-style slot-machine roguelite crossed 1M sales")).toBe("synergy-builder");
    expect(f("Browser-native tower defence: survive escalating waves")).toBe("wave-defense-prep");
  });

  // A portal-level note is not a title, so its prose must not be mined for a genre — otherwise
  // "the top-ten list is puzzle, word, card titles" reads as a puzzle game.
  it("never infers a family from a platform note's prose", () => {
    expect(
      familyOfItem({
        name: 'CrazyGames "Hot" chart composition',
        kind: "Browser platform",
        blurb: "The current top-ten popular list is puzzle, word, card and .io titles",
      }),
    ).toBeNull();
    // …but a game merely labelled with a genre-bearing role still classifies.
    expect(
      familyOfItem({ name: "CloverPit", kind: "Loop signal", blurb: "slot-machine roguelite" }),
    ).toBe("synergy-builder");
  });

  it("parses additive counts only", () => {
    expect(parseFigure("12k wishlists")).toEqual({ value: 12_000, unit: "wishlist" });
    expect(parseFigure("50M plays")).toEqual({ value: 50_000_000, unit: "play" });
    expect(parseFigure("8,000 wishlists")).toEqual({ value: 8_000, unit: "wishlist" });
    for (const f of ["4.6★ CrazyGames", "70%", "-21%", "a strong week", null])
      expect(parseFigure(f)).toBeNull();
  });

  it("rolls up per family — unclassified counted honestly and sorted last", () => {
    const t = buildDemandTracker(ed);
    expect([t.total, t.tagged]).toEqual([5, 3]); // Tiny Glade + Smash Karts stay unplaced
    expect(t.rows[t.rows.length - 1].family).toBeNull();
    const auto = t.rows.find((r) => r.family === "automation-under-pressure")!;
    expect(auto.signals).toBe(2);
    expect(auto.magnitude).toEqual({ value: 20_000, unit: "wishlist", sampled: 2 });
    expect(auto.titles).toEqual(["Cozy Merge Factory", "Conveyor Town"]);
    // A rating is not additive → no magnitude at all rather than a placeholder.
    expect(t.rows.find((r) => r.family === "minimal-input-survivors")!.magnitude).toBeUndefined();
  });

  it("omits direction with no previous edition, computes it when there is one", () => {
    const first = buildDemandTracker(ed);
    expect(first.comparedTo).toBeUndefined();
    expect(first.rows.every((r) => r.direction === undefined)).toBe(true);
    const t = buildDemandTracker(ed, { payload: prev, editionDate: "2026-06-23" });
    expect([
      t.comparedTo,
      t.rows.find((r) => r.family === "automation-under-pressure")!.direction,
    ]).toEqual(["2026-06-23", "up"]); // 1 → 2 signals
    expect(buildDemandTracker(prev, { payload: prev, editionDate: "x" }).rows[0].direction).toBe(
      "flat",
    );
  });

  it("survives an empty or missing brief", () => {
    for (const p of [undefined, null, {}, { new_notable: [], browser: [] }])
      expect(buildDemandTracker(p as BriefPayload | null).rows).toEqual([]);
  });
});
