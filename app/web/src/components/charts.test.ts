import { describe, it, expect } from "vitest";
import {
  scatterOption,
  velocityBarOption,
  landscapeOption,
  quadrantOption,
  heatmapOption,
  momentumOption,
  treemapOption,
  tierBarOption,
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
    expect(data[1].itemStyle.color).toContain("c2620a"); // rising = amber
    expect(data[0].itemStyle.color).toContain("059669"); // quiet = green
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
    { title: "Crowd One", genre: "Action", votes: 500, rating: 3.8, gem: false },
    { title: "Crowd Two", genre: "Puzzle", votes: 300, rating: 3.5, gem: false },
    { title: "Gem One", genre: "Puzzle", votes: 200, rating: 4.8, gem: true },
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
});

// ---------------------------------------------------------------------------
// 2. velocityBarOption — color coding for positive vs negative velocity
// ---------------------------------------------------------------------------
describe("velocityBarOption", () => {
  const bars: GenreVelocityBar[] = [
    { genre: "Action", votesPerDay: 120 },
    { genre: "Puzzle", votesPerDay: -30 },
    { genre: "Racing", votesPerDay: 5 },
  ];
  const opt = velocityBarOption(bars) as any;

  it("yAxis is category, xAxis is value (horizontal bars)", () => {
    expect(opt.yAxis.type).toBe("category");
    expect(opt.xAxis.type).toBe("value");
  });

  it("positive-velocity bar uses green #059669", () => {
    // bars are reversed in the fn; Racing(5) becomes index 0, Puzzle(-30) index 1, Action(120) index 2
    const seriesData = opt.series[0].data;
    const actionBar = seriesData.find((d: any) => d.value === 120);
    expect(actionBar.itemStyle.color).toBe("#059669");
  });

  it("negative-velocity bar uses red #dc2626", () => {
    const seriesData = opt.series[0].data;
    const puzzleBar = seriesData.find((d: any) => d.value === -30);
    expect(puzzleBar.itemStyle.color).toBe("#dc2626");
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
      examples: ["A", "B"],
    },
    {
      genre: "Puzzle",
      supply: 30,
      p75Rating: 4.1,
      avgRating: 3.8,
      totalVotes: 200000,
      examples: ["C"],
    },
  ];
  const opt = landscapeOption(pts) as any;

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
    dates,
    series: [
      { genre: "Action", values: [100, 120, 115, 130, 140] },
      { genre: "Puzzle", values: [50, 55, 60, 58, 62] },
    ],
  };
  const opt = momentumOption(momentum) as any;

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

  it("AAA bar is grey, indie bars are blue", () => {
    const data = opt.series[0].data;
    const aaa = data.find((d: any) => d.name === "aaa");
    const hobby = data.find((d: any) => d.name === "hobby");
    expect(aaa.itemStyle.color).toBe("#cbd5e1");
    expect(hobby.itemStyle.color).toBe("#2563eb");
  });

  it("includes every tier and its count", () => {
    const byName = Object.fromEntries(opt.series[0].data.map((d: any) => [d.name, d.value]));
    expect(byName).toEqual({ hobby: 14, small_indie: 10, est_indie: 3, aaa: 13 });
  });
});
