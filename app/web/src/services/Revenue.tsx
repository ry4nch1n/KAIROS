import { useEffect, useState } from "react";
import {
  useDrawer,
  useIsDrawer,
  drawerPanelProps,
  NavToggle,
  NavScrim,
  DrawerClose,
} from "../components/MobileNav.tsx";
import { TabList } from "../components/Tabs.tsx";
import { Handoff } from "../components/Handoff.tsx";
import type { Service } from "../components/Rail.tsx";
import {
  DAYS_PER_MONTH,
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

import {
  BROWSER_AD_DEFAULTS,
  HINTS,
  browserAdProjection,
  type BrowserAdInputs,
} from "../lib/browserAds.ts";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-US");

/** One editable assumption. `src` names the published basis, so a modelled input is never
 *  misread as observed data. */
type Field = { label: string; v: number; set: (n: number) => void; step: number; src?: string };
function Num(f: Field) {
  return (
    <label className="rev-field">
      <span>{f.label}</span>
      <input
        type="number"
        min={0}
        step={f.step}
        value={f.v}
        onChange={(e) => f.set(Math.max(0, +e.target.value))}
      />
      {f.src && <small className="kpi-note">assumed · {f.src}</small>}
    </label>
  );
}

// In the order they compose: audience → engagement → portal terms.
const AD_FIELDS: [keyof BrowserAdInputs, string, number][] = [
  ["newPlayersPerDay", "New players/day from the portal", 100],
  ["d1Retention", "Next-day retention", 0.01],
  ["sessionsPerUser", "Sessions per player per day", 0.1],
  ["adsPerSession", "Ads shown per session", 0.1],
  ["ecpmUsd", "Gross eCPM (USD per 1,000 ads)", 0.25],
  ["revShare", "Developer rev-share", 0.05],
  ["eurPerUsd", "EUR per USD", 0.01],
];
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

export type Mode = "browser" | "steam";

// The platform Revenue opens on. Steam, to match Radar's DEFAULT_PLATFORM (#135) — the
// dashboard has one default platform, so switching tabs never lands you on the other one.
// Exported for the same reason Radar exports its default: the two are pinned together by
// `platformSelector.test.ts` rather than being two literals that can silently drift.
export const DEFAULT_MODE: Mode = "steam";

/** Browser | Steam platform switch — mirrors GameRadar's top-of-panel platform selector
 *  (labeled group + coloured dots) so the two dashboards read the same, instead of a bare
 *  seg tucked in the far corner. */
function ModeSeg({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="platform-groups">
      <TabList
        groupLabel="Platform"
        label="Platform"
        panelId="revenue-panel"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: "browser" as Mode, label: "Browser" },
          { id: "steam" as Mode, label: "Steam" },
        ]}
      />
    </div>
  );
}

export function Revenue({
  hidden,
  seed,
  onClearSeed,
  onGoto,
}: {
  hidden: boolean;
  seed?: RevenueSeed | null;
  onClearSeed?: () => void;
  onGoto?: (svc: Service) => void;
}) {
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
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
        <BrowserPanel
          mode={mode}
          setMode={setMode}
          target={target}
          setTarget={setTarget}
          onGoto={onGoto}
        />
      ) : (
        <SteamPanel
          mode={mode}
          setMode={setMode}
          seed={seed}
          onClearSeed={onClearSeed}
          target={target}
          onGoto={onGoto}
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
  onGoto,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  target: TargetBand | null;
  setTarget: (t: TargetBand | null) => void;
  onGoto?: (svc: Service) => void;
}) {
  const drawer = useDrawer();
  const isDrawer = useIsDrawer();
  const [ads, setAds] = useState<BrowserAdInputs>(BROWSER_AD_DEFAULTS);
  const [rate, setRate] = useState(DEFAULT_SGD_PER_USD);
  const set = (k: keyof BrowserAdInputs) => (n: number) => setAds((a) => ({ ...a, [k]: n }));

  const p = browserAdProjection(ads);
  const monthly = p.netUsdPerDay * DAYS_PER_MONTH;
  // The premium route at its own defaults, so the two routes can be weighed side by side.
  const steamNet = steamProjection({ ...STEAM_DEFAULTS, engineId: "godot" }).netUsd;
  const band = target ? targetBandUsd(rate, target) : null;
  const VERDICT_COPY: Record<string, { label: string; cls: string }> = {
    "no-target": { label: "No target set", cls: "none" },
    below: { label: "Below target", cls: "below" },
    "in-band": { label: "Hits the target band", cls: "in-band" },
    above: { label: "Clears the target", cls: "above" },
  };
  const v = VERDICT_COPY[verdict(monthly, rate, target)];
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

  return (
    <>
      <aside
        {...drawerPanelProps(drawer, isDrawer, "Revenue sections")}
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
        <div className="side-foot">
          Every field here is an <b>assumption</b>, not a measurement, and shows the published range
          it came from. Poki publishes its split (100% on traffic you bring, 50-50 on traffic it
          sends); CrazyGames publishes no rate, so 40–60% is a developer report, not a rate card.
        </div>
      </aside>
      <NavScrim open={drawer.open} onClose={drawer.closeDrawer} />

      <main className="main">
        <div className="topbar">
          <NavToggle onClick={drawer.openDrawer} />
          <h1>
            Revenue Model <small>project browser income against your monthly target</small>
          </h1>
          <ModeSeg mode={mode} setMode={setMode} />
        </div>

        <div className="content" id="revenue-panel" role="tabpanel" aria-label="Revenue projection">
          <div className="kpi-row">
            <div className="kpi">
              <div className="label">Monthly revenue (USD)</div>
              <div className="kpi-big">{usd(monthly)}</div>
              <div className="kpi-sub">
                ≈ SGD {Math.round(monthlySgd).toLocaleString("en-US")} · {eur(p.netEurPerDay)}/day
                <span className="kpi-note">projected from assumptions, not measured</span>
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
            {/* The verdict is the answer this whole panel exists to produce, and it
                changes as the dials move. Without a live region it flipped from
                "Below target" to "Clears the target" in complete silence — the one
                state change in the app that most deserves announcing. Polite, so it
                waits for a pause rather than interrupting mid-edit. */}
            <div className="kpi">
              <div className="label" id="verdict-label">
                Verdict
              </div>
              <div
                className={"rev-verdict " + v.cls}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {v.label}
                <span className="sr-only">
                  {pctToGoal !== null ? ` — ${pctToGoal}% of the target floor` : ""}
                </span>
              </div>
              <div className="kpi-sub" aria-hidden="true">
                {pctToGoal !== null
                  ? `${pctToGoal}% of the target floor`
                  : "set a monthly band to get a verdict"}
              </div>
            </div>
          </div>

          <div className="rev-band" role="group" aria-label="Route comparison">
            <div className="band-tile band-base">
              <span className="band-label">Ad-funded route · per year</span>
              <b className="band-net">{usd(p.netUsdPerYear)}</b>
              <span className="band-sub">
                {eur(p.netEurPerDay)}/day, recurring while traffic lasts
              </span>
            </div>
            <div className="band-tile band-opt">
              <span className="band-label">Premium route · lifetime net</span>
              <b className="band-net">{usd(steamNet)}</b>
              <span className="band-sub">one-off, at the Steam tab's default assumptions</span>
            </div>
            <p className="band-note">
              Not like for like: ad income is a <b>recurring yearly rate</b> that decays with
              traffic; a premium launch is a <b>one-off lifetime total</b>. Both are projections
              from assumptions — neither is measured.
            </p>
          </div>

          <div className="rev-panel">
            {AD_FIELDS.map(([k, label, step]) => (
              <Num key={k} label={label} v={ads[k]} set={set(k)} step={step} src={HINTS[k]} />
            ))}
            {/* targetBandUsd falls back to the default rate if this is cleared to 0 */}
            <Num label="FX rate (SGD per USD)" v={rate} step={0.01} set={setRate} />
            <p className="rev-note">
              {Math.round(p.dau).toLocaleString("en-US")} DAU ×{" "}
              {Math.round(p.sessionsPerDay).toLocaleString("en-US")} sessions/day →{" "}
              <b>{eur(p.netEurPerDay)}</b> net/day, a developer RPM of ${p.netRpmUsd.toFixed(2)} per
              1,000 sessions. Published portal reports land near €1.2–$3.3 RPM, and one solo dev's
              fourth browser game reported ≈€31/day after three that failed —{" "}
              <b>the realistic end, not the starting point</b>.
            </p>
          </div>
          <Handoff
            links={[
              {
                label: "Back to the pitch",
                hint: "record what this projection means for the idea",
                onClick: () => onGoto?.("library"),
              },
              {
                label: "Re-check the market",
                hint: "is the gap that justified this still open?",
                onClick: () => onGoto?.("radar"),
              },
            ]}
          />
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
  onGoto,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  seed?: RevenueSeed | null;
  onClearSeed?: () => void;
  target: TargetBand | null;
  onGoto?: (svc: Service) => void;
}) {
  const drawer = useDrawer();
  const isDrawer = useIsDrawer();
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
        {...drawerPanelProps(drawer, isDrawer, "Revenue sections")}
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
          <button
            type="button"
            className={"nav-item" + (e.id === engineId ? " active" : "")}
            aria-current={e.id === engineId ? "page" : undefined}
            key={e.id}
            onClick={() => setEngineId(e.id)}
          >
            {e.label}
            <span className="badge" style={{ background: "var(--primary)" }}>
              {ENGINE_BADGE[e.id]}
            </span>
          </button>
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
          <h1>
            Revenue Model{" "}
            <small>
              project Steam premium net revenue, after Steam's cut, refunds &amp; engine terms
            </small>
          </h1>
          <ModeSeg mode={mode} setMode={setMode} />
        </div>

        <div className="content" id="revenue-panel" role="tabpanel" aria-label="Revenue projection">
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
          <Handoff
            links={[
              {
                label: "Back to the pitch",
                hint: "record what this projection means for the idea",
                onClick: () => onGoto?.("library"),
              },
              {
                label: "Re-check the market",
                hint: "is the gap that justified this still open?",
                onClick: () => onGoto?.("radar"),
              },
            ]}
          />
        </div>
      </main>
    </>
  );
}
