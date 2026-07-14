import { useEffect, useState } from "react";
import { useDrawer, NavToggle, NavScrim, DrawerClose } from "../components/MobileNav.tsx";
import {
  GENRE_PRESETS,
  dailyRevenue,
  monthlyRevenue,
  payoutMultiplier,
  targetBandUsd,
  verdict,
  monthsOfTarget,
  loadTargetSgd,
  saveTargetSgd,
  DEFAULT_SGD_PER_USD,
  type TargetBand,
} from "../lib/revenue.ts";
import {
  ENGINES,
  engine as getEngine,
  steamProjection,
  scenarioBand,
  STEAM_DEFAULTS,
  type EngineId,
  type RevenueSeed,
} from "../lib/steamRevenue.ts";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const sgd = (n: number) => "SGD " + Math.round(n).toLocaleString("en-US");
const pct = (n: number) => Math.round(n * 100) + "%";
const fmtOwners = (n: number | null) =>
  n == null
    ? "—"
    : n >= 1e6
      ? (n / 1e6).toFixed(2) + "M"
      : n >= 1e3
        ? Math.round(n / 1e3) + "K"
        : String(n);

type Mode = "browser" | "steam";

/** Browser | Steam platform switch — mirrors GameRadar's top-of-panel platform selector
 *  (labeled group + coloured dots) so the two dashboards read the same, instead of a bare
 *  seg tucked in the far corner. */
function ModeSeg({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="platform-groups" role="tablist" aria-label="Platform">
      <div className="seg-group">
        <span className="seg-group-label">Platform</span>
        <div className="seg">
          <button
            className={"seg-btn" + (mode === "browser" ? " active" : "")}
            role="tab"
            aria-selected={mode === "browser"}
            onClick={() => setMode("browser")}
          >
            <span className="dot all"></span>Browser
          </button>
          <button
            className={"seg-btn" + (mode === "steam" ? " active" : "")}
            role="tab"
            aria-selected={mode === "steam"}
            onClick={() => setMode("steam")}
          >
            <span className="dot steam"></span>Steam
          </button>
        </div>
      </div>
    </div>
  );
}

export function Revenue({
  hidden,
  seed,
  onClearSeed,
}: {
  hidden: boolean;
  seed?: RevenueSeed | null;
  onClearSeed?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("browser");
  // A comparable projected from Radar is a Steam anchor — front the Steam panel for it.
  useEffect(() => {
    if (seed) setMode("steam");
  }, [seed]);
  // The monthly target is personal: nothing ships in the bundle; it's set on the widget
  // and persisted only in this browser (the real P&L targets live in Notion).
  const [target, setTargetState] = useState<TargetBand | null>(() => loadTargetSgd());
  const setTarget = (t: TargetBand | null) => {
    setTargetState(t);
    saveTargetSgd(t);
  };
  return (
    <section className="service" data-svc="revenue" hidden={hidden}>
      {mode === "browser" ? (
        <BrowserPanel mode={mode} setMode={setMode} target={target} setTarget={setTarget} />
      ) : (
        <SteamPanel
          mode={mode}
          setMode={setMode}
          seed={seed}
          onClearSeed={onClearSeed}
          target={target}
        />
      )}
    </section>
  );
}

// ─── Browser: ad-income dial (unchanged model, now one of two sub-tabs) ──────────
function BrowserPanel({
  mode,
  setMode,
  target,
  setTarget,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  target: TargetBand | null;
  setTarget: (t: TargetBand | null) => void;
}) {
  const drawer = useDrawer();
  const [genre, setGenre] = useState(GENRE_PRESETS[1].id); // Automation/Logistics
  const [dau, setDau] = useState(900);
  const [arpdau, setArpdau] = useState(GENRE_PRESETS[1].arpdau);
  const [directShare, setDirectShare] = useState(1);
  const [rate, setRate] = useState(DEFAULT_SGD_PER_USD);

  const inputs = { dau, arpdau, directShare };
  const daily = dailyRevenue(inputs);
  const monthly = monthlyRevenue(inputs);
  const band = target ? targetBandUsd(rate, target) : null;
  const VERDICT_COPY: Record<string, { label: string; cls: string }> = {
    "no-target": { label: "No target set", cls: "none" },
    below: { label: "Below target", cls: "below" },
    "in-band": { label: "Hits the target band", cls: "in-band" },
    above: { label: "Clears the target", cls: "above" },
  };
  const v = VERDICT_COPY[verdict(monthly, rate, target)];
  const mult = payoutMultiplier(directShare);
  const monthlySgd = monthly * rate;
  const pctToGoal = band ? Math.min(999, Math.round((monthly / band.low) * 100)) : null;

  // Target edits: the low bound drives the verdict floor; clearing low clears the band.
  const setLow = (v: number) =>
    v > 0 ? setTarget({ low: v, high: Math.max(v, target?.high ?? v) }) : setTarget(null);
  const setHigh = (v: number) => {
    if (!target) {
      if (v > 0) setTarget({ low: v, high: v });
      return;
    }
    setTarget({ low: target.low, high: Math.max(target.low, v) });
  };

  const pickGenre = (id: string) => {
    setGenre(id);
    const g = GENRE_PRESETS.find((p) => p.id === id);
    if (g) setArpdau(g.arpdau);
  };

  return (
    <>
      <aside
        className={"side" + (drawer.open ? " open" : "")}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".nav-item")) drawer.closeDrawer();
        }}
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
            <span className="badge" style={{ background: "var(--primary)" }}>
              ${g.arpdau.toFixed(2)}
            </span>
          </a>
        ))}
        <div className="side-foot">
          Poki payout · direct 100% / platform-sourced 50-50 · target set on the widget, stored in
          this browser only
        </div>
      </aside>
      <NavScrim open={drawer.open} onClose={drawer.closeDrawer} />

      <main className="main">
        <div className="topbar">
          <NavToggle onClick={drawer.openDrawer} />
          <h2>
            Revenue Model <small>project browser income against your monthly target</small>
          </h2>
          <ModeSeg mode={mode} setMode={setMode} />
        </div>

        <div className="content">
          <div className="kpi-row">
            <div className="kpi">
              <div className="label">Monthly revenue (USD)</div>
              <div className="kpi-big">{usd(monthly)}</div>
              <div className="kpi-sub">
                ≈ SGD {Math.round(monthlySgd).toLocaleString("en-US")} · {usd(daily)}/day
              </div>
            </div>
            <div className="kpi">
              <div className="label">Monthly target (SGD)</div>
              <div className="target-edit">
                <input
                  type="number"
                  min={0}
                  placeholder="low"
                  aria-label="Target band low (SGD/month)"
                  value={target?.low ?? ""}
                  onChange={(e) => setLow(+e.target.value)}
                />
                <span className="target-dash">–</span>
                <input
                  type="number"
                  min={0}
                  placeholder="high"
                  aria-label="Target band high (SGD/month)"
                  value={target?.high ?? ""}
                  onChange={(e) => setHigh(+e.target.value)}
                />
              </div>
              <div className="kpi-sub">
                {band ? (
                  <>
                    ≈ {usd(band.low)}–{usd(band.high)} @ {rate.toFixed(2)}/USD · stored in this
                    browser only
                  </>
                ) : (
                  <>not set — enter a monthly income band to judge projections against</>
                )}
              </div>
            </div>
            <div className="kpi">
              <div className="label">Verdict</div>
              <div className={"rev-verdict " + v.cls}>{v.label}</div>
              <div className="kpi-sub">
                {pctToGoal !== null
                  ? `${pctToGoal}% of the target floor`
                  : "set a monthly band to get a verdict"}
              </div>
            </div>
          </div>

          <div className="rev-panel">
            <label className="rev-field">
              <span>Daily active users (DAU)</span>
              <input
                type="number"
                min={0}
                value={dau}
                onChange={(e) => setDau(Math.max(0, +e.target.value))}
              />
            </label>
            <label className="rev-field">
              <span>ARPDAU (USD) — {GENRE_PRESETS.find((g) => g.id === genre)?.label}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={arpdau}
                onChange={(e) => setArpdau(Math.max(0, +e.target.value))}
              />
            </label>
            <label className="rev-field">
              <span>
                Direct traffic share — {Math.round(directShare * 100)}% (payout ×{mult.toFixed(2)})
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={directShare}
                onChange={(e) => setDirectShare(+e.target.value)}
              />
            </label>
            <label className="rev-field">
              <span>FX rate (SGD per USD)</span>
              <input
                type="number"
                min={0.5}
                step={0.01}
                value={rate}
                onChange={(e) => setRate(Math.max(0.5, +e.target.value))}
              />
            </label>
            <p className="rev-note">
              Direct players (your own traffic) keep 100% of ad revenue; players the platform sends
              you are a 50-50 split — so the traffic mix moves income as much as the audience size
              does.
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

function SteamPanel({
  mode,
  setMode,
  seed,
  onClearSeed,
  target,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  seed?: RevenueSeed | null;
  onClearSeed?: () => void;
  target: TargetBand | null;
}) {
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

  // Anchor prefill (A3): the comparable's real list price replaces the default dial.
  // Only price — wishlists stay yours to reason about; the anchor strip shows the
  // comparable's actual outcome for calibration instead of inventing a wishlist count.
  useEffect(() => {
    if (seed?.priceCents != null && seed.priceCents > 0)
      setPriceUsd(+(seed.priceCents / 100).toFixed(2));
  }, [seed]);

  const inputs = {
    wishlists,
    conversion,
    priceUsd,
    refundRate,
    storeCut,
    engineId,
    seats,
    licenseYears,
    sgdPerUsd,
  };
  const eng = getEngine(engineId);
  const p = steamProjection(inputs);
  const band = scenarioBand(inputs);
  const units = Math.round(p.units);
  const anchorGross =
    seed && seed.owners != null && seed.priceCents != null
      ? seed.owners * (seed.priceCents / 100)
      : null;
  // A Steam net is a lump sum, not monthly income — express it against the same target
  // as months of the floor covered, so both panels answer the one goal coherently.
  const months = (netSgd: number): string | null => {
    const m = monthsOfTarget(netSgd, target);
    return m === null
      ? null
      : "covers ~" + (m >= 10 ? Math.round(m) : +m.toFixed(1)) + " mo of target";
  };

  return (
    <>
      <aside
        className={"side" + (drawer.open ? " open" : "")}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".nav-item")) drawer.closeDrawer();
        }}
      >
        <DrawerClose onClick={drawer.closeDrawer} />
        <div className="side-head">
          <b>Revenue Model</b>
          <span>steam premium net</span>
        </div>
        <div className="nav-label">Game engine</div>
        {ENGINES.map((e) => (
          <a
            className={"nav-item" + (e.id === engineId ? " active" : "")}
            key={e.id}
            onClick={() => setEngineId(e.id)}
          >
            {e.label}
            <span className="badge" style={{ background: "var(--primary)" }}>
              {ENGINE_BADGE[e.id]}
            </span>
          </a>
        ))}
        <div className="side-foot">
          Pick the engine <b>you'll ship on</b> — this models your build, not any comparable's.
          Godot free · Unreal 5% of gross &gt; $1M · Unity Pro seat &gt; $200k (fixed cost, not a
          split)
        </div>
      </aside>
      <NavScrim open={drawer.open} onClose={drawer.closeDrawer} />

      <main className="main">
        <div className="topbar">
          <NavToggle onClick={drawer.openDrawer} />
          <h2>
            Revenue Model{" "}
            <small>
              project Steam premium net revenue, after Steam's cut, refunds &amp; engine terms
            </small>
          </h2>
          <ModeSeg mode={mode} setMode={setMode} />
        </div>

        <div className="content">
          {seed && (
            <div className="anchor-strip">
              <div className="anchor-body">
                <b>Anchored to {seed.title}</b> — {fmtOwners(seed.owners)} owners × $
                {seed.priceCents != null ? (seed.priceCents / 100).toFixed(2) : "—"}
                {anchorGross != null && (
                  <>
                    {" "}
                    ≈ <b>{usd(anchorGross)}</b> lifetime gross proxy
                  </>
                )}
                {seed.votes != null && <> · {seed.votes.toLocaleString("en-US")} reviews</>}
                {seed.reviewVelocity != null && <> · +{seed.reviewVelocity}/day</>}
                <span className="anchor-note">
                  price prefilled from this comparable · owners are SteamSpy bucket midpoints — an
                  anchor for calibration, not a forecast · engine &amp; wishlists model <b>your</b>{" "}
                  build, not {seed.title}'s
                </span>
              </div>
              {onClearSeed && (
                <button
                  type="button"
                  className="anchor-clear"
                  onClick={onClearSeed}
                  aria-label="Clear anchor"
                >
                  ×
                </button>
              )}
            </div>
          )}
          <div className="kpi-row">
            <div className="kpi">
              <div className="label">Net revenue (USD)</div>
              <div className="kpi-big">{usd(p.netUsd)}</div>
              <div className="kpi-sub">
                ≈ {sgd(p.netSgd)} · {units.toLocaleString("en-US")} units
              </div>
            </div>
            <div className="kpi">
              <div className="label">Net per unit (USD)</div>
              <div className="kpi-big">${p.netPerUnitUsd.toFixed(2)}</div>
              <div className="kpi-sub">
                take-rate {pct(p.takeRate)} of gross · list ${priceUsd.toFixed(2)}
              </div>
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
                <span className="kpi-note">
                  {" "}
                  · assumes you ship on {eng.label} — your build, not the comparable's
                </span>
              </div>
            </div>
          </div>

          <div className="rev-band" role="group" aria-label="Conversion scenario band">
            <div className="band-tile band-pess">
              <span className="band-label">Pessimistic · {(conversion * 0.5).toFixed(2)}×</span>
              <b className="band-net">{usd(band.pessimistic.netUsd)}</b>
              <span className="band-sub">{sgd(band.pessimistic.netSgd)}</span>
              {months(band.pessimistic.netSgd) && (
                <span className="band-months">{months(band.pessimistic.netSgd)}</span>
              )}
            </div>
            <div className="band-tile band-base">
              <span className="band-label">Base · {conversion.toFixed(2)}×</span>
              <b className="band-net">{usd(band.base.netUsd)}</b>
              <span className="band-sub">{sgd(band.base.netSgd)}</span>
              {months(band.base.netSgd) && (
                <span className="band-months">{months(band.base.netSgd)}</span>
              )}
            </div>
            <div className="band-tile band-opt">
              <span className="band-label">Optimistic · {(conversion * 2).toFixed(2)}×</span>
              <b className="band-net">{usd(band.optimistic.netUsd)}</b>
              <span className="band-sub">{sgd(band.optimistic.netSgd)}</span>
              {months(band.optimistic.netSgd) && (
                <span className="band-months">{months(band.optimistic.netSgd)}</span>
              )}
            </div>
            <p className="band-note">
              Wishlist conversion spreads 10–20× across real launches (GameDiscoverCo 2024) — a
              point estimate is fiction. This band halves and doubles your base conversion;{" "}
              <b>plan against the pessimistic column</b>.
            </p>
          </div>

          <div className="rev-panel">
            <label className="rev-field">
              <span>Wishlists at launch</span>
              <input
                type="number"
                min={0}
                value={wishlists}
                onChange={(e) => setWishlists(Math.max(0, +e.target.value))}
              />
            </label>
            <label className="rev-field">
              <span>Wishlist → sale conversion ({conversion.toFixed(2)}×)</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.01}
                value={conversion}
                onChange={(e) => setConversion(Math.max(0, +e.target.value))}
              />
            </label>
            <label className="rev-field">
              <span>List price (USD)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={priceUsd}
                onChange={(e) => setPriceUsd(Math.max(0, +e.target.value))}
              />
            </label>
            <label className="rev-field">
              <span>Refund rate — {Math.round(refundRate * 100)}%</span>
              <input
                type="range"
                min={0}
                max={0.25}
                step={0.01}
                value={refundRate}
                onChange={(e) => setRefundRate(+e.target.value)}
              />
            </label>
            <label className="rev-field">
              <span>Steam cut — {Math.round(storeCut * 100)}%</span>
              <input
                type="range"
                min={0}
                max={0.4}
                step={0.01}
                value={storeCut}
                onChange={(e) => setStoreCut(+e.target.value)}
              />
            </label>
            {engineId === "unity" && (
              <label className="rev-field">
                <span>
                  Unity Pro seats × years — {seats} × {licenseYears}
                </span>
                <div className="rev-dual">
                  <input
                    type="number"
                    min={1}
                    value={seats}
                    onChange={(e) => setSeats(Math.max(1, +e.target.value))}
                  />
                  <input
                    type="number"
                    min={1}
                    value={licenseYears}
                    onChange={(e) => setLicenseYears(Math.max(1, +e.target.value))}
                  />
                </div>
              </label>
            )}
            <label className="rev-field">
              <span>FX rate (SGD per USD)</span>
              <input
                type="number"
                min={0.5}
                step={0.01}
                value={sgdPerUsd}
                onChange={(e) => setSgdPerUsd(Math.max(0.5, +e.target.value))}
              />
            </label>
            <p className="rev-note">
              {units.toLocaleString("en-US")} units × ${priceUsd.toFixed(2)} = {usd(p.grossList)}{" "}
              list → {usd(p.grossRevenue)} after refunds → −{usd(p.storeFee)} Steam cut
              {p.engineCost > 0 ? " → −" + usd(p.engineCost) + " " + eng.label : ""} ={" "}
              <b>{usd(p.netUsd)}</b> net. &nbsp;{eng.note}
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
