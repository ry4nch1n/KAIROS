import { useState } from "react";
import { Rail, type Service } from "./components/Rail.tsx";
import { Radar } from "./services/Radar.tsx";
import { Brief } from "./services/Brief.tsx";
import { Library } from "./services/Library.tsx";

export default function App() {
  const [svc, setSvc] = useState<Service>("radar");
  return (
    <div className="shell">
      <Rail active={svc} onSelect={setSvc} />
      <Radar hidden={svc !== "radar"} />
      <Brief hidden={svc !== "brief"} />
      <Library hidden={svc !== "library"} />
    </div>
  );
}
