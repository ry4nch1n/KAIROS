// Tree-shaken ECharts registration. Instead of `import * as echarts from "echarts"`
// (which pulls every chart type + renderer into one ~1.2 MB chunk), we import the
// modular `echarts/core` and register ONLY the pieces the dashboard actually uses.
//
// The catch: ECharts silently no-ops a chart whose `series.type` or a needed component
// (grid/axes, tooltip, legend, visualMap, markLine, …) isn't registered — it renders
// blank with a green build. So the two maps below are the single source of truth for
// what is registered, and `echartRegistry.test.ts` asserts every series type and every
// component-bearing option key produced by `charts.ts` is a key here.
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, ScatterChart, TreemapChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// `series.type` value -> chart module. Every series type built in charts.ts must appear here.
const CHART_MODULES = {
  bar: BarChart,
  heatmap: HeatmapChart,
  line: LineChart,
  scatter: ScatterChart,
  treemap: TreemapChart,
} as const;

// Option feature key -> component module. Keys are the option-shape signals a coverage
// test scans for: top-level keys (grid/xAxis/yAxis/tooltip/legend/visualMap) plus the
// series-level `markLine`. xAxis, yAxis and grid all come from GridComponent — the shared
// module is deduped before `use()`. TooltipComponent pulls in AxisPointer itself, so
// `tooltip.trigger:"axis"` needs no extra registration.
const COMPONENT_MODULES = {
  grid: GridComponent,
  xAxis: GridComponent,
  yAxis: GridComponent,
  tooltip: TooltipComponent,
  legend: LegendComponent,
  visualMap: VisualMapComponent,
  markLine: MarkLineComponent,
} as const;

echarts.use([
  CanvasRenderer,
  ...new Set<Parameters<typeof echarts.use>[0]>([
    ...Object.values(CHART_MODULES),
    ...Object.values(COMPONENT_MODULES),
  ]),
]);

// Exported for the coverage test — kept in lock-step with the actual registration above
// because they are derived from the very maps passed to `echarts.use()`.
export const REGISTERED_CHART_TYPES: ReadonlySet<string> = new Set(Object.keys(CHART_MODULES));
export const REGISTERED_COMPONENT_KEYS: ReadonlySet<string> = new Set(
  Object.keys(COMPONENT_MODULES),
);

export { echarts };
