import { useEffect, useRef } from "react";
import * as echarts from "echarts";

// Resizes via ResizeObserver so charts redraw correctly when their service
// switches from display:none back to visible.
export function EChart({ option, style }: { option: echarts.EChartsOption; style?: React.CSSProperties }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current);
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={el} className="chart" style={style} />;
}
