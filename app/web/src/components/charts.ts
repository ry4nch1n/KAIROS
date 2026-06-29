// ECharts option builders from API shapes. Mirrors the approved light-mode mockup.
import type { EChartsOption } from "echarts";
import type { GenreMomentum, TagFreq, ScatterPoint, FeatureHeatmap, GenreLandscapePoint, GenreVelocityBar } from "shared";

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
    grid: { ...baseGrid, left: 58, top: 34, bottom: 36 },
    xAxis: { type: "category", data: m.dates, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 10 } },
    yAxis: { type: "value", name: "median votes", nameLocation: "middle", nameGap: 44, nameRotate: 90, nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 10 } },
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
  // [votes, rating, title, genre] — title/genre kept for the tooltip
  const crowd = points.filter((p) => !p.gem).map((p) => [Math.max(p.votes, 1), p.rating, p.title, p.genre]);
  const gems  = points.filter((p) =>  p.gem).map((p) => [Math.max(p.votes, 1), p.rating, p.title, p.genre]);
  const fmtPt = (p: any) => `<b>${p.value[2]}</b><br>${p.value[3]} · rating ${p.value[1]}<br>${Number(p.value[0]).toLocaleString()} votes`;
  return {
    tooltip: { ...tip, formatter: fmtPt },
    grid: { ...baseGrid, left: 40, top: 18 },
    xAxis: { type: "log", name: "votes (visibility) →", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    yAxis: { type: "value", min: 2.5, max: 5, name: "rating", nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    series: [
      { name: "crowd", type: "scatter", symbolSize: 5, itemStyle: { color: "rgba(100,116,139,.28)" }, data: crowd },
      { name: "gems", type: "scatter", symbolSize: 11, itemStyle: { color: "#0891b2", borderColor: "#fff", borderWidth: 1.5, shadowBlur: 6, shadowColor: "rgba(8,145,178,.5)" }, data: gems,
        markLine: { silent: true, symbol: "none", lineStyle: { color: "#0891b2", type: "dashed", opacity: 0.5 },
          data: [{ yAxis: 4.4, label: { formatter: "high rating", color: AX, fontSize: 9 } }] } },
    ],
  };
}

export function heatmapOption(h: FeatureHeatmap): EChartsOption {
  return {
    tooltip: { ...tip, formatter: (p: any) => `${h.genres[p.value[1]]} · ${h.weeks[p.value[0]]}<br><b>${p.value[2]}</b> games` },
    grid: { left: 84, right: 14, top: 10, bottom: 46 },
    xAxis: { type: "category", data: h.weeks, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 10 }, splitArea: { show: false } },
    yAxis: { type: "category", data: h.genres, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 10 } },
    visualMap: { min: 0, max: Math.max(4, ...h.cells.map((c) => c.value)), calculable: true, orient: "horizontal", left: "center", bottom: 4, itemWidth: 10, itemHeight: 90, textStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, inRange: { color: ["#eef2f9", "#bfdbfe", "#60a5fa", "#2563eb", "#1e3a8a"] } },
    series: [
      {
        type: "heatmap",
        data: h.cells.map((c) => [c.week, c.genreIndex, c.value]),
        label: { show: true, fontFamily: FONT, fontSize: 10, fontWeight: 600, formatter: (p: any) => String(p.value[2]), color: "#1e293b", textBorderColor: "rgba(255,255,255,.92)", textBorderWidth: 2.5 },
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(37,99,235,.4)" } },
      },
    ],
  };
}

export function landscapeOption(pts: GenreLandscapePoint[]): EChartsOption {
  const maxV = Math.max(1, ...pts.map((p) => p.totalVotes));
  const supplies = pts.map((p) => p.supply);
  const ratings = pts.map((p) => p.p75Rating);
  const xMin = Math.max(1, Math.floor(Math.min(...supplies) * 0.6));
  const xMax = Math.ceil(Math.max(...supplies) * 1.2);
  const yMin = Math.max(0, +(Math.min(...ratings) - 0.2).toFixed(1));
  const yMax = Math.min(5, +(Math.max(...ratings) + 0.2).toFixed(1));
  const data = pts.map((p) => ({ value: [p.supply, p.p75Rating, p.totalVotes, p.genre, (p.examples ?? []).join(", ")], symbolSize: 12 + 34 * Math.sqrt(p.totalVotes / maxV) }));
  return {
    tooltip: { ...tip, formatter: (p: any) => `<b>${p.value[3]}</b><br>${p.value[0]} games · P75 rating ${p.value[1]}<br>${Number(p.value[2]).toLocaleString()} total votes${p.value[4] ? `<br><span style="opacity:.7">e.g. ${p.value[4]}</span>` : ""}` },
    grid: { left: 64, right: 40, top: 20, bottom: 48 },
    xAxis: { type: "log", min: xMin, max: xMax, name: "supply (games) →", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    yAxis: { type: "value", min: yMin, max: yMax, name: "quality ceiling (P75 rating)", nameLocation: "middle", nameGap: 44, nameRotate: 90, nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    series: [{
      type: "scatter", data,
      itemStyle: { color: "rgba(37,99,235,.45)", borderColor: "#1e3a8a", borderWidth: 1 },
      label: { show: true, formatter: (p: any) => p.value[3], position: "right", color: AX, fontFamily: FONT, fontSize: 9 },
      labelLayout: { hideOverlap: true },
    }],
  };
}

export function velocityBarOption(bars: GenreVelocityBar[]): EChartsOption {
  const data = [...bars].reverse(); // largest on top for a horizontal bar
  return {
    tooltip: { ...tip, formatter: (p: any) => `${p.name}<br><b>${Number(p.value).toLocaleString()}</b> votes/day` },
    grid: { left: 116, right: 36, top: 10, bottom: 26 },
    xAxis: { type: "value", name: "votes/day", nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLabel: { color: AX, fontFamily: FONT, fontSize: 9 }, splitLine: { lineStyle: { color: GRID } } },
    yAxis: { type: "category", data: data.map((b) => b.genre), axisLabel: { color: AX, fontFamily: FONT, fontSize: 10 }, axisLine: { lineStyle: { color: GRID } } },
    series: [{ type: "bar", barWidth: "62%", data: data.map((b) => ({ value: b.votesPerDay, itemStyle: { color: b.votesPerDay >= 0 ? "#059669" : "#dc2626" } })), label: { show: true, position: "right", color: AX, fontFamily: FONT, fontSize: 9, formatter: (p: any) => Number(p.value).toLocaleString() } }],
  };
}
