// ECharts option builders from API shapes. Mirrors the approved light-mode mockup.
import type { EChartsOption } from "echarts";
import type { GenreMomentum, TagFreq, ScatterPoint, FeatureHeatmap } from "shared";

const AX = "#64748b", GRID = "#e6ecf5", FONT = "'Fira Code', monospace";
const LINE_COLORS = ["#059669", "#2563eb", "#d97706", "#dc2626"];
const TREE_COLORS = ["#1e3a8a", "#1e40af", "#2563eb", "#3b82f6", "#0e7490", "#0891b2", "#0ea5b7", "#b45309", "#c2620a", "#d97706", "#7c3aed", "#9333ea"];
const tip = {
  backgroundColor: "#ffffff",
  borderColor: "#dbe3ef",
  textStyle: { color: "#14213a", fontFamily: FONT, fontSize: 11 },
  extraCssText: "box-shadow:0 4px 14px rgba(16,24,40,.10)",
};
const baseGrid = { left: 46, right: 18, top: 24, bottom: 30 };

export function momentumOption(m: GenreMomentum): EChartsOption {
  return {
    tooltip: { trigger: "axis", ...tip },
    legend: { top: 0, right: 0, textStyle: { color: AX, fontSize: 11, fontFamily: FONT }, icon: "roundRect", itemWidth: 11, itemHeight: 4 },
    grid: { ...baseGrid, top: 34 },
    xAxis: { type: "category", data: m.weeks, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 10 } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 10 } },
    series: m.series.map((s, i) => ({
      name: s.genre,
      type: "line",
      smooth: true,
      symbol: "none",
      data: s.values,
      lineStyle: { width: i === 0 ? 3 : 2.5, color: LINE_COLORS[i % LINE_COLORS.length] },
      areaStyle: i === 0 ? { color: LINE_COLORS[0], opacity: 0.12 } : undefined,
    })),
  };
}

export function treemapOption(tags: TagFreq[]): EChartsOption {
  return {
    tooltip: { ...tip, formatter: (p: any) => `${p.name}<br><b>${p.value}</b> games` },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: "100%",
        height: "100%",
        top: 6,
        bottom: 6,
        left: 0,
        right: 0,
        itemStyle: { borderColor: "#fff", borderWidth: 2, gapWidth: 2 },
        label: { color: "#fff", fontFamily: FONT, fontSize: 11, fontWeight: 600, textShadowColor: "rgba(0,0,0,.25)", textShadowBlur: 3 },
        levels: [{ color: TREE_COLORS, colorMappingBy: "index" }],
        data: tags.map((t) => ({ name: t.tag, value: t.count })),
      },
    ],
  };
}

export function scatterOption(points: ScatterPoint[]): EChartsOption {
  const crowd = points.filter((p) => !p.gem).map((p) => [Math.max(p.votes, 1), p.rating]);
  const gems = points.filter((p) => p.gem).map((p) => [Math.max(p.votes, 1), p.rating]);
  return {
    tooltip: { ...tip, formatter: (p: any) => `rating <b>${p.value[1]}</b><br>${p.value[0].toLocaleString()} votes` },
    grid: { ...baseGrid, left: 40, top: 18 },
    xAxis: { type: "log", name: "votes (visibility)", nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    yAxis: { type: "value", min: 2.5, max: 5, name: "rating", nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    series: [
      { name: "crowd", type: "scatter", symbolSize: 6, itemStyle: { color: "rgba(100,116,139,.40)" }, data: crowd },
      {
        name: "gems",
        type: "scatter",
        symbolSize: 9,
        itemStyle: { color: "#0891b2", borderColor: "#fff", borderWidth: 1, shadowBlur: 6, shadowColor: "rgba(8,145,178,.5)" },
        data: gems,
        markArea: { itemStyle: { color: "rgba(8,145,178,.07)" }, data: [[{ xAxis: 100, yAxis: 4.4 } as any, { xAxis: 5000, yAxis: 5 } as any]] },
      },
    ],
  };
}

export function heatmapOption(h: FeatureHeatmap): EChartsOption {
  return {
    tooltip: { ...tip, formatter: (p: any) => `${h.genres[p.value[1]]} · ${h.weeks[p.value[0]]}<br><b>${p.value[2]}</b> features` },
    grid: { left: 84, right: 14, top: 10, bottom: 46 },
    xAxis: { type: "category", data: h.weeks, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 10 }, splitArea: { show: false } },
    yAxis: { type: "category", data: h.genres, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 10 } },
    visualMap: { min: 0, max: Math.max(4, ...h.cells.map((c) => c.value)), calculable: true, orient: "horizontal", left: "center", bottom: 4, itemWidth: 10, itemHeight: 90, textStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, inRange: { color: ["#eef2f9", "#bfdbfe", "#60a5fa", "#2563eb", "#1e3a8a"] } },
    series: [
      {
        type: "heatmap",
        data: h.cells.map((c) => [c.week, c.genreIndex, c.value]),
        label: { show: true, color: "#334155", fontFamily: FONT, fontSize: 9 },
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(37,99,235,.4)" } },
      },
    ],
  };
}
