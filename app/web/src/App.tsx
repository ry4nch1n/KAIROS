import { lazy, Suspense, useState } from "react";
import { Rail, type Service } from "./components/Rail.tsx";
import { Radar } from "./services/Radar.tsx";
import { addActivated, INITIAL_ACTIVATED } from "./lib/activated.ts";
import type { RevenueSeed } from "./lib/steamRevenue.ts";

// Radar is the default tab: eager-imported so it paints immediately, no Suspense.
// The other three panels are chart/data-heavy and hidden on first load, so they're
// code-split and lazy-mounted on first activation — this keeps their JS out of the
// initial bundle AND stops their mount-effect fetches from running while hidden.
const Brief = lazy(() => import("./services/Brief.tsx").then((m) => ({ default: m.Brief })));
const Library = lazy(() => import("./services/Library.tsx").then((m) => ({ default: m.Library })));
const Revenue = lazy(() => import("./services/Revenue.tsx").then((m) => ({ default: m.Revenue })));

// Shown only on the very first open of a lazy panel, while its chunk loads. Spans
// the full service grid so there's no layout jump; max-width keeps it 375px-safe.
function PanelSkeleton() {
  return (
    <section className="service" aria-busy="true" data-loading="true">
      <div style={{ gridColumn: "1 / -1", padding: 22 }}>
        <div className="skeleton" style={{ height: 240, maxWidth: "100%" }} />
      </div>
    </section>
  );
}

export default function App() {
  const [svc, setSvc] = useState<Service>("radar");
  // Cross-panel hand-off: "project from this comparable" in Radar seeds the Revenue
  // calculator and fronts it — the one link on the gap → comparable → projection path.
  const [revSeed, setRevSeed] = useState<RevenueSeed | null>(null);
  // Panels that have ever been fronted. A panel mounts lazily on first activation and
  // stays mounted (hidden) thereafter, so in-panel state survives tab switches and the
  // skeleton only ever shows on the first open. See lib/activated.ts.
  const [activated, setActivated] = useState<Set<Service>>(() => new Set(INITIAL_ACTIVATED));
  const select = (next: Service) => {
    setActivated((prev) => addActivated(prev, next));
    setSvc(next);
  };
  return (
    <div className="shell">
      <Rail active={svc} onSelect={select} />
      <Radar
        hidden={svc !== "radar"}
        onProject={(s) => {
          setRevSeed(s);
          select("revenue");
        }}
      />
      {activated.has("brief") && (
        <Suspense fallback={<PanelSkeleton />}>
          <Brief hidden={svc !== "brief"} />
        </Suspense>
      )}
      {activated.has("library") && (
        <Suspense fallback={<PanelSkeleton />}>
          <Library hidden={svc !== "library"} />
        </Suspense>
      )}
      {activated.has("revenue") && (
        <Suspense fallback={<PanelSkeleton />}>
          <Revenue hidden={svc !== "revenue"} seed={revSeed} onClearSeed={() => setRevSeed(null)} />
        </Suspense>
      )}
    </div>
  );
}
