import { useState } from "react";
import { useDrawer, NavToggle, NavScrim, DrawerClose } from "../components/MobileNav.tsx";
import {
  GENRE_PRESETS,
  dailyRevenue,
  monthlyRevenue,
  payoutMultiplier,
  targetBandUsd,
  verdict,
  TARGET_SGD,
  DEFAULT_SGD_PER_USD,
} from "../lib/revenue.ts";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const VERDICT_COPY: Record<string, { label: string; cls: string }> = {
  below: { label: "Below target", cls: "below" },
  "in-band": { label: "Hits the SGD 4–5k target", cls: "in-band" },
  above: { label: "Clears the target", cls: "above" },
};

export function Revenue({ hidden }: { hidden: boolean }) {
  const drawer = useDrawer();
  const [genre, setGenre] = useState(GENRE_PRESETS[1].id); // Automation/Logistics
  const [dau, setDau] = useState(900);
  const [arpdau, setArpdau] = useState(GENRE_PRESETS[1].arpdau);
  const [directShare, setDirectShare] = useState(1);
  const [rate, setRate] = useState(DEFAULT_SGD_PER_USD);

  const inputs = { dau, arpdau, directShare };
  const daily = dailyRevenue(inputs);
  const monthly = monthlyRevenue(inputs);
  const band = targetBandUsd(rate);
  const v = VERDICT_COPY[verdict(monthly, rate)];
  const mult = payoutMultiplier(directShare);
  const monthlySgd = monthly * rate;
  const pctToGoal = Math.min(999, Math.round((monthly / band.low) * 100));

  const pickGenre = (id: string) => {
    setGenre(id);
    const g = GENRE_PRESETS.find((p) => p.id === id);
    if (g) setArpdau(g.arpdau);
  };

  return (
    <section className="service" data-svc="revenue" hidden={hidden}>
      <aside
        className={"side" + (drawer.open ? " open" : "")}
        onClick={(e) => { if ((e.target as HTMLElement).closest(".nav-item")) drawer.closeDrawer(); }}
      >
        <DrawerClose onClick={drawer.closeDrawer} />
        <div className="side-head">
          <b>Revenue Model</b>
          <span>browser income dial</span>
        </div>
        <div className="nav-label">Genre ARPDAU preset</div>
        {GENRE_PRESETS.map((g) => (
          <a
            className={"nav-item" + (g.id === genre ? " active" : "")}
            key={g.id}
            onClick={() => pickGenre(g.id)}
          >
            {g.label}
            <span className="badge" style={{ background: "var(--primary)" }}>${g.arpdau.toFixed(2)}</span>
          </a>
        ))}
        <div className="side-foot">
          Poki payout · direct 100% / platform-sourced 50-50 · target SGD {TARGET_SGD.low / 1000}–{TARGET_SGD.high / 1000}k/mo
        </div>
      </aside>
      <NavScrim open={drawer.open} onClose={drawer.closeDrawer} />

      <main className="main">
        <div className="topbar">
          <NavToggle onClick={drawer.openDrawer} />
          <h2>
            Revenue Model <small>project browser income against the SGD 4–5k/mo goal</small>
          </h2>
        </div>

        <div className="content">
          <div className="kpi-row">
            <div className="kpi">
              <div className="label">Monthly revenue (USD)</div>
              <div className="kpi-big">{usd(monthly)}</div>
              <div className="kpi-sub">≈ SGD {Math.round(monthlySgd).toLocaleString("en-US")} · {usd(daily)}/day</div>
            </div>
            <div className="kpi">
              <div className="label">Target band (USD)</div>
              <div className="kpi-big">{usd(band.low)}–{usd(band.high)}</div>
              <div className="kpi-sub">SGD {TARGET_SGD.low.toLocaleString()}–{TARGET_SGD.high.toLocaleString()} @ {rate.toFixed(2)}/USD</div>
            </div>
            <div className="kpi">
              <div className="label">Verdict</div>
              <div className={"rev-verdict " + v.cls}>{v.label}</div>
              <div className="kpi-sub">{pctToGoal}% of the SGD 4k floor</div>
            </div>
          </div>

          <div className="rev-panel">
            <label className="rev-field">
              <span>Daily active users (DAU)</span>
              <input type="number" min={0} value={dau} onChange={(e) => setDau(Math.max(0, +e.target.value))} />
            </label>
            <label className="rev-field">
              <span>ARPDAU (USD) — {GENRE_PRESETS.find((g) => g.id === genre)?.label}</span>
              <input type="number" min={0} step={0.01} value={arpdau} onChange={(e) => setArpdau(Math.max(0, +e.target.value))} />
            </label>
            <label className="rev-field">
              <span>Direct traffic share — {Math.round(directShare * 100)}% (payout ×{mult.toFixed(2)})</span>
              <input type="range" min={0} max={1} step={0.05} value={directShare} onChange={(e) => setDirectShare(+e.target.value)} />
            </label>
            <label className="rev-field">
              <span>FX rate (SGD per USD)</span>
              <input type="number" min={0.5} step={0.01} value={rate} onChange={(e) => setRate(Math.max(0.5, +e.target.value))} />
            </label>
            <p className="rev-note">
              Direct players (your own traffic) keep 100% of ad revenue; players the platform sends you
              are a 50-50 split — so the traffic mix moves income as much as the audience size does.
            </p>
          </div>
        </div>
      </main>
    </section>
  );
}
