import { describe, it, expect } from "vitest";
import {
  scatterOption,
  velocityBarOption,
  landscapeOption,
  quadrantOption,
  fmtVotePct,
  levelName,
  heatmapOption,
  momentumOption,
  treemapOption,
  tierBarOption,
  barsByPortal,
  PALETTE,
} from "./charts.ts";
import type {
  ScatterPoint,
  GenreVelocityBar,
  GenreLandscapePoint,
  QuadrantPoint,
  FeatureHeatmap,
  GenreMomentum,
  TagFreq,
  ScaleTierRow,
} from "shared";

describe("quadrantOption", () => {
  const pts: QuadrantPoint[] = [
    { genre: "Puzzle", supply: 20, appetite: 1500, weight: 200000, supplyTrend: "quiet" },
    { genre: "Casual", supply: 12, appetite: 1800, weight: 400000, supplyTrend: "rising" },
    { genre: ".io", supply: 6, appetite: 22000, weight: 150000, supplyTrend: "cooling" },
  ];
  const opt = quadrantOption(pts, { yName: "median votes", weightName: "total votes" }) as any;

  it("plots [supply, appetite, weight, genre, trend] per point, coloured by supply trend", () => {
    const data = opt.series[0].data;
    expect(data).toHaveLength(3);
    expect(data[0].value.slice(0, 2)).toEqual([20, 1500]);
    expect(data[1].itemStyle.color).toContain(PALETTE.attention.slice(1)); // rising = crowding
    expect(data[0].itemStyle.color).toContain(PALETTE.positive.slice(1)); // quiet = clean opening
  });
  it("draws a median cross so the underserved quadrant is readable", () => {
    const ml = opt.series[0].markLine.data;
    expect(ml.some((d: any) => d.xAxis === 12)).toBe(true); // median supply of [6,12,20]
    expect(ml.some((d: any) => d.yAxis === 1800)).toBe(true); // median appetite
  });
  it("uses log axes (wide demand/supply ranges) without a zero-crash", () => {
    expect(opt.xAxis.type).toBe("log");
    expect(opt.yAxis.type).toBe("log");
  });
});

// ---------------------------------------------------------------------------
// 1. scatterOption — tooltip has no "game name" bug guard
// ---------------------------------------------------------------------------
describe("scatterOption", () => {
  const points: ScatterPoint[] = [
    { title: "Crowd One", genre: "Action", votes: 500, rating: 3.8, gem: false, votePct: null },
    { title: "Crowd Two", genre: "Puzzle", votes: 300, rating: 3.5, gem: false, votePct: null },
    { title: "Gem One", genre: "Puzzle", votes: 200, rating: 4.8, gem: true, votePct: null },
  ];
  const opt = scatterOption(points) as any;

  it("xAxis is log scale", () => {
    expect(opt.xAxis.type).toBe("log");
  });

  it("series includes both a 'crowd' and a 'gems' series", () => {
    const names = opt.series.map((s: any) => s.name);
    expect(names).toContain("crowd");
    expect(names).toContain("gems");
  });

  it("gems data tuple carries title at index 2 and genre at index 3", () => {
    const gemsSeries = opt.series.find((s: any) => s.name === "gems");
    const tuple = gemsSeries.data[0];
    expect(tuple[2]).toBe("Gem One");
    expect(tuple[3]).toBe("Puzzle");
  });

  it("tooltip formatter contains the game title", () => {
    const result = opt.tooltip.formatter({ value: [200, 4.8, "Gem One", "Puzzle"] });
    expect(result).toContain("Gem One");
  });

  it("All Browser plots the within-portal vote percentile on a 0–100 axis, not raw votes (#204 S4)", () => {
    const mixed = scatterOption(
      points.map((p, i) => ({ ...p, votes: p.votes * 100 ** i, votePct: [80, 45.5, 12][i] })),
    ) as any;
    expect(mixed.xAxis).toMatchObject({ type: "value", min: 0, max: 100 });
    expect(mixed.xAxis.name).toContain("percentile");
    expect(mixed.xAxis.name).toContain("portal"); // the unit stays explicit…
    expect(mixed.xAxis.name.length).toBeLessThanOrEqual(30); // …and fits a 375px card (#204 S5)
    expect(mixed.xAxis.axisLabel.formatter(62)).toBe("P62");
    const gem = mixed.series.find((s: any) => s.name === "gems").data[0];
    expect(gem.slice(0, 4)).toEqual([12, 4.8, "Gem One", "Puzzle"]);
    const tip = mixed.tooltip.formatter({ value: gem });
    expect(tip).toContain("P12 vote percentile within its portal");
    expect(tip).not.toMatch(/\d votes/);
  });
});

describe("fmtVotePct / levelName (#204 S4)", () => {
  it("formats a percentile as a whole P-value and names the unit", () => {
    expect(fmtVotePct(61.6)).toBe("P62");
    expect(fmtVotePct(0)).toBe("P0");
    expect(levelName("votePercentile", "median votes")).toBe("median vote percentile");
    expect(levelName("votes", "median votes")).toBe("median votes");
    expect(levelName(undefined, "median votes")).toBe("median votes");
  });
  it("quadrant on All Browser: linear 0–100 demand axis read as P-values", () => {
    const opt = quadrantOption(
      [
        { genre: "Puzzle", supply: 20, appetite: 47, weight: 9.4, supplyTrend: "quiet" },
        { genre: "Racing", supply: 12, appetite: 53, weight: 6.1, supplyTrend: "steady" },
        { genre: "Word", supply: 6, appetite: 0, weight: 0, supplyTrend: "steady" },
      ],
      { yName: "median vote percentile", weightName: "vote-weighted titles", percentile: true },
    ) as any;
    expect(opt.yAxis).toMatchObject({ type: "value", min: 0, max: 100 });
    expect(opt.yAxis.axisLabel.formatter(50)).toBe("P50");
    expect(opt.series[0].data[2].value[1]).toBe(0); // a P0 genre is not bumped to 1
    expect(opt.tooltip.formatter({ value: [20, 47, 9.4, "Puzzle", "quiet"] })).toContain(
      "P47 median vote percentile",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. velocityBarOption — color coding for positive vs negative velocity
// ---------------------------------------------------------------------------
const pk = (genre: string, votesPerDay: number): GenreVelocityBar => ({
  genre,
  source: "poki",
  voteBasis: "cumulative",
  votesPerDay,
  engagementPctPerWeek: null,
});
const cg = (genre: string, engagementPctPerWeek: number): GenreVelocityBar => ({
  genre,
  source: "crazygames",
  voteBasis: "window",
  votesPerDay: null,
  engagementPctPerWeek,
});

describe("velocityBarOption per vote basis (#204 S3)", () => {
  it("a window group plots signed %/wk with its own axis unit", () => {
    const opt = velocityBarOption([cg("Word", 60.9), cg("Racing", -37.8)]) as any;
    expect(opt.xAxis.name).toBe("%/wk");
    expect(opt.series[0].data.map((d: any) => d.value)).toEqual([-37.8, 60.9]);
    expect(opt.series[0].label.formatter({ value: -37.8 })).toBe("−37.8%");
    expect(opt.tooltip.formatter({ name: "Word", value: 60.9 })).toContain("recent engagement");
    expect(opt.tooltip.formatter({ name: "Word", value: 60.9 })).not.toContain("votes/day");
  });
  it("never mixes units on one axis: bars on another basis are dropped", () => {
    const opt = velocityBarOption([pk("Racing", 375), cg("Word", 60.9)]) as any;
    expect(opt.xAxis.name).toBe("votes/day");
    expect(opt.yAxis.data).toEqual(["Racing"]);
  });
  it("barsByPortal splits an All Browser list into ordered per-portal groups", () => {
    const groups = barsByPortal([cg("Word", 60.9), cg("Racing", -37.8), pk("Racing", 375)]);
    expect(groups.map((g) => [g.source, g.voteBasis, g.bars.length])).toEqual([
      ["crazygames", "window", 2],
      ["poki", "cumulative", 1],
    ]);
  });
});

describe("velocityBarOption", () => {
  const bars: GenreVelocityBar[] = [pk("Action", 120), pk("Puzzle", -30), pk("Racing", 5)];
  const opt = velocityBarOption(bars) as any;

  it("yAxis is category, xAxis is value (horizontal bars)", () => {
    expect(opt.yAxis.type).toBe("category");
    expect(opt.xAxis.type).toBe("value");
  });

  it("positive-velocity bar uses the positive verdict colour", () => {
    // bars are reversed in the fn; Racing(5) becomes index 0, Puzzle(-30) index 1, Action(120) index 2
    const seriesData = opt.series[0].data;
    const actionBar = seriesData.find((d: any) => d.value === 120);
    expect(actionBar.itemStyle.color).toBe(PALETTE.positive);
  });

  it("negative-velocity bar uses the negative verdict colour", () => {
    const seriesData = opt.series[0].data;
    const puzzleBar = seriesData.find((d: any) => d.value === -30);
    expect(puzzleBar.itemStyle.color).toBe(PALETTE.negative);
  });
});

// ---------------------------------------------------------------------------
// 3. landscapeOption — log x-axis, label overlap, tooltip content
// ---------------------------------------------------------------------------
describe("landscapeOption", () => {
  const pts: GenreLandscapePoint[] = [
    {
      genre: "Action",
      supply: 90,
      p75Rating: 4.6,
      avgRating: 4.2,
      totalVotes: 1000000,
      voteWeight: null,
      examples: ["A", "B"],
    },
    {
      genre: "Puzzle",
      supply: 30,
      p75Rating: 4.1,
      avgRating: 3.8,
      totalVotes: 200000,
      voteWeight: null,
      examples: ["C"],
    },
  ];
  const opt = landscapeOption(pts) as any;

  it("All Browser: bubbles size on vote-weighted titles and the tooltip names the unit (#204 S4)", () => {
    const mixed = landscapeOption(
      pts.map((p, i) => ({ ...p, totalVotes: null, voteWeight: i ? 8.5 : 34 })),
    ) as any;
    expect(mixed.series[0].data.map((d: any) => d.value[2])).toEqual([34, 8.5]);
    const tip = mixed.tooltip.formatter({ value: [90, 4.6, 34, "Action", ""] });
    expect(tip).toContain("vote-weighted titles");
    expect(tip).not.toContain("total votes");
  });

  it("xAxis is log scale", () => {
    expect(opt.xAxis.type).toBe("log");
  });

  it("series[0].labelLayout.hideOverlap is true", () => {
    expect(opt.series[0].labelLayout.hideOverlap).toBe(true);
  });

  it("series[0].label.show is true", () => {
    expect(opt.series[0].label.show).toBe(true);
  });

  it("tooltip formatter contains genre and examples", () => {
    // value: [supply, p75Rating, totalVotes, genre, examples joined]
    const result = opt.tooltip.formatter({ value: [90, 4.6, 1000000, "Action", "A, B"] });
    expect(result).toContain("Action");
    expect(result).toContain("A, B");
  });
});

// ---------------------------------------------------------------------------
// 4. heatmapOption — fixed dark glyph + white halo mechanism
// ---------------------------------------------------------------------------
describe("heatmapOption", () => {
  // 5 bands x 2 genres with at least one high and one low value
  const heatmap: FeatureHeatmap = {
    weeks: ["★★★★★", "★★★★☆", "★★★☆☆", "★★☆☆☆", "★☆☆☆☆"],
    genres: ["Action", "Puzzle"],
    cells: [
      { week: 0, genreIndex: 0, value: 42 }, // high-value cell
      { week: 0, genreIndex: 1, value: 10 },
      { week: 1, genreIndex: 0, value: 5 },
      { week: 1, genreIndex: 1, value: 1 }, // low-value cell
      { week: 2, genreIndex: 0, value: 8 },
      { week: 2, genreIndex: 1, value: 3 },
      { week: 3, genreIndex: 0, value: 2 },
      { week: 3, genreIndex: 1, value: 0 },
      { week: 4, genreIndex: 0, value: 0 },
      { week: 4, genreIndex: 1, value: 0 },
    ],
  };
  const opt = heatmapOption(heatmap) as any;
  const label = opt.series[0].label;

  it("label uses fixed dark color #1e293b (not adaptive fn)", () => {
    expect(label.color).toBe("#1e293b");
  });

  it("label textBorderColor is a light/white value (contains 255)", () => {
    expect(label.textBorderColor).toMatch(/255/);
  });

  it("label textBorderWidth > 0 (halo present)", () => {
    expect(label.textBorderWidth).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. momentumOption — xAxis.data matches input dates (real dates, not W-tokens)
// ---------------------------------------------------------------------------
describe("momentumOption", () => {
  const dates = ["06-01", "06-08", "06-15", "06-22", "06-29"];
  const momentum: GenreMomentum = {
    source: "poki",
    voteBasis: "cumulative",
    dates,
    series: [
      { genre: "Action", values: [100, 120, 115, 130, 140] },
      { genre: "Puzzle", values: [50, 55, 60, 58, 62] },
    ],
  };
  const opt = momentumOption(momentum) as any;

  it("the y axis names which kind of count it plots (#204 S3)", () => {
    expect(opt.yAxis.name).toBe("median votes (running total)");
    const win = momentumOption({ ...momentum, source: "crazygames", voteBasis: "window" }) as any;
    expect(win.yAxis.name).toBe("median votes (recent window)");
  });

  it("xAxis.data equals the input dates", () => {
    expect(opt.xAxis.data).toEqual(dates);
  });

  it("no date entry matches the fake /^W\\d+$/ pattern", () => {
    for (const d of opt.xAxis.data) {
      expect(d).not.toMatch(/^W\d+$/);
    }
  });

  it("series[0].type is 'line'", () => {
    expect(opt.series[0].type).toBe("line");
  });
});

// ---------------------------------------------------------------------------
// 6. treemapOption — type, and data shape
// ---------------------------------------------------------------------------
describe("treemapOption", () => {
  const tags: TagFreq[] = [
    { tag: "3D", count: 168 },
    { tag: "Puzzle", count: 55 },
  ];
  const opt = treemapOption(tags) as any;

  it("series[0].type is 'treemap'", () => {
    expect(opt.series[0].type).toBe("treemap");
  });

  it("series[0].data[0] maps tag→name and count→value", () => {
    expect(opt.series[0].data[0]).toEqual({ name: "3D", value: 168 });
  });
});

// ---------------------------------------------------------------------------
// 7. tierBarOption — scale-tier bars; AAA greyed, indie tiers blue
// ---------------------------------------------------------------------------
describe("tierBarOption", () => {
  const tiers: ScaleTierRow[] = [
    { tier: "hobby", games: 14 },
    { tier: "aaa", games: 13 },
    { tier: "small_indie", games: 10 },
    { tier: "est_indie", games: 3 },
  ];
  const opt = tierBarOption(tiers) as any;

  it("is a horizontal bar (yAxis category, xAxis value)", () => {
    expect(opt.yAxis.type).toBe("category");
    expect(opt.xAxis.type).toBe("value");
  });

  it("AAA is context colour, the indie cohort is the focus colour", () => {
    const data = opt.series[0].data;
    const aaa = data.find((d: any) => d.name === "aaa");
    const hobby = data.find((d: any) => d.name === "hobby");
    expect(aaa.itemStyle.color).toBe(PALETTE.contextFill);
    expect(hobby.itemStyle.color).toBe(PALETTE.focus);
  });

  it("includes every tier and its count", () => {
    const byName = Object.fromEntries(opt.series[0].data.map((d: any) => [d.name, d.value]));
    expect(byName).toEqual({ hobby: 14, small_indie: 10, est_indie: 3, aaa: 13 });
  });
});
