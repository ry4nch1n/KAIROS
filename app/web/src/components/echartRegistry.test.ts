import type {
  FeatureHeatmap,
  GenreLandscapePoint,
  GenreMomentum,
  GenreVelocityBar,
  QuadrantPoint,
  ScaleTierRow,
  ScatterPoint,
  TagFreq,
} from "shared";
import { describe, expect, it } from "vitest";
import {
  heatmapOption,
  landscapeOption,
  momentumOption,
  quadrantOption,
  scatterOption,
  tierBarOption,
  treemapOption,
  velocityBarOption,
} from "./charts.ts";
import { REGISTERED_CHART_TYPES, REGISTERED_COMPONENT_KEYS } from "./echartRegistry.ts";

// The whole point of the tree-shake: ECharts silently renders BLANK (green build, passing
// CI) if a chart's series.type or a needed component isn't registered. Our smoke only hits
// /api/contract, so it can't catch a blank chart. This test is the substitute for visual
// verification — it drives every option builder in charts.ts and asserts that everything
// each one produces (series types + component-bearing option keys) is registered in
// echartRegistry.ts. Add a chart type or a new component (dataZoom, title, …) to charts.ts
// without registering it and this fails.

// Every ECharts top-level option key that requires a *Component module to be registered.
// If a builder starts emitting one of these, it MUST be in REGISTERED_COMPONENT_KEYS.
const TOP_LEVEL_COMPONENT_KEYS = [
  "grid",
  "xAxis",
  "yAxis",
  "polar",
  "radar",
  "geo",
  "singleAxis",
  "parallel",
  "parallelAxis",
  "calendar",
  "tooltip",
  "axisPointer",
  "legend",
  "title",
  "toolbox",
  "dataZoom",
  "visualMap",
  "timeline",
  "graphic",
  "brush",
  "dataset",
  "aria",
] as const;

// Series-level keys that each require their own component module.
const SERIES_COMPONENT_KEYS = ["markLine", "markPoint", "markArea"] as const;

// Representative inputs — one per builder, exercising the shapes charts.ts branches on.
const builtOptions = [
  momentumOption({
    dates: ["06-01", "06-08"],
    series: [
      { genre: "Action", values: [100, 120] },
      { genre: "Puzzle", values: [50, 55] },
    ],
  } satisfies GenreMomentum),
  treemapOption([
    { tag: "3D", count: 168 },
    { tag: "Puzzle", count: 55 },
  ] satisfies TagFreq[]),
  scatterOption([
    { title: "Crowd", genre: "Action", votes: 500, rating: 3.8, gem: false },
    { title: "Gem", genre: "Puzzle", votes: 200, rating: 4.8, gem: true },
  ] satisfies ScatterPoint[]),
  heatmapOption({
    weeks: ["★★★★★", "★★★★☆"],
    genres: ["Action", "Puzzle"],
    cells: [
      { week: 0, genreIndex: 0, value: 42 },
      { week: 1, genreIndex: 1, value: 1 },
    ],
  } satisfies FeatureHeatmap),
  landscapeOption([
    {
      genre: "Action",
      supply: 90,
      p75Rating: 4.6,
      avgRating: 4.2,
      totalVotes: 1_000_000,
      examples: ["A"],
    },
    {
      genre: "Puzzle",
      supply: 30,
      p75Rating: 4.1,
      avgRating: 3.8,
      totalVotes: 200_000,
      examples: ["C"],
    },
  ] satisfies GenreLandscapePoint[]),
  quadrantOption(
    [
      { genre: "Puzzle", supply: 20, appetite: 1500, weight: 200_000, supplyTrend: "quiet" },
      { genre: "Casual", supply: 12, appetite: 1800, weight: 400_000, supplyTrend: "rising" },
    ] satisfies QuadrantPoint[],
    { yName: "median votes", weightName: "total votes" },
  ),
  tierBarOption([
    { tier: "hobby", games: 14 },
    { tier: "aaa", games: 13 },
    { tier: "small_indie", games: 10 },
    { tier: "est_indie", games: 3 },
  ] satisfies ScaleTierRow[]),
  velocityBarOption([
    { genre: "Action", votesPerDay: 120 },
    { genre: "Puzzle", votesPerDay: -30 },
  ] satisfies GenreVelocityBar[]),
];

describe("ECharts registration coverage", () => {
  it("registers exactly the audited chart types the dashboard uses", () => {
    expect([...REGISTERED_CHART_TYPES].sort()).toEqual([
      "bar",
      "heatmap",
      "line",
      "scatter",
      "treemap",
    ]);
  });

  it("registers the audited component set (grid/axes, tooltip, legend, visualMap, markLine)", () => {
    for (const key of ["grid", "xAxis", "yAxis", "tooltip", "legend", "visualMap", "markLine"]) {
      expect(REGISTERED_COMPONENT_KEYS.has(key)).toBe(true);
    }
  });

  it("every series.type produced by charts.ts is a registered chart", () => {
    for (const opt of builtOptions) {
      const series = Array.isArray(opt.series) ? opt.series : [opt.series];
      for (const s of series) {
        const type = (s as { type?: string }).type;
        expect(type, "series is missing a type").toBeTruthy();
        expect(
          REGISTERED_CHART_TYPES.has(type as string),
          `series.type "${type}" is used but not registered in echartRegistry.ts`,
        ).toBe(true);
      }
    }
  });

  it("every component-bearing option key produced by charts.ts is registered", () => {
    for (const opt of builtOptions) {
      for (const key of TOP_LEVEL_COMPONENT_KEYS) {
        if (key in opt) {
          expect(
            REGISTERED_COMPONENT_KEYS.has(key),
            `top-level "${key}" is used but its ECharts component is not registered`,
          ).toBe(true);
        }
      }
      const series = Array.isArray(opt.series) ? opt.series : [opt.series];
      for (const s of series) {
        for (const key of SERIES_COMPONENT_KEYS) {
          if (s && key in s) {
            expect(
              REGISTERED_COMPONENT_KEYS.has(key),
              `series-level "${key}" is used but its ECharts component is not registered`,
            ).toBe(true);
          }
        }
      }
    }
  });
});
