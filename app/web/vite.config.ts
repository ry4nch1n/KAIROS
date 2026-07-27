import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { shared: fileURLToPath(new URL("../shared/src/types.ts", import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy, slow-changing vendors out of the app chunk (#107 item 2,
        // completing the ECharts tree-shake in #124). ECharts + its zrender renderer
        // are by far the largest dependency; giving them their own chunk means app-code
        // edits no longer bust the ~big vendor cache entry, and — with the chart-bearing
        // panels already lazy-loaded (#106) — the echarts chunk loads on demand rather
        // than in the initial app payload. React is split too so it caches independently.
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("echarts") || id.includes("zrender")) return "echarts";
            if (id.includes("react") || id.includes("scheduler")) return "react";
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
});
