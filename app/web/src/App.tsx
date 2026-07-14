import { useState } from "react";
import { Rail, type Service } from "./components/Rail.tsx";
import { Radar } from "./services/Radar.tsx";
import { Brief } from "./services/Brief.tsx";
import { Library } from "./services/Library.tsx";
import { Revenue } from "./services/Revenue.tsx";
import type { RevenueSeed } from "./lib/steamRevenue.ts";

export default function App() {
  const [svc, setSvc] = useState<Service>("radar");
  // Cross-panel hand-off: "project from this comparable" in Radar seeds the Revenue
  // calculator and fronts it — the one link on the gap → comparable → projection path.
  const [revSeed, setRevSeed] = useState<RevenueSeed | null>(null);
  return (
    <div className="shell">
      <Rail active={svc} onSelect={setSvc} />
      <Radar
        hidden={svc !== "radar"}
        onProject={(s) => {
          setRevSeed(s);
          setSvc("revenue");
        }}
      />
      <Brief hidden={svc !== "brief"} />
      <Library hidden={svc !== "library"} />
      <Revenue hidden={svc !== "revenue"} seed={revSeed} onClearSeed={() => setRevSeed(null)} />
    </div>
  );
}
