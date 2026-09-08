// Steering as a scoring term (#12b). The load-bearing property is the NEGATIVE one: with no
// standing flags set the ranking is identical to the market-data one — scores, order, keys.
import { describe, expect, it } from "vitest";
import type { SteamGap } from "shared";
import {
  matchSteering,
  steerRanking,
  steerRow,
  steeringLens,
  steeringScale,
  STEERING_WEIGHT,
} from "../src/queries/shared.ts";
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

// #173: the stemmer collapsed a QUALIFIER to a generic root — `builder` → `build`, `players` →
// `play` — and both roots are everyday Steam tag vocabulary, so a deck-builder flag claimed every
// Base-Building market and a flag about players claimed 4 Player Local. These three markets were
// measured on the #172 draft, where they inflated `applied` and filled `unlisted` with noise.
describe("a stemmed root does not claim a generic market (#173)", () => {
  const FLAGS = [
    "Luck/deck builder synergy games",
    "Blackjack or playing card mechanics",
    "Living playing card/toy soldiers setting",
    "Players acceptance on AI use in video games",
  ];

  it("refuses the markets the collapse invented", () => {
    for (const m of [
      { genre: "Adventure", tag: "Base-Building" }, // builder → build → Building
      { genre: "Action", tag: "4 Player Local" }, // players/playing → play → Player
      { genre: "Casual", tag: "Free to Play" }, // …and → Play
    ])
      expect(matchSteering(FLAGS, m)).toEqual([]);
  });

  it("still reaches the closed compounds #157 shipped it for", () => {
    // The qualifier survives the join, so the compound route is untouched — only the bare root
    // it used to also emit is gone.
    expect(matchSteering(FLAGS, { genre: "Puzzle", tag: "Deckbuilding" })).toEqual([FLAGS[0]]);
    expect(matchSteering(["Rogue-lites"], { genre: "Action", tag: "Roguelike" })).toEqual([
      "Rogue-lites",
    ]);
    expect(
      matchSteering(["Fairy tale setting"], { genre: "Adventure", tag: "Fairy Tale" }),
    ).toEqual(["Fairy tale setting"]);
  });

  it("leaves the #172 lens aggregation exactly as it was", () => {
    // Fewer markets carry a match now; how the lens counts and names them must not change.
    const ranked = [gap("Adventure", "Base-Building", 2), gap("Puzzle", "Deckbuilding", 1)].map(
      (g) => steerRow(g, [FLAGS[0]]),
    );
    expect(ranked[0].steering).toBeUndefined();
    const lens = steeringLens([FLAGS[0]], ranked, 1)!;
    expect(lens).toMatchObject({ applied: [FLAGS[0]], steered: 1, steeredShown: 0 });
    expect(lens.unlisted).toEqual([
      {
        label: "Puzzle × Deckbuilding",
        genre: "Puzzle",
        tag: "Deckbuilding",
        rank: 2,
        delta: STEERING_WEIGHT,
        flags: [FLAGS[0]],
      },
    ]);
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
      // Two rows, no cut passed → the whole ranking IS the visible band, 1.5 to 1.2 (#200).
      weight: 0.15,
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
    // Three games per cell, not two: below the shared market-supply floor a genre × tag cell is
    // not a market and never enters the ranking at all (#211).
    for (let i = 0; i < 9; i++)
      for (const n of [1, 2, 3])
        games.push(g(`f${i}-${n}`, "Casual", `Filler ${i}`, 400_000 - i * 20_000, 4.6));
    // The deck market is the weakest of the ten — even lifted it cannot climb into the top 8.
    for (const n of [1, 2, 3]) games.push(g(`d${n}`, "Puzzle", "Deckbuilding", 1_000, 2.0));
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

// #142 — the same standing flags now reshape the BROWSER read too. Until this landed, one setting
// produced two verdicts: Steam's ranking moved, `Overview.gaps` merely carried a caption. The
// tests below are the browser mirror of the Steam ones above, and the FIRST is the load-bearing
// one: steering that is switched off must leave the ranking exactly as the market data computed it.
describe("browser market gaps are steered by the standing flags (#142)", () => {
  const CG = "https://www.crazygames.com";
  const bg = (id: string, genre: string, tag: string, votes: number, rating: number): RawGame => ({
    url: `${CG}/game/${id}`,
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
    votes,
    featured: false,
    releaseDate: null,
    plays: votes * 10,
    ownersEst: null,
    priceCents: null,
    discountPct: null,
    ccu: null,
    medianPlaytimeMin: null,
    metacritic: null,
    scaleTier: null,
    sourceGameId: id,
  });

  // Ten markets. Only the weakest carries the flag's vocabulary, so even lifted it cannot climb
  // into the top 6 — the shape that made the Steam lens lie before #167.
  const seed = async () => {
    const db = await freshMemoryDb();
    const games: RawGame[] = [];
    for (let i = 0; i < 9; i++)
      for (const n of [1, 2])
        games.push(bg(`f${i}-${n}`, "Casual", `Filler ${i}`, 9000 - i * 500, 4.6));
    // Weak enough to sit last on the market data, close enough that a lift can still reach it —
    // the score band admits a comparable market, not a hopeless one (#200).
    for (const n of [1, 2]) games.push(bg(`d${n}`, "Puzzle", "Deckbuilding", 4500, 4.6));
    await loadGames(db, "crazygames", CG, games, "2026-06-30T00:00:00.000Z");
    return db;
  };

  it("no flags set → the ranking is identical to the unsteered one", async () => {
    const db = await seed();
    const before = await q.getMarketGaps(db, "crazygames");
    await q.setBriefSteering(db, []); // explicitly "nothing is steering", not merely never set
    const after = await q.getMarketGaps(db, "crazygames");
    expect(JSON.stringify(after)).toBe(JSON.stringify(before)); // scores, order, keys — byte-identical
    expect(after.some((g) => g.steering)).toBe(false);
    expect(after.some((g) => g.components.steering !== undefined)).toBe(false);
    expect((await q.getOverview(db, "crazygames")).steering).toBeUndefined();
  });

  it("a matching flag promotes the gap it matches, and records which flag did it", async () => {
    const db = await seed();
    const unsteered = await q.rankMarketGaps(db, "crazygames");
    const deckBefore = unsteered.findIndex((g) => g.label === "Puzzle × Deckbuilding");
    await q.setBriefSteering(db, ["Luck/deck builder synergy games"]);
    const steered = await q.rankMarketGaps(db, "crazygames");
    const deck = steered.find((g) => g.label === "Puzzle × Deckbuilding")!;
    // The lift is this ranking’s own, not a constant (#200) — read it back off the unsteered set.
    const { weight } = steeringScale(
      unsteered.map((g) => g.score),
      6,
    );
    expect(deck.steering).toEqual({ flags: ["Luck/deck builder synergy games"], delta: weight });
    expect(deck.score).toBeCloseTo(unsteered[deckBefore].score + weight, 5);
    // …and nothing the flag did not match moved: steering promotes, it never demotes.
    for (const g of steered.filter((x) => !x.steering))
      expect(g.score).toBe(unsteered.find((u) => u.label === g.label)!.score);
  });

  it("counts moves over the cut list, not the full ranking", async () => {
    const db = await seed();
    await q.setBriefSteering(db, ["Luck/deck builder synergy games", "submarine documentaries"]);
    const ov = await q.getOverview(db, "crazygames");
    expect(ov.gaps.length).toBe(6);
    expect(ov.gaps.some((g) => g.label === "Puzzle × Deckbuilding")).toBe(false);
    const lens = ov.steering!;
    expect(lens.applied).toEqual(["Luck/deck builder synergy games"]);
    expect(lens.unmatched).toEqual(["submarine documentaries"]);
    expect(lens.steered).toBe(1); // matched somewhere in the ranking…
    expect(lens.steeredShown).toBe(0); // …but nothing the reader can see moved
    // Lifted from last (10) to 8 and still short of the top 6 — a promotion the reader can be
    // told about honestly, not one that rewrote the list (#200).
    expect(lens.unlisted![0]).toMatchObject({ label: "Puzzle × Deckbuilding", rank: 8 });
    expect(lens.weight).toBe(
      steeringScale(
        (await q.rankMarketGaps(await seed(), "crazygames")).map((g) => g.score),
        6,
      ).weight,
    );
  });
});

// #195 — the whole-word cousin of #173. A `…playing card…` flag claimed the browser tag "Can't
// stop playing" on the bare word `playing`: one high-frequency English gerund that both sides
// happen to contain and that carries none of the flag's meaning. Measured live 2026-09-04, where
// `Driving × Can't stop playing` sat in `unlisted` with delta 1.0 from two flags on that word
// alone. Cosmetic only while the weight could not move anything — which #200 changes.
describe("a bare common gerund cannot carry a flag (#195)", () => {
  const FLAGS = ["Blackjack or playing card mechanics", "Living playing card/toy soldiers setting"];

  it("refuses the engagement tag the bare word `playing` invented", () => {
    for (const tag of ["Can't stop playing", "Can’t stop playing"])
      expect(matchSteering(FLAGS, { genre: "Driving", tag })).toEqual([]);
  });

  it("still reaches a genuine card market — the interest is in `card`, not in `playing`", () => {
    expect(matchSteering(FLAGS, { genre: "Card", tag: "Battle" })).toEqual(FLAGS);
    expect(matchSteering(FLAGS, { genre: "Casual", tag: "Card" })).toEqual(FLAGS);
  });
});

// #200 — 0.5 was one absolute constant over two rankings with different natural scales, and it
// moved nothing on either: 99 steered markets, `steeredShown: 0` on both panels. The two ladders
// below reproduce the 2026-09-04 measurement — the shown scores verbatim, a flat tail, and the
// flag's market at the rank it actually held (browser 16, Steam 22).
describe("the steering lift scales to the ranking it is applied to (#200)", () => {
  const FLAG = "Luck/deck builder synergy games";
  const surface = (head: number[], shownCount: number, tailStep: number, at: number) => {
    const scores = [...head];
    while (scores.length < 60) scores.push(+(scores[scores.length - 1] - tailStep).toFixed(2));
    return { shownCount, cutoff: head[head.length - 1], scores, at };
  };
  type Surface = ReturnType<typeof surface>;
  const BROWSER = surface([10.54, 9.57, 9.27, 8.74, 8.33, 7.45], 6, 0.1, 15);
  const STEAM = surface([5.84, 5.76, 5.26, 5.03, 4.77, 4.67, 3.81, 3.81], 8, 0.05, 21);
  /** Fresh rows every call — `steerRanking` lifts in place. */
  const rows = (s: Surface, at = s.at) =>
    s.scores.map((score, i) =>
      i === at ? gap("Puzzle", "Deckbuilding", score) : gap("Casual", `Filler ${i}`, score),
    );
  const shown = (s: Surface, flags: string[], at = s.at) =>
    steerRanking(rows(s, at), flags, s.shownCount).slice(0, s.shownCount);

  it("gives each surface its own weight, both larger than the flat constant", () => {
    expect(steeringScale(BROWSER.scores, BROWSER.shownCount).weight).toBeCloseTo(1.54, 2);
    expect(steeringScale(STEAM.scores, STEAM.shownCount).weight).toBeCloseTo(1.01, 2);
    // The point of the change: one number cannot serve both, and 0.5 served neither.
    expect(steeringScale(BROWSER.scores, 6).weight).not.toBe(steeringScale(STEAM.scores, 8).weight);
  });

  it("surfaces a comparable market on both scales, where the flat 0.5 never could", () => {
    for (const s of [BROWSER, STEAM]) {
      expect(s.scores[s.at] + STEERING_WEIGHT).toBeLessThan(s.cutoff); // the old lift fell short…
      expect(shown(s, [FLAG]).some((g) => g.label === "Puzzle × Deckbuilding")).toBe(true);
    }
  });

  it("no flags set → the ranking is still byte-identical to the market data's own", () => {
    expect(steerRanking(rows(BROWSER), [], 6)).toEqual(steerRanking(rows(BROWSER), ["  "], 6));
    expect(steerRanking(rows(BROWSER), [], 6).some((g) => g.steering)).toBe(false);
  });

  // The guardrail that protects the panel's credibility: a lift breaks ties among markets that
  // were ALREADY real gaps. A market outside the candidate band is not teleported into view —
  // and it is not silently dropped from the lens either.
  it("cannot teleport a market from outside the candidate band, and still reports it", () => {
    const deep = 40; // scored more than one maximum lift below the cut
    const ranked = steerRanking(rows(BROWSER, deep), [FLAG], 6);
    const deck = ranked.find((g) => g.label === "Puzzle × Deckbuilding")!;
    expect(deck.score).toBe(BROWSER.scores[deep]); // untouched by the lift
    expect(deck.steering).toEqual({ flags: [FLAG], delta: 0 }); // …but the match is still recorded
    const lens = steeringLens([FLAG], ranked, 6)!;
    expect(lens).toMatchObject({ applied: [FLAG], steered: 1, steeredShown: 0 });
    expect(lens.unlisted![0]).toMatchObject({ label: "Puzzle × Deckbuilding", rank: 41, delta: 0 });
  });

  it("caps the total lift at one visible band — steering never crowns a new leader", () => {
    const flags = [FLAG, "Puzzle games", "Deckbuilding"]; // three matches on the same market
    const ranked = steerRanking(rows(BROWSER), flags, 6);
    const deck = ranked.find((g) => g.label === "Puzzle × Deckbuilding")!;
    const { maxLift, weight } = steeringScale(BROWSER.scores, 6);
    expect(deck.steering!.flags).toHaveLength(3);
    expect(deck.steering!.delta).toBe(maxLift); // not 3 × weight
    expect(maxLift).toBeLessThan(3 * weight);
    // A row below the cut scores at most `cutoff`, and cutoff + spread = the unsteered top score.
    expect(deck.score).toBeLessThanOrEqual(BROWSER.scores[0]);
    expect(ranked[0].label).toBe("Casual × Filler 0");
  });
});
