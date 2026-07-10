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
import {
  ENGINES,
  engine as getEngine,
  steamProjection,
  STEAM_DEFAULTS,
  type EngineId,
} from "../lib/steamRevenue.ts";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const sgd = (n: number) => "SGD " + Math.round(n).toLocaleString("en-US");
const pct = (n: number) => Math.round(n * 100) + "%";

type Mode = "browser" | "steam";

/** Browser | Steam sub-selection, shown in each panel's topbar. */
function ModeSeg({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="seg" style={{ marginLeft: "auto" }}>
      <button className={"seg-btn" + (mode === "browser" ? " active" : "")} onClick={() => setMode("browser")}>
        Browser
      </button>
      <button className={"seg-btn" + (mode === "steam" ? " active" : "")} onClick={() => setMode("steam")}>
        Steam
      </button>
    </div>
  );
}

export function Revenue({ hidden }: { hidden: boolean }) {
  const [mode, setMode] = useState<Mode>("browser");
  return (
    <section className="service" data-svc="revenue" hidden={hidden}>
      {mode === "browser" ? (
        <BrowserPanel mode={mode} setMode={setMode} />
      ) : (
        <SteamPanel mode={mode} setMode={setMode} />
      )}
    </section>
  );
}

// ─── Browser: ad-income dial (unchanged model, now one of two sub-tabs) ──────────
function BrowserPanel({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
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
  const VERDICT_COPY: Record<string, { label: string; cls: string }> = {
    below: { label: "Below target", cls: "below" },
    "in-band": { label: "Hits the SGD 4–5k target", cls: "in-band" },
    above: { label: "Clears the target", cls: "above" },
  };
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
    <>
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
          <a className={"nav-item" + (g.id === genre ? " active" : "")} key={g.id} onClick={() => pickGenre(g.id)}>
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
          <ModeSeg mode={mode} setMode={setMode} />
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
    </>
  );
}

// ─── Steam: premium net-revenue projection (wishlists → net, engine-aware) ───────
const ENGINE_BADGE: Record<EngineId, string> = {
  godot: "free",
  unity: "$200k+",
  unreal: "5% >$1M",
};

function SteamPanel({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const drawer = useDrawer();
  const [engineId, setEngineId] = useState<EngineId>("godot");
  const [wishlists, setWishlists] = useState(STEAM_DEFAULTS.wishlists);
  const [conversion, setConversion] = useState(STEAM_DEFAULTS.conversion);
  const [priceUsd, setPriceUsd] = useState(STEAM_DEFAULTS.priceUsd);
  const [refundRate, setRefundRate] = useState(STEAM_DEFAULTS.refundRate);
  const [storeCut, setStoreCut] = useState(STEAM_DEFAULTS.storeCut);
  const [seats, setSeats] = useState(STEAM_DEFAULTS.seats);
  const [licenseYears, setLicenseYears] = useState(STEAM_DEFAULTS.licenseYears);
  const [sgdPerUsd, setSgdPerUsd] = useState(STEAM_DEFAULTS.sgdPerUsd);

  const eng = getEngine(engineId);
  const p = steamProjection({
    wishlists, conversion, priceUsd, refundRate, storeCut, engineId, seats, licenseYears, sgdPerUsd,
  });
  const units = Math.round(p.units);

  return (
    <>
      <aside
        className={"side" + (drawer.open ? " open" : "")}
        onClick={(e) => { if ((e.target as HTMLElement).closest(".nav-item")) drawer.closeDrawer(); }}
      >
        <DrawerClose onClick={drawer.closeDrawer} />
        <div className="side-head">
          <b>Revenue Model</b>
          <span>steam premium net</span>
        </div>
        <div className="nav-label">Game engine</div>
        {ENGINES.map((e) => (
          <a className={"nav-item" + (e.id === engineId ? " active" : "")} key={e.id} onClick={() => setEngineId(e.id)}>
            {e.label}
            <span className="badge" style={{ background: "var(--primary)" }}>{ENGINE_BADGE[e.id]}</span>
          </a>
        ))}
        <div className="side-foot">
          Godot free · Unreal 5% of gross &gt; $1M · Unity Pro seat &gt; $200k (fixed cost, not a split)
        </div>
      </aside>
      <NavScrim open={drawer.open} onClose={drawer.closeDrawer} />

      <main className="main">
        <div className="topbar">
          <NavToggle onClick={drawer.openDrawer} />
          <h2>
            Revenue Model <small>project Steam premium net revenue, after Steam's cut, refunds &amp; engine terms</small>
          </h2>
          <ModeSeg mode={mode} setMode={setMode} />
        </div>

        <div className="content">
          <div className="kpi-row">
            <div className="kpi">
              <div className="label">Net revenue (USD)</div>
              <div className="kpi-big">{usd(p.netUsd)}</div>
              <div className="kpi-sub">≈ {sgd(p.netSgd)} · {units.toLocaleString("en-US")} units</div>
            </div>
            <div className="kpi">
              <div className="label">Net per unit (USD)</div>
              <div className="kpi-big">${p.netPerUnitUsd.toFixed(2)}</div>
              <div className="kpi-sub">take-rate {pct(p.takeRate)} of gross · list ${priceUsd.toFixed(2)}</div>
            </div>
            <div className="kpi">
              <div className="label">{eng.label} engine toll</div>
              <div className={"rev-verdict " + (p.engineCost > 0 ? "below" : "above")}>
                {p.engineCost > 0 ? "−" + usd(p.engineCost) : "none"}
              </div>
              <div className="kpi-sub">
                {p.engineRoyalty > 0 && "royalty " + usd(p.engineRoyalty)}
                {p.engineRoyalty > 0 && p.engineLicense > 0 && " · "}
                {p.engineLicense > 0 && "Pro seats " + usd(p.engineLicense)}
                {p.engineCost === 0 && "no royalty or seat fee at this scale"}
              </div>
            </div>
          </div>

          <div className="rev-panel">
            <label className="rev-field">
              <span>Wishlists at launch</span>
              <input type="number" min={0} value={wishlists} onChange={(e) => setWishlists(Math.max(0, +e.target.value))} />
            </label>
            <label className="rev-field">
              <span>Wishlist → sale conversion ({conversion.toFixed(2)}×)</span>
              <input type="number" min={0} max={2} step={0.01} value={conversion} onChange={(e) => setConversion(Math.max(0, +e.target.value))} />
            </label>
            <label className="rev-field">
              <span>List price (USD)</span>
              <input type="number" min={0} step={0.5} value={priceUsd} onChange={(e) => setPriceUsd(Math.max(0, +e.target.value))} />
            </label>
            <label className="rev-field">
              <span>Refund rate — {Math.round(refundRate * 100)}%</span>
              <input type="range" min={0} max={0.25} step={0.01} value={refundRate} onChange={(e) => setRefundRate(+e.target.value)} />
            </label>
            <label className="rev-field">
              <span>Steam cut — {Math.round(storeCut * 100)}%</span>
              <input type="range" min={0} max={0.4} step={0.01} value={storeCut} onChange={(e) => setStoreCut(+e.target.value)} />
            </label>
            {engineId === "unity" && (
              <label className="rev-field">
                <span>Unity Pro seats × years — {seats} × {licenseYears}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" min={1} value={seats} onChange={(e) => setSeats(Math.max(1, +e.target.value))} />
                  <input type="number" min={1} value={licenseYears} onChange={(e) => setLicenseYears(Math.max(1, +e.target.value))} />
                </div>
              </label>
            )}
            <label className="rev-field">
              <span>FX rate (SGD per USD)</span>
              <input type="number" min={0.5} step={0.01} value={sgdPerUsd} onChange={(e) => setSgdPerUsd(Math.max(0.5, +e.target.value))} />
            </label>
            <p className="rev-note">
              {units.toLocaleString("en-US")} units × ${priceUsd.toFixed(2)} = {usd(p.grossList)} list → {usd(p.grossRevenue)} after refunds
              → −{usd(p.storeFee)} Steam cut{p.engineCost > 0 ? " → −" + usd(p.engineCost) + " " + eng.label : ""} = <b>{usd(p.netUsd)}</b> net.
              &nbsp;{eng.note}
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
