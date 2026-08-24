import { describe, it, expect, vi } from "vitest";
import type { BriefPayload } from "shared";
import {
  buildDemandTracker,
  familyOfItem,
  fetchSteamTaxonomy,
  parseFigure,
  type SteamTaxonomy,
} from "../src/queries/briefFamily.ts";
import { freshMemoryDb } from "../src/db/db.ts";

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

// ── #163 appid tier ───────────────────────────────────────────────────────────────────────────
// Prose has a ceiling: a patch note never names its genre. The third tier looks the item's
// steam_appid up in the crawl KAIROS already owns (genre + tags) instead of matching more string.
const tax = (m: Record<string, SteamTaxonomy>) => new Map(Object.entries(m));
const STS2 = {
  name: "Slay the Spire 2",
  category: "Market signal",
  blurb: "Beta patch v0.110.0 reverts the earlier Silent/Poison rework and polishes card VFX.",
  steam_appid: "2868840",
};
const CRAWLED = tax({
  // The real shape: the broad genre "Strategy" curates to nothing; the Deckbuilding TAG places it.
  "2868840": { genre: "Strategy", tags: ["Deckbuilding", "Roguelike"] }, // → synergy-builder
  "3971650": { genre: "Simulation", tags: ["Automation"] }, // curated genre × tag pair
  "111": { genre: "Simulation", tags: ["Automation", "Sandbox"] }, // two families → ambiguous
  "222": { genre: "Adventure", tags: ["Story Rich"] }, // neither genre nor tags are curated
  "333": { genre: "Idle", tags: [] }, // genre-level entry, no tags at all
});
const at = (steam_appid: string | null) => familyOfItem({ name: "x", steam_appid }, CRAWLED);

describe("#163 steam_appid ⇒ crawled genre/tag tier", () => {
  it("places a patch note whose prose never names a genre", () => {
    expect(familyOfItem(STS2)).toBeNull(); // the bug: no vocabulary can ever place this
    expect(familyOfItem(STS2, CRAWLED)).toBe("synergy-builder");
    expect(at("3971650")).toBe("automation-under-pressure"); // curated genre × tag
    expect(at("333")).toBe("idle-tycoon"); // genre-level entry, no tags needed
  });

  it("claims nothing when the appid cannot answer", () => {
    expect(at("4040404")).toBeNull(); // carried an appid, not in the crawl set
    expect(at("222")).toBeNull(); // crawled, but neither the genre nor the tags are curated
    expect(at("111")).toBeNull(); // tags imply two families → ambiguous, never a coin-flip
    expect(at(null)).toBeNull();
    expect(at("not-an-appid")).toBeNull();
    expect(familyOfItem(STS2, undefined)).toBeNull(); // no taxonomy loaded → previous behaviour
  });

  it("runs last: labels and prose keep precedence", () => {
    const over = (o: Record<string, string>) =>
      familyOfItem({ name: "x", steam_appid: "2868840", ...o }, CRAWLED);
    expect(over({ category: "Automation" })).toBe("automation-under-pressure"); // label wins
    expect(over({ blurb: "a cozy farming sim" })).toBe("cozy-craft"); // prose wins
  });

  // "factory builder" — how the market names this loop when it never says "automation".
  it("reads the factory/production vocabulary", () => {
    const f = (blurb: string) => familyOfItem({ name: "x", category: "Loop reference", blurb });
    expect(f("Lazy Witch's Factory is a cute factory builder")).toBe("automation-under-pressure");
    expect(f("balance production lines under pressure")).toBe("automation-under-pressure");
    expect(f("a production chain puzzle game")).toBeNull(); // two families disagree → still null
  });

  it("folds the tier into the rollup and logs its coverage", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const withAppids: BriefPayload = {
      new_notable: [STS2, { name: "Lazy Witch's Factory", steam_appid: "3971650" }],
      browser: [{ name: "Click Bait", blurb: "rhythm roguelite", steam_appid: "4040404" }],
    };
    // Without the taxonomy only the new `factory` key lands (on the item's NAME); Slay the Spire 2
    // stays unplaced — no vocabulary can read a genre the prose never states.
    expect([buildDemandTracker(withAppids).total, buildDemandTracker(withAppids).tagged]).toEqual([
      3, 1,
    ]);
    const t = buildDemandTracker(withAppids, null, CRAWLED);
    expect([t.total, t.tagged]).toEqual([3, 2]);
    // "rhythm roguelite" has no family in the contract — unclassified is the correct answer.
    expect(t.rows.map((r) => r.family)).toEqual([
      "automation-under-pressure",
      "synergy-builder",
      null,
    ]);
    // Coverage is measured every run, not assumed: the tier only pays where the crawl reaches.
    expect(log.mock.calls[0][0]).toContain("3/3 items carried a steam_appid, 2 matched");
    log.mockRestore();
  });

  it("fetches every appid in one query, canonicalised like the market read", async () => {
    const db = await freshMemoryDb();
    await db.query("INSERT INTO sources(name, base_url) VALUES ('steam','x'),('poki','y')");
    await db.query(
      `INSERT INTO games(source_id, source_game_id, url, title)
       SELECT s.id, v.sid, 'u', v.sid FROM sources s
       JOIN (VALUES ('steam','2868840'),('steam','3971650'),('poki','555')) AS v(src, sid)
         ON v.src = s.name`,
    );
    await db.query(
      "INSERT INTO game_snapshots(game_id, genre) SELECT id, 'Action Games' FROM games WHERE source_game_id = '2868840'",
    );
    await db.query("INSERT INTO tags(name) VALUES ('Deckbuilding'),('roguelike')");
    await db.query(
      "INSERT INTO game_tags(game_id, tag_id) SELECT g.id, t.id FROM games g, tags t WHERE g.source_game_id = '2868840'",
    );
    const spy = vi.spyOn(db, "query");
    const m = await fetchSteamTaxonomy(db, [
      { new_notable: [STS2, { name: "y", steam_appid: "nope" }] },
      {
        browser: [
          { name: "Witch", steam_appid: "3971650" },
          { name: "p", steam_appid: "555" },
        ],
      },
    ]);
    expect(spy).toHaveBeenCalledTimes(1); // batched — never one round trip per item
    // "Action Games" and "Action" are the same market here as in getLoopFamilyMarket.
    expect(m.get("2868840")).toEqual({ genre: "Action", tags: ["Deckbuilding", "roguelike"] });
    expect(m.get("3971650")).toEqual({ genre: null, tags: [] }); // crawled, nothing to say yet
    expect(familyOfItem(STS2, m)).toBe("synergy-builder");
    expect(m.size).toBe(2); // a browser game's id is not a Steam appid; "nope" never reached SQL
    // An edition with no appids at all costs no round trip (the call count is unchanged).
    expect((await fetchSteamTaxonomy(db, [ed, prev, null, undefined])).size).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  }, 60000);
});
