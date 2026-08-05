import { lazy, Suspense, useEffect, useState } from "react";
import { Rail, type Service } from "./components/Rail.tsx";
import { Radar } from "./services/Radar.tsx";
import { addActivated, INITIAL_ACTIVATED } from "./lib/activated.ts";
import { parseServiceHash, parseSectionHash, writeServiceHash } from "./lib/hashRoute.ts";
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
  // The fronted panel is addressable: `#brief`, `#library`, … so a view is
  // bookmarkable and survives a refresh. No router — just `location.hash` read on
  // mount and written on switch. An empty/unknown fragment resolves to Radar, so a
  // plain visit to `/` is unchanged. See lib/hashRoute.ts.
  const [svc, setSvc] = useState<Service>(() => parseServiceHash(globalThis.location?.hash));
  // Cross-panel hand-off: "project from this comparable" in Radar seeds the Revenue
  // calculator and fronts it — the one link on the gap → comparable → projection path.
  const [revSeed, setRevSeed] = useState<RevenueSeed | null>(null);
  // Panels that have ever been fronted. A panel mounts lazily on first activation and
  // stays mounted (hidden) thereafter, so in-panel state survives tab switches and the
  // skeleton only ever shows on the first open. See lib/activated.ts. A deep-linked
  // panel counts as activated from first paint, so it mounts without a rail click.
  const [activated, setActivated] = useState<Set<Service>>(() =>
    addActivated(new Set(INITIAL_ACTIVATED), svc),
  );
  // The section within the fronted panel (`#radar/comparables`). Panels own their
  // own section vocabulary, so this is a plain slug: each panel reads it, matches
  // it against its own list, and ignores what it doesn't recognise.
  const [section, setSection] = useState<string | null>(() =>
    parseSectionHash(globalThis.location?.hash),
  );
  const select = (next: Service) => {
    setActivated((prev) => addActivated(prev, next));
    setSvc(next);
    setSection(null);
    writeServiceHash(next);
  };
  // A panel reporting the section the user moved to, so the URL follows in-panel
  // navigation and Back undoes a section move instead of leaving the service.
  const selectSection = (svc: Service, next: string | null) => {
    setSection(next);
    writeServiceHash(svc, next);
  };
  // Browser back/forward (and a hand-edited fragment) move between panels.
  useEffect(() => {
    const onHashChange = () => {
      const next = parseServiceHash(globalThis.location?.hash);
      setActivated((prev) => addActivated(prev, next));
      setSvc(next);
      setSection(parseSectionHash(globalThis.location?.hash));
    };
    globalThis.addEventListener("hashchange", onHashChange);
    return () => globalThis.removeEventListener("hashchange", onHashChange);
  }, []);
  return (
    <div className="shell">
      <Rail active={svc} onSelect={select} />
      <Radar
        hidden={svc !== "radar"}
        section={svc === "radar" ? section : null}
        onSection={(s) => selectSection("radar", s)}
        onGoto={(to) => select(to)}
        onProject={(s) => {
          setRevSeed(s);
          select("revenue");
        }}
      />
      {activated.has("brief") && (
        <Suspense fallback={<PanelSkeleton />}>
          <Brief hidden={svc !== "brief"} onGoto={(to) => select(to)} />
        </Suspense>
      )}
      {activated.has("library") && (
        <Suspense fallback={<PanelSkeleton />}>
          <Library
            hidden={svc !== "library"}
            section={svc === "library" ? section : null}
            onSection={(s) => selectSection("library", s)}
            onGoto={(to) => select(to)}
          />
        </Suspense>
      )}
      {activated.has("revenue") && (
        <Suspense fallback={<PanelSkeleton />}>
          <Revenue
            hidden={svc !== "revenue"}
            seed={revSeed}
            onClearSeed={() => setRevSeed(null)}
            onGoto={(to) => select(to)}
          />
        </Suspense>
      )}
    </div>
  );
}
