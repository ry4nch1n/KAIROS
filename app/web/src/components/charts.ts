// ECharts option builders from API shapes. Mirrors the approved light-mode mockup.
import type { EChartsOption } from "echarts";
import type {
  GenreMomentum,
  TagFreq,
  ScatterPoint,
  FeatureHeatmap,
  GenreLandscapePoint,
  QuadrantPoint,
  GenreVelocityBar,
  ScaleTierRow,
  VoteBasis,
  LevelUnit,
} from "shared";

const AX = "#5b6b86",
  GRID = "#e6ecf5",
  FONT = "'Fira Code', monospace";
// ── Chart palette ────────────────────────────────────────────────────────────
// One focus colour; everything else graphite.
//
// Blue used to mean "primary action", "indie cohort", "Route 1", "cooling
// supply" and "heatmap density" in five different places, so it meant nothing.
// It now means exactly one thing: the series under decision. If two things in a
// chart are blue, one of them is wrong.
//
// Semantic colour (POSITIVE / NEGATIVE) is reserved for verdicts — never a
// category, never a series.
// Exported so tests assert the ROLE MAPPING (which role lands on which mark)
// rather than a literal hex — a palette change should not break a test whose
// subject is "AAA is context, the indie cohort is the focus".
export const PALETTE = {
  focus: "#1d4ed8", // the series under decision. Exactly one per chart.
  context: "#6b7a94", // benchmark, cohort baseline, AAA — graphite by design
  attention: "#8a3f07", // crowding, estimator disagreement, a closing door
  positive: "#047857",
  negative: "#b91c1c",
  contextFill: "#c3cfe2", // the light graphite used for AAA bars
} as const;
const FOCUS = PALETTE.focus;
const CONTEXT = PALETTE.context;
const ATTENTION = PALETTE.attention;
const POSITIVE = PALETTE.positive;
const NEGATIVE = PALETTE.negative;

// Ordered magnitude. Categorical colour is never used for ordered data — that
// was the error the old 12-stop rainbow made, mapping a treemap by INDEX so the
// colour carried no information at all.
const INK_RAMP = ["#eef2f8", "#c3cfe2", "#8fa3c0", "#4f6b98", "#1e3a5f"];

// The treemap draws white labels ON the tiles, so its ramp cannot start pale —
// the lightest step here is 4.97:1 against white, so every label stays legible
// regardless of which tile it lands on.
const TREE_RAMP = ["#5b7099", "#4a5f88", "#3a4f76", "#293d5f", "#12233d"];

// Multi-series lines: series 0 is the focus (the caller already gives it a
// thicker stroke and an area fill); the rest recede through the ink family in
// order, so the chart reads as one system with a clear subject.
const LINE_COLORS = [FOCUS, "#4f6b98", "#8fa3c0", "#b9c6da"];
const tip = {
  backgroundColor: "#ffffff",
  borderColor: "#dbe3ef",
  textStyle: { color: "#14213a", fontFamily: FONT, fontSize: 11 },
  extraCssText: "box-shadow:0 4px 14px rgba(16,24,40,.10)",
};
const baseGrid = { left: 46, right: 18, top: 24, bottom: 30 };

/** One portal's genre levels (#204 S3). The y label says which kind of count it is: a running
 *  total and a recent-window count are different quantities, so they never share this axis. */
export const momentumAxisName = (basis: VoteBasis) =>
  basis === "window" ? "median votes (recent window)" : "median votes (running total)";
export function momentumOption(m: GenreMomentum): EChartsOption {
  return {
    tooltip: { trigger: "axis", ...tip },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: AX, fontSize: 11, fontFamily: FONT },
      icon: "roundRect",
      itemWidth: 11,
      itemHeight: 4,
    },
    grid: { ...baseGrid, left: 58, top: 34, bottom: 36 },
    xAxis: {
      type: "category",
      data: m.dates,
      axisLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      name: momentumAxisName(m.voteBasis),
      nameLocation: "middle",
      nameGap: 44,
      nameRotate: 90,
      nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 11 },
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
    },
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
        label: {
          color: "#fff",
          fontFamily: FONT,
          fontSize: 11,
          fontWeight: 600,
          textShadowColor: "rgba(0,0,0,.25)",
          textShadowBlur: 3,
        },
        // by VALUE, not index: the tile's colour now encodes its magnitude,
        // which is the only thing a treemap's colour can honestly say.
        levels: [{ color: TREE_RAMP, colorMappingBy: "value" }],
        data: tags.map((t) => ({ name: t.tag, value: t.count })),
      },
    ],
  };
}

/** A within-portal vote percentile (0–100) as read on All Browser (#204 S4): "P62". */
export const fmtVotePct = (v: number) => `P${Math.round(v)}`;
/** What a browser vote LEVEL is called, by unit. */
export const levelName = (unit: LevelUnit | undefined, raw: string) =>
  unit === "votePercentile" ? "median vote percentile" : raw;
export const VOTE_PCT_TIP =
  "All Browser: each title's votes are ranked within its own portal (P0 = that portal's least-voted title, P100 = its most-voted), because one portal's count is a running total and the other's covers only recent engagement. Medians and sums are taken over those percentiles, never over raw counts pooled across portals.";

export function scatterOption(points: ScatterPoint[]): EChartsOption {
  // On All Browser (#204 S4) x is each title's vote percentile within its own portal: raw counts on
  // different bases never share an axis. A single portal keeps raw votes on a log axis.
  const pct = points.some((p) => p.votePct != null);
  // [x, rating, title, genre, raw votes] — title/genre/votes kept for the tooltip
  const pt = (p: ScatterPoint) => [
    pct ? (p.votePct ?? 0) : Math.max(p.votes, 1),
    p.rating,
    p.title,
    p.genre,
    p.votes,
  ];
  const crowd = points.filter((p) => !p.gem).map(pt);
  const gems = points.filter((p) => p.gem).map(pt);
  const fmtPt = (p: any) =>
    `<b>${p.value[2]}</b><br>${p.value[3]} · rating ${p.value[1]}<br>` +
    (pct
      ? `${fmtVotePct(Number(p.value[0]))} vote percentile within its portal`
      : `${Number(p.value[0]).toLocaleString()} votes`);
  return {
    tooltip: { ...tip, formatter: fmtPt },
    grid: { ...baseGrid, left: 40, top: 18 },
    xAxis: {
      type: pct ? "value" : "log",
      ...(pct ? { min: 0, max: 100 } : {}),
      name: pct ? "vote percentile within portal (visibility) →" : "votes (visibility) →",
      nameLocation: "middle",
      nameGap: 26,
      nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 11 },
      axisLine: { lineStyle: { color: GRID } },
      axisLabel: {
        color: AX,
        fontFamily: FONT,
        fontSize: 11,
        ...(pct ? { formatter: (v: number) => fmtVotePct(v) } : {}),
      },
      splitLine: { lineStyle: { color: GRID } },
    },
    yAxis: {
      type: "value",
      min: 2.5,
      max: 5,
      name: "rating",
      nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 11 },
      axisLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
      splitLine: { lineStyle: { color: GRID } },
    },
    series: [
      {
        name: "crowd",
        type: "scatter",
        symbolSize: 5,
        itemStyle: { color: "rgba(107,122,148,.28)" },
        data: crowd,
      },
      {
        name: "gems",
        type: "scatter",
        symbolSize: 11,
        itemStyle: {
          color: FOCUS,
          borderColor: "#fff",
          borderWidth: 1.5,
          shadowBlur: 6,
          shadowColor: "rgba(29,78,216,.45)",
        },
        data: gems,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: FOCUS, type: "dashed", opacity: 0.5 },
          data: [{ yAxis: 4.4, label: { formatter: "high rating", color: AX, fontSize: 11 } }],
        },
      },
    ],
  };
}

export function heatmapOption(h: FeatureHeatmap): EChartsOption {
  return {
    tooltip: {
      ...tip,
      formatter: (p: any) =>
        `${h.genres[p.value[1]]} · ${h.weeks[p.value[0]]}<br><b>${p.value[2]}</b> games`,
    },
    grid: { left: 84, right: 14, top: 10, bottom: 46 },
    xAxis: {
      type: "category",
      data: h.weeks,
      axisLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
      splitArea: { show: false },
    },
    yAxis: {
      type: "category",
      data: h.genres,
      axisLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
    },
    visualMap: {
      min: 0,
      max: Math.max(4, ...h.cells.map((c) => c.value)),
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 4,
      itemWidth: 10,
      itemHeight: 90,
      textStyle: { color: AX, fontFamily: FONT, fontSize: 11 },
      inRange: { color: INK_RAMP },
    },
    series: [
      {
        type: "heatmap",
        data: h.cells.map((c) => [c.week, c.genreIndex, c.value]),
        label: {
          show: true,
          fontFamily: FONT,
          fontSize: 11,
          fontWeight: 600,
          formatter: (p: any) => String(p.value[2]),
          color: "#1e293b",
          textBorderColor: "rgba(255,255,255,.92)",
          textBorderWidth: 2.5,
        },
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(29,78,216,.35)" } },
      },
    ],
  };
}

/** Landscape bubble weight: raw total votes on one portal, vote-weighted titles on All Browser. */
const landscapeWeight = (p: GenreLandscapePoint) => p.totalVotes ?? p.voteWeight ?? 0;
export function landscapeOption(pts: GenreLandscapePoint[]): EChartsOption {
  const pct = pts.some((p) => p.totalVotes == null && p.voteWeight != null);
  const maxV = Math.max(1e-9, ...pts.map(landscapeWeight));
  const supplies = pts.map((p) => p.supply);
  const ratings = pts.map((p) => p.p75Rating);
  const xMin = Math.max(1, Math.floor(Math.min(...supplies) * 0.6));
  const xMax = Math.ceil(Math.max(...supplies) * 1.2);
  const yMin = Math.max(0, +(Math.min(...ratings) - 0.2).toFixed(1));
  const yMax = Math.min(5, +(Math.max(...ratings) + 0.2).toFixed(1));
  const data = pts.map((p) => ({
    value: [p.supply, p.p75Rating, landscapeWeight(p), p.genre, (p.examples ?? []).join(", ")],
    symbolSize: 12 + 34 * Math.sqrt(landscapeWeight(p) / maxV),
  }));
  return {
    tooltip: {
      ...tip,
      formatter: (p: any) =>
        `<b>${p.value[3]}</b><br>${p.value[0]} games · P75 rating ${p.value[1]}<br>${Number(p.value[2]).toLocaleString()} ${pct ? "vote-weighted titles (within-portal percentile)" : "total votes"}${p.value[4] ? `<br><span style="opacity:.7">e.g. ${p.value[4]}</span>` : ""}`,
    },
    grid: { left: 64, right: 40, top: 20, bottom: 48 },
    xAxis: {
      type: "log",
      min: xMin,
      max: xMax,
      name: "supply (games) →",
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 11 },
      axisLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
      splitLine: { lineStyle: { color: GRID } },
    },
    yAxis: {
      type: "value",
      min: yMin,
      max: yMax,
      name: "quality ceiling (P75 rating)",
      nameLocation: "middle",
      nameGap: 44,
      nameRotate: 90,
      nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 11 },
      axisLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
      splitLine: { lineStyle: { color: GRID } },
    },
    series: [
      {
        type: "scatter",
        data,
        itemStyle: { color: "rgba(29,78,216,.45)", borderColor: "#1e3a5f", borderWidth: 1 },
        label: {
          show: true,
          formatter: (p: any) => p.value[3],
          position: "right",
          color: AX,
          fontFamily: FONT,
          fontSize: 11,
        },
        labelLayout: { hideOverlap: true },
      },
    ],
  };
}

// Demand vs. Supply quadrant (B3). x = supply, y = appetite, bubble = weight, colour =
// supply momentum. A median cross splits it into four zones; top-left (low supply, high
// appetite) is the underserved quadrant. Points coloured amber ("crowding") there are a
// race; green ("quiet") there is the clean opening.
const SUPPLY_COLOR: Record<string, string> = {
  rising: ATTENTION,
  steady: CONTEXT,
  cooling: FOCUS,
  quiet: POSITIVE,
};
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b),
    n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
export function quadrantOption(
  pts: QuadrantPoint[],
  // `percentile` (All Browser, #204 S4): appetite is a within-portal vote percentile, so y is a
  // bounded 0–100 linear axis read as "P62", not a log count.
  opt: { yName: string; weightName: string; percentile?: boolean },
): EChartsOption {
  const pct = !!opt.percentile;
  const yFmt = (v: number) => (pct ? fmtVotePct(v) : Number(v).toLocaleString());
  const maxW = Math.max(1e-9, ...pts.map((p) => p.weight));
  const medSupply = median(pts.map((p) => p.supply));
  const medApp = median(pts.map((p) => p.appetite));
  const data = pts.map((p) => ({
    value: [
      Math.max(p.supply, 1),
      pct ? p.appetite : Math.max(p.appetite, 1),
      p.weight,
      p.genre,
      p.supplyTrend,
    ],
    symbolSize: 12 + 30 * Math.sqrt(Math.max(p.weight, 0) / maxW),
    itemStyle: {
      color: (SUPPLY_COLOR[p.supplyTrend] ?? CONTEXT) + "cc",
      borderColor: "#fff",
      borderWidth: 1,
    },
  }));
  return {
    tooltip: {
      ...tip,
      formatter: (p: any) =>
        `<b>${p.value[3]}</b> · <span style="opacity:.7">supply ${p.value[4]}</span><br>${p.value[0]} titles · ${yFmt(Number(p.value[1]))} ${opt.yName}<br>${Number(p.value[2]).toLocaleString()} ${opt.weightName}`,
    },
    grid: { left: 64, right: 40, top: 20, bottom: 48 },
    xAxis: {
      type: "log",
      name: "supply (titles) →",
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 11 },
      axisLine: { lineStyle: { color: GRID } },
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
      splitLine: { lineStyle: { color: GRID } },
    },
    yAxis: {
      type: pct ? "value" : "log",
      ...(pct ? { min: 0, max: 100 } : {}),
      name: opt.yName + " (demand) →",
      nameLocation: "middle",
      nameGap: 48,
      nameRotate: 90,
      nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 11 },
      axisLine: { lineStyle: { color: GRID } },
      axisLabel: {
        color: AX,
        fontFamily: FONT,
        fontSize: 11,
        ...(pct ? { formatter: (v: number) => fmtVotePct(v) } : {}),
      },
      splitLine: { lineStyle: { color: GRID } },
    },
    series: [
      {
        type: "scatter",
        data,
        // Genres can still share a y value (both axes are counts, and small genres cluster), so
        // labels collide on one line. A white label chip keeps each legible, shiftY nudges
        // colliders apart vertically, and hideOverlap drops any that still touch. The severe case
        // was the old Steam demand axis: median SteamSpy OWNERS, a bucket midpoint whose lowest
        // bucket (0..20k) collapses to 10,000 and stacked nearly every genre on one line. That
        // axis is now median reviews (see getSteamGenreQuadrant), so collisions are incidental.
        label: {
          show: true,
          formatter: (p: any) => p.value[3],
          position: "right",
          color: AX,
          fontFamily: FONT,
          fontSize: 11,
          backgroundColor: "rgba(255,255,255,.82)",
          padding: [1, 3],
          borderRadius: 2,
        },
        labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
        // median-demand label sits at the line's top-right (insideEndTop), clear of the y-axis
        // tick numbers it used to overprint at the bottom-left.
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: CONTEXT, type: "dashed", opacity: 0.6 },
          data: [
            { xAxis: medSupply, label: { show: false } },
            {
              yAxis: medApp,
              label: {
                formatter: "median demand",
                color: AX,
                fontSize: 11,
                position: "insideEndTop",
              },
            },
          ],
        },
      },
    ],
  };
}

// Scale-tier distribution. Indie tiers blue, AAA greyed (it's demand-context, not benchmark).
const TIER_ORDER = ["hobby", "small_indie", "est_indie", "aaa"];
const TIER_LABEL: Record<string, string> = {
  hobby: "Hobby / solo",
  small_indie: "Small indie",
  est_indie: "Est. indie / AA",
  aaa: "AAA (context)",
};
export function tierBarOption(tiers: ScaleTierRow[]): EChartsOption {
  const map = new Map(tiers.map((t) => [t.tier, t.games]));
  // reverse so the indie tiers sit on top, AAA at the bottom of the horizontal bar
  const rows = [...TIER_ORDER].reverse().map((t) => ({ tier: t, games: map.get(t) ?? 0 }));
  return {
    tooltip: { ...tip, formatter: (p: any) => `${p.name}<br><b>${p.value}</b> games` },
    grid: { left: 124, right: 40, top: 8, bottom: 24 },
    xAxis: {
      type: "value",
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
      splitLine: { lineStyle: { color: GRID } },
    },
    yAxis: {
      type: "category",
      data: rows.map((r) => TIER_LABEL[r.tier]),
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
      axisLine: { lineStyle: { color: GRID } },
    },
    series: [
      {
        type: "bar",
        barWidth: "58%",
        data: rows.map((r) => ({
          value: r.games,
          name: r.tier,
          itemStyle: { color: r.tier === "aaa" ? "#c3cfe2" : FOCUS },
        })),
        label: {
          show: true,
          position: "right",
          color: AX,
          fontFamily: FONT,
          fontSize: 11,
          fontWeight: 600,
          formatter: (p: any) => String(p.value),
        },
      },
    ],
  };
}

/** Split a portal-grouped bar list into one group per portal, in server order (#204 S3). */
export function barsByPortal(
  bars: GenreVelocityBar[],
): { source: string; voteBasis: VoteBasis; bars: GenreVelocityBar[] }[] {
  const groups: { source: string; voteBasis: VoteBasis; bars: GenreVelocityBar[] }[] = [];
  for (const b of bars) {
    const g = groups.find((x) => x.source === b.source);
    if (g) g.bars.push(b);
    else groups.push({ source: b.source, voteBasis: b.voteBasis, bars: [b] });
  }
  return groups;
}
const signedPct1 = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

/** Genre bars for ONE vote basis. The unit follows the first bar's basis and any bar on another
 *  basis is dropped, so two units can never share this axis — split `all` with `barsByPortal`. */
export function velocityBarOption(bars: GenreVelocityBar[]): EChartsOption {
  const basis = bars[0]?.voteBasis ?? "cumulative";
  const win = basis === "window";
  const barValue = (b: GenreVelocityBar) => (win ? b.engagementPctPerWeek : b.votesPerDay) ?? 0;
  const fmtV = (v: number) => (win ? signedPct1(v) : Number(v).toLocaleString());
  const data = bars.filter((b) => b.voteBasis === basis).reverse(); // largest on top
  return {
    tooltip: {
      ...tip,
      formatter: (p: any) =>
        `${p.name}<br><b>${fmtV(Number(p.value))}</b> ${win ? "a week in recent engagement" : "votes/day"}`,
    },
    grid: { left: 116, right: 36, top: 10, bottom: 26 },
    xAxis: {
      type: "value",
      name: win ? "%/wk" : "votes/day",
      nameTextStyle: { color: AX, fontFamily: FONT, fontSize: 11 },
      axisLabel: {
        color: AX,
        fontFamily: FONT,
        fontSize: 11,
        ...(win ? { formatter: (v: number) => `${v}%` } : {}),
      },
      splitLine: { lineStyle: { color: GRID } },
    },
    yAxis: {
      type: "category",
      data: data.map((b) => b.genre),
      axisLabel: { color: AX, fontFamily: FONT, fontSize: 11 },
      axisLine: { lineStyle: { color: GRID } },
    },
    series: [
      {
        type: "bar",
        barWidth: "62%",
        data: data.map((b) => ({
          value: barValue(b),
          itemStyle: { color: barValue(b) >= 0 ? POSITIVE : NEGATIVE },
        })),
        label: {
          show: true,
          position: "right",
          color: AX,
          fontFamily: FONT,
          fontSize: 11,
          formatter: (p: any) => fmtV(Number(p.value)),
        },
      },
    ],
  };
}
