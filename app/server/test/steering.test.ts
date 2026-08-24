// Steering as a scoring term (#12b). The load-bearing property is the NEGATIVE one: with no
// standing flags set the ranking is identical to the market-data one — scores, order, keys.
import { describe, expect, it } from "vitest";
import type { SteamGap } from "shared";
import { matchSteering, steerRow, steeringLens, STEERING_WEIGHT } from "../src/queries/shared.ts";
import { freshMemoryDb } from "../src/db/db.ts";
import { loadGames } from "../src/crawler/load.ts";
import { STEAM_BASE_URL } from "../src/crawler/steam.ts";
import type { RawGame } from "../src/crawler/base.ts";
import * as q from "../src/queries/index.ts";

const gap = (genre: string, tag: string, score: number): SteamGap => ({
  label: `${genre} × ${tag}`,
  genre,
  tag,
  supplyN: 4,
  medianOwners: 20000,
  qualityCeil: 4.2,
  medianPriceCents: 999,
  score,
  components: { demand: score, quality: 0, supply: 0 },
  examples: [],
  supplyRising: false,
});

// The production chain: steer every row, then sort — exactly what getSteamOpportunity does.
const rank = (flags: string[]) =>
  [gap("Puzzle", "Cozy", 1.5), gap("Action", "Survivor-Like", 1.2)]
    .map((g) => steerRow(g, flags))
    .sort((a, b) => b.score - a.score);

describe("matchSteering", () => {
  it("matches on the market's own labels, whole-word", () => {
    expect(matchSteering(["cozy games"], { genre: "Puzzle", tag: "Cozy" })).toEqual(["cozy games"]);
    // "cozy" must not be found inside an unrelated longer word.
    expect(matchSteering(["cozy"], { genre: "Action", tag: "Cozywumpus" })).toEqual([]);
    // …and "survivors" reaches the same loop family without naming the tag.
    expect(matchSteering(["survivors"], { genre: "Action", tag: "Survivor-Like" })).toEqual([
      "survivors",
    ]);
  });

  // #157: the live standing flags write compound genres OPEN ("deck builder", "Rogue-lites");
  // Steam writes them CLOSED ("Deckbuilding", "Roguelike"), so a whole-word test could never
  // reach them and all ten flags read `unmatched` against real data. These three pairs were
  // measured live on 2026-08-14 and are the contract for the collapsed-form vocabulary.
  it("reaches a market that writes the same genre as one closed word", () => {
    // The genre deliberately maps to a DIFFERENT loop family (Puzzle → route-planning) so the
    // family route cannot rescue this — it is the vocabulary being tested, nothing else.
    expect(
      matchSteering(["Luck/deck builder synergy games"], { genre: "Puzzle", tag: "Deckbuilding" }),
    ).toEqual(["Luck/deck builder synergy games"]);
    expect(
      matchSteering(["Fairy tale setting"], { genre: "Adventure", tag: "Fairy Tale" }),
    ).toEqual(["Fairy tale setting"]);
  });

  it("folds the lite↔like variant Steam and the flags spell differently", () => {
    // `?tag=Roguelite` has zero rows while `Roguelike` has 16 — separator-stripping alone would
    // leave the single highest-supply matching market unmatched.
    for (const tag of ["Roguelike", "Roguelite", "Rogue-lite"])
      expect(matchSteering(["Rogue-lites"], { genre: "Action", tag })).toEqual(["Rogue-lites"]);
  });

  it("makes no claim on a flag that fits nothing", () => {
    const m = { genre: "Puzzle", tag: "Cozy" };
    expect(matchSteering(["submarine documentaries"], m)).toEqual([]);
    expect(matchSteering(["", "   "], m)).toEqual([]);
    // The widening is whole-token, never a substring: "card" is not "Cardboard", and a bare
    // "deck" is not a deckbuilder. A collapsed `includes` would force-fit both.
    expect(
      matchSteering(["playing card mechanics"], { genre: "Casual", tag: "Cardboard" }),
    ).toEqual([]);
    expect(matchSteering(["deck"], { genre: "Puzzle", tag: "Deckbuilding" })).toEqual([]);
    // A genre tail is a suffix, not an interest — "-lite" must not claim every "-like" market.
    expect(matchSteering(["Rogue-lites"], { genre: "Action", tag: "Survivor-Like" })).toEqual([]);
  });
});

describe("steerRow", () => {
  it("no flags set → the ranking is untouched (scores, components, order, keys)", () => {
    const unsteered = rank([]);
    for (const flags of [[], ["", "  "]]) {
      const after = rank(flags);
      expect(after).toEqual(unsteered);
      expect(after.some((r) => r.steering)).toBe(false);
      expect(after.some((r) => r.components.steering !== undefined)).toBe(false);
    }
    expect(unsteered.map((r) => r.label)).toEqual(["Puzzle × Cozy", "Action × Survivor-Like"]);
  });

  it("lifts and re-sorts a matched market, and records which flag did it", () => {
    const out = rank(["survivors"]);
    expect(out[0].label).toBe("Action × Survivor-Like"); // 1.2 + lift overtook the 1.5 leader
    expect(out[0].score).toBeCloseTo(1.2 + STEERING_WEIGHT, 5);
    expect(out[0].steering).toEqual({ flags: ["survivors"], delta: STEERING_WEIGHT });
    expect(out[0].components.steering).toBe(STEERING_WEIGHT);
    // The unmatched market keeps its exact market-data score — steering never demotes.
    expect(out[1].score).toBe(1.5);
    expect(out[1].steering).toBeUndefined();
  });

  it("stacks per matching flag, and a flag matching nothing changes nothing", () => {
    const g = steerRow(gap("Puzzle", "Cozy", 0), ["cozy", "puzzle"]);
    expect(g.steering?.flags).toEqual(["cozy", "puzzle"]);
    expect(g.score).toBeCloseTo(2 * STEERING_WEIGHT, 5);
    expect(rank(["submarine documentaries"])).toEqual(rank([]));
  });
});

describe("steeringLens", () => {
  it("is undefined when nothing is steering", () => {
    expect(steeringLens([], rank([]))).toBeUndefined();
  });

  it("reports applied vs matched-nothing honestly", () => {
    const flags = ["survivors", "submarine documentaries"];
    expect(steeringLens(flags, rank(flags))).toEqual({
      flags,
      applied: ["survivors"],
      unmatched: ["submarine documentaries"],
      steered: 1,
      steeredShown: 1,
      unlisted: [],
      weight: STEERING_WEIGHT,
    });
  });
});

// #167 — the lens is read over the FULL ranked set, not the slice the screen shows. The bug this
// pins: a market matched a flag, took its lift, and because it still sat below the cut the lens
// said the flag matched NOTHING. "Your lane is empty" and "your lane is here, a few ranks short"
// are opposite calls, so the difference has to survive into the payload.
describe("steeringLens over a cut ranking (#167)", () => {
  const FLAGS = ["Luck/deck builder synergy games", "submarine documentaries"];
  // Twelve markets. Only the weakest carries the vocabulary, so even lifted it cannot reach a cut.
  const deep = (flags: string[]) =>
    [
      ...Array.from({ length: 11 }, (_, i) => gap("Casual", `Filler ${i}`, 9 - i * 0.1)),
      gap("Puzzle", "Deckbuilding", 0.1),
    ]
      .map((g) => steerRow(g, flags))
      .sort((a, b) => b.score - a.score);

  it("counts a matched market that never reached the cut as applied, and names its rank", () => {
    const lens = steeringLens(FLAGS, deep(FLAGS), 2)!;
    // The regression: this used to read applied: [], steered: 0, both flags unmatched.
    expect(lens.applied).toEqual(["Luck/deck builder synergy games"]);
    expect(lens.unmatched).toEqual(["submarine documentaries"]);
    expect(lens.steered).toBe(1);
    expect(lens.steeredShown).toBe(0); // …while staying honest that nothing on screen moved
    expect(lens.unlisted).toEqual([
      {
        label: "Puzzle × Deckbuilding",
        genre: "Puzzle",
        tag: "Deckbuilding",
        rank: 12,
        delta: STEERING_WEIGHT,
        flags: ["Luck/deck builder synergy games"],
      },
    ]);
    expect(deep(FLAGS).slice(0, 2)).toEqual(deep([]).slice(0, 2)); // the cut is read, not re-ordered
  });

  it("a flag that matches nothing anywhere is still unmatched, cut or no cut", () => {
    const flags = ["submarine documentaries"];
    expect(steeringLens(flags, deep(flags), 2)).toMatchObject({
      applied: [],
      unmatched: flags,
      steered: 0,
      steeredShown: 0,
      unlisted: [],
    });
  });
});

// …and the same property through the real wiring, since the defect was in what getSteamOverview
// HANDED the lens, not in the lens itself.
describe("GET /api/steam steering lens is wired to the full ranking (#167)", () => {
  const g = (id: string, genre: string, tag: string, owners: number, rating: number): RawGame => ({
    url: `https://store.steampowered.com/app/${id}`,
    title: `Game ${id}`,
    thumbnailUrl: null,
    developer: "Dev",
    description: null,
    engine: null,
    orientation: null,
    mobile: false,
    genre,
    tags: [tag],
    rating,
    votes: 5000,
    featured: false,
    releaseDate: "2024-01-01",
    plays: owners,
    ownersEst: owners,
    priceCents: 1500,
    discountPct: 0,
    ccu: 100,
    medianPlaytimeMin: 600,
    metacritic: null,
    scaleTier: "small_indie",
    sourceGameId: id,
  });

  it("reports a matched-but-unlisted market instead of calling the flag unmatched", async () => {
    const db = await freshMemoryDb();
    const games: RawGame[] = [];
    for (let i = 0; i < 9; i++)
      for (const n of [1, 2])
        games.push(g(`f${i}-${n}`, "Casual", `Filler ${i}`, 400_000 - i * 20_000, 4.6));
    // The deck market is the weakest of the ten — even lifted it cannot climb into the top 8.
    for (const n of [1, 2]) games.push(g(`d${n}`, "Puzzle", "Deckbuilding", 1_000, 2.0));
    await loadGames(db, "steam", STEAM_BASE_URL, games, "2026-06-30T00:00:00.000Z");
    await q.setBriefSteering(db, ["Luck/deck builder synergy games"]);

    const ov = await q.getSteamOverview(db);
    expect(ov.opportunity.length).toBe(8);
    expect(ov.opportunity.some((o) => o.label === "Puzzle × Deckbuilding")).toBe(false);
    expect(ov.steering!.steeredShown).toBe(0);
    expect(ov.steering!.applied).toEqual(["Luck/deck builder synergy games"]);
    expect(ov.steering!.steered).toBe(1);
    expect(ov.steering!.unlisted![0]).toMatchObject({ label: "Puzzle × Deckbuilding", rank: 10 });
  });
});
