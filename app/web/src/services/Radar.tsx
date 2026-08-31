import { useEffect, useState } from "react";
import { Tip } from "../components/Tip.tsx";
import {
  useDrawer,
  useIsDrawer,
  drawerPanelProps,
  NavToggle,
  NavScrim,
  DrawerClose,
} from "../components/MobileNav.tsx";
import { Capsule } from "../components/Capsule.tsx";
import { describeLoadError } from "../lib/loadError.ts";
import { TabList } from "../components/Tabs.tsx";
import { Handoff } from "../components/Handoff.tsx";
import type { Service } from "../components/Rail.tsx";
import type {
  Overview,
  Platform,
  GenreRow,
  DeveloperRow,
  NewRelease,
  HiddenGem,
  SteamOverview,
  SteamGenreEconomics,
  SuccessBand,
  SteamGap,
  SteeringLens,
  SteeringMatch,
  SteamPriceBand,
  SteamOwnershipRow,
  SteamDeveloperRow,
  SteamNewRelease,
  SteamUpcoming,
  SteamComparable,
  SteamTagLookup,
  ScoreComponents,
  SupplyTrend,
  Trajectory,
} from "shared";
import { api } from "../lib/api.ts";
import type { RevenueSeed } from "../lib/steamRevenue.ts";
import { EChart } from "../components/EChart.tsx";
import {
  momentumOption,
  treemapOption,
  scatterOption,
  heatmapOption,
  landscapeOption,
  quadrantOption,
  velocityBarOption,
  tierBarOption,
} from "../components/charts.ts";
import { InsightSvg, tagClass } from "../components/icons.tsx";

const fmt = (n: number) => n.toLocaleString("en-US");
const MIN_TREND_DAYS = 5;
// Platforms grouped by category to reflect the hierarchy: "All Browser" aggregates its
// children (CrazyGames + Poki); Steam is the PC surface (an "all PC" of one, for now).
// PC/Steam leads because Steam is the primary market Radar is read for (#135) — it is
// both the default platform and the first selectable option. CrazyGames before Poki
// by preference.
export const PLATFORM_GROUPS: { group: string; items: { id: Platform; label: string }[] }[] = [
  { group: "PC", items: [{ id: "steam", label: "Steam" }] },
  {
    group: "Browser",
    items: [
      { id: "all", label: "All Browser" },
      { id: "crazygames", label: "CrazyGames" },
      { id: "poki", label: "Poki" },
    ],
  },
];

// The platform Radar opens on. Exported so the selector's contract (default +
// ordering) is pinned by a test rather than living only in a useState call.
export const DEFAULT_PLATFORM: Platform = "steam";

// ── Steam formatting helpers ──
const fmtOwners = (n: number | null) =>
  n == null
    ? "—"
    : n >= 1e6
      ? (n / 1e6).toFixed(2) + "M"
      : n >= 1e3
        ? Math.round(n / 1e3) + "K"
        : String(n);
// `sample` distinguishes the two things a 0 can mean. A median of 0 cents over a
// real cohort means those games are genuinely Free; a median of 0 over an EMPTY
// cohort means unknown, and printing "Free" there states a market fact the data
// never supported. Callers with a per-row price omit `sample` — a row's own price
// of 0 is always a real Free.
const money = (cents: number | null, sample?: number) =>
  sample === 0 || cents == null ? "—" : cents === 0 ? "Free" : "$" + (cents / 100).toFixed(2);
const proxy = (d: number) =>
  d >= 1e9
    ? "$" + (d / 1e9).toFixed(1) + "B"
    : d >= 1e6
      ? "$" + (d / 1e6).toFixed(2) + "M"
      : d >= 1e3
        ? "$" + Math.round(d / 1e3) + "K"
        : "$" + d;
const rate = (r: number | null) => (r == null ? "—" : r.toFixed(2));
const signed = (n: number) => (n > 0 ? "+" : "") + n.toFixed(2);
const TIER_META: Record<string, { label: string; cls: string }> = {
  hobby: { label: "hobby", cls: "t-hobby" },
  small_indie: { label: "small", cls: "t-small" },
  est_indie: { label: "est. indie", cls: "t-est" },
  aaa: { label: "AAA", cls: "t-aaa" },
};

type View =
  | "overview"
  | "genres"
  | "tags"
  | "developers"
  | "trends"
  | "hidden-gems"
  | "new-releases"
  | "market-gaps";
type SteamSection =
  | "overview"
  | "economics"
  | "pricing"
  | "ownership"
  | "studios"
  | "comparables"
  | "opportunity";

// The URL carries an untyped slug; these narrow it to a section this panel owns,
// so a stale bookmark or a typo falls back to the default instead of blanking.
const BROWSER_VIEWS: View[] = [
  "overview",
  "genres",
  "tags",
  "developers",
  "trends",
  "hidden-gems",
  "new-releases",
  "market-gaps",
];
const STEAM_SECTIONS: SteamSection[] = [
  "overview",
  "economics",
  "pricing",
  "ownership",
  "studios",
  "comparables",
  "opportunity",
];
const isBrowserView = (s: string | null | undefined): s is View =>
  !!s && (BROWSER_VIEWS as string[]).includes(s);
const isSteamSection = (s: string | null | undefined): s is SteamSection =>
  !!s && (STEAM_SECTIONS as string[]).includes(s);
const I = {
  overview: (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  ),
  genres: (
    <svg viewBox="0 0 24 24">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  ),
  tags: (
    <svg viewBox="0 0 24 24">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="9" cy="17" r="2.5" />
      <path d="M8 7l8 1M8 8l1 7M16 10l-6 6" />
    </svg>
  ),
  developers: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
    </svg>
  ),
  trends: (
    <svg viewBox="0 0 24 24">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M17 7h4v4" />
    </svg>
  ),
  gems: (
    <svg viewBox="0 0 24 24">
      <path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />
    </svg>
  ),
  releases: (
    <svg viewBox="0 0 24 24">
      <path d="M5 12h14M12 5v14" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  gaps: (
    <svg viewBox="0 0 24 24">
      <path d="M12 2a10 10 0 1 0 10 10" />
      <path d="M12 2v10l7-7" />
    </svg>
  ),
  steam: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <circle cx="15" cy="9" r="2.5" />
      <path d="M6 14l4 1.6" />
      <circle cx="9.5" cy="15.5" r="1.6" />
    </svg>
  ),
  money: (
    <svg viewBox="0 0 24 24">
      <path d="M12 3v18M8 7h6a2.5 2.5 0 0 1 0 5H9a2.5 2.5 0 0 0 0 5h7" />
    </svg>
  ),
};

const Skel = ({ h = 300 }: { h?: number }) => (
  <div className="card">
    <div className="skeleton" style={{ height: h }} />
  </div>
);
const head = (icon: JSX.Element, title: string, sub?: string) => (
  <h2>
    {icon}
    {title}
    {sub && <span className="sub">{sub}</span>}
  </h2>
);
const deltaCls = (d: number) => (d > 3 ? "delta-up" : d < -3 ? "delta-dn" : "delta-fl");
const TRAJ_LABEL: Record<string, string> = {
  rising: "▲ rising",
  plateau: "▬ plateau",
  decaying: "▼ decaying",
  new: "· new",
};
// Same trajectories, read on an OLD cohort (#176). "new" here means "too few snapshots to
// judge", not "recently released" — hidden gems are drawn from the whole live catalog, so
// borrowing the New-Releases wording would assert an age the data doesn't carry.
const GEM_TRAJ_LABEL: Record<string, string> = { ...TRAJ_LABEL, new: "· no series yet" };
// Supply-side momentum (B2): new-entrant flow. "rising" = crowding (a warning, so it reads
// hot/amber, opposite of demand where rising is good); "quiet" = open lane.
const SUPPLY_LABEL: Record<string, string> = {
  rising: "▲ crowding",
  steady: "▬ steady",
  cooling: "▼ cooling",
  quiet: "· quiet",
};
const SUPPLY_TIP =
  "New entrants in the last ~30 days vs the prior ~30 (by first-seen / release date, anchored to the latest crawl). 'crowding' = supply arriving fast; 'quiet' = an open lane.";

// "This week's read" — the answer strip (server-computed, decision-framed; the charts
// below are the evidence). Lines carry server-trusted <b> markup, same as insights.
function ReadStrip({ lines }: { lines?: string[] }) {
  if (!lines?.length) return null;
  return (
    <div className="card read-strip">
      <div className="read-title">This week's read</div>
      {lines.map((l, i) => (
        <p className="read-line" key={i} dangerouslySetInnerHTML={{ __html: l }} />
      ))}
    </div>
  );
}

// Demand vs. Supply quadrant (B3) — the whitespace read in one chart. The colour legend
// is inline so "amber in the top-left = a crowding race, green = a clean opening" is legible
// without hovering.
const SUPPLY_LEGEND: [string, string, string][] = [
  ["quiet", "#059669", "open lane"],
  ["cooling", "#2563eb", "cooling"],
  ["steady", "#94a3b8", "steady"],
  ["rising", "#c2620a", "crowding"],
];
function QuadrantCard({
  points,
  yName,
  weightName,
}: {
  points: import("shared").QuadrantPoint[];
  yName: string;
  weightName: string;
}) {
  if (points.length < 3) return null;
  return (
    <div className="card hero">
      <h2>
        {I.gaps}Demand vs. Supply
        <span className="sub">
          top-left = underserved (few titles, high demand) · bubble = {weightName} · colour = supply
          momentum
        </span>
      </h2>
      <div className="q-legend">
        {SUPPLY_LEGEND.map(([k, c, label]) => (
          <span key={k} className="q-legend-item">
            <i style={{ background: c }} />
            {label}
          </span>
        ))}
      </div>
      <EChart option={quadrantOption(points, { yName, weightName })} style={{ minHeight: 360 }} />
    </div>
  );
}

/* ───────────── views ───────────── */
function OverviewView({
  ov,
  onComparables,
}: {
  ov: Overview;
  onComparables?: (f: ComparablesFilter) => void;
}) {
  return (
    <>
      <ReadStrip lines={ov.read} />
      <div className="kpis">
        <div className="kpi">
          <div className="label">{I.overview}Games tracked</div>
          <div className="val num">{fmt(ov.kpi.gamesTracked)}</div>
          <span className="delta up num">▲ {ov.kpi.newGames} new (14d)</span>
        </div>
        <div className="kpi">
          <div className="label">★ Avg rating</div>
          <div className="val num">{ov.kpi.avgRating.toFixed(2)}</div>
          <span className="delta flat num">
            P90 {ov.kpi.avgRatingP90.toFixed(2)} · point-in-time
          </span>
        </div>
        <div className="kpi">
          <div className="label">{I.trends}Rising genre</div>
          <div className="val val-word num">{ov.kpi.risingGenre}</div>
          <span className="delta up num">▲ +{ov.kpi.risingVotesPerDay} votes/day</span>
        </div>
        <div className="kpi accent">
          <div className="label">{I.gaps}Open market gaps</div>
          <div className="val num">{ov.kpi.openGaps}</div>
          <span className="delta up num">appetite &gt; supply</span>
        </div>
      </div>
      <QuadrantCard points={ov.quadrant} yName="median votes" weightName="total votes" />
      <div className="card hero">
        {head(I.genres, "Genre landscape", "supply × quality × audience — top-left = green-field")}
        <EChart option={landscapeOption(ov.landscape)} style={{ minHeight: 360 }} />
      </div>
      <div className="grid g-2">
        <div className="card">
          {head(I.trends, "Genre vote-velocity", "votes/day by genre — gainers vs flat/decliners")}
          <EChart option={velocityBarOption(ov.velocityBars)} />
        </div>
        <div className="card">
          {head(I.gems, "AI Insights", "auto-generated")}
          <div className="insights">
            {ov.insights.map((ins, i) => (
              <div className="insight" key={i}>
                <div className={"ic " + ins.kind}>
                  <InsightSvg kind={ins.kind} />
                </div>
                <div className="body">
                  <p dangerouslySetInnerHTML={{ __html: ins.text }} />
                  {ins.implication && <p className="implication">→ {ins.implication}</p>}
                  <div className="meta">
                    <span className={"tag-op " + tagClass(ins.kind)}>{ins.tag}</span>
                    <span>{ins.meta}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid g-2b">
        <div className="card">
          {head(I.tags, "Tag frequency", "top tags by game count")}
          <EChart option={treemapOption(ov.tags)} />
        </div>
        <div className="card">
          {head(I.gems, "Hidden-gem finder", "rating × visibility")}
          <EChart option={scatterOption(ov.scatter)} />
        </div>
      </div>
      <div className="grid g-2">
        <div className="card">
          {head(I.overview, "Rating-band density", "genre × rating band (game counts)")}
          <EChart option={heatmapOption(ov.heatmap)} style={{ minHeight: 260 }} />
        </div>
        <div className="card">
          {head(I.gaps, "Top market gaps", "appetite × quality × supply")}
          <GapList gaps={ov.gaps} onComparables={onComparables} />
        </div>
      </div>
      <div className="card">
        {head(
          I.tags,
          "Tag glossary",
          "what the tags on this dashboard mean — definition + example games",
        )}
        <table className="dtable">
          <thead>
            <tr>
              <th>Tag</th>
              <th>What it describes</th>
              <th>Example games</th>
            </tr>
          </thead>
          <tbody>
            {ov.glossary.map((r) => (
              <tr key={r.label}>
                <td className="gname">{r.label}</td>
                <td style={{ maxWidth: 360 }}>{r.definition}</td>
                <td style={{ color: "var(--text-3)" }}>{r.examples.join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// The opportunity score is not a black box (#12): the exact formula is stated in each
// list's legend and unpacked here. Pinned by the server test "opportunity score formula".
const Z_TIP =
  "z(x) = how many standard deviations x sits above the average across all genre × tag pairs ranked here. Positive score = better opportunity than the average pair; each term contributes roughly ±1 per standard deviation.";

// The composite's own factors, made legible (#87): the three z-score contributions that
// sum to the opportunity score. Neutral labels; demand/quality lift, supply is negated so a
// crowded market reads negative. Flex-wraps — safe at 375px, no fixed-width panel.
function ScoreBreakdown({ c }: { c: ScoreComponents }) {
  const term = (label: string, v: number) => (
    <span
      className="score-term"
      title={`${label}: ${v >= 0 ? "+" : ""}${v.toFixed(2)} — its contribution to the opportunity score (z-score, in standard deviations)`}
    >
      {label} <b className={v >= 0 ? "pos" : "neg"}>{`${v >= 0 ? "+" : ""}${v.toFixed(2)}`}</b>
    </span>
  );
  return (
    <div className="score-breakdown num" title="How the opportunity score adds up (z-score terms)">
      {term("demand", c.demand)}
      {term("quality", c.quality)}
      {term("supply", c.supply)}
      {c.steering !== undefined && term("steering", c.steering)}
    </div>
  );
}

/** One sentence saying what the standing flags DID to this ranking — which landed, how many
 *  markets moved, and which matched nothing. null when nothing is steering.
 *
 *  Three states, and the middle one is the whole point of #167: "nothing you care about is in
 *  this market" and "what you care about IS here, it just didn't outrank the list" are opposite
 *  conclusions, and the old copy said the first when the second was true. */
export function steeringNote(lens?: SteeringLens): string | null {
  if (!lens || !lens.flags.length) return null;
  const shown = lens.steeredShown ?? lens.steered;
  const unlisted = lens.unlisted ?? [];
  const markets = (n: number) => `${n} market${n === 1 ? "" : "s"}`;
  const per = `+${lens.weight.toFixed(2)} per matching flag`;
  const named = unlisted.map((u) => `${u.label} (rank ${u.rank})`).join(", ");
  let head: string;
  if (!lens.applied.length) {
    // Nothing matched anywhere in the ranking — the only case where "your flags found nothing"
    // is a true statement about the market.
    head =
      "Standing flags are set but none matched any ranked market — the order below is unsteered.";
  } else if (shown === 0) {
    head = `${lens.applied.join(", ")} matched ${markets(lens.steered)} — lifted ${per}, but none climbed into the list below.${named ? ` Closest: ${named}.` : ""}`;
  } else {
    head = `Steered by ${lens.applied.join(", ")} — ${markets(lens.steered)} lifted ${per}.${
      named ? ` Also matched below the list: ${named}.` : ""
    }`;
  }
  return lens.unmatched.length && lens.applied.length
    ? `${head} No ranked market matched ${lens.unmatched.join(", ")}.`
    : head;
}

/** The "this row was steered" chip — names the flags that moved it. */
function SteerChip({ s }: { s?: SteeringMatch }) {
  if (!s) return null;
  return (
    <span
      className="supply-flag"
      title={`Lifted +${s.delta.toFixed(2)} by standing flags: ${s.flags.join(", ")} — market data alone would rank it lower.`}
    >
      steered · {s.flags.join(", ")}
    </span>
  );
}

// A gap → comparables jump (#69). Comparables carry a genre but no tags, so the genre is
// the only field a row can actually be matched on; the tag rides along for the chip's label
// so the filter says which market it came from rather than a bare genre. Substring either
// way, because a browser portal's category and a Steam genre agree in wording more often
// than they agree exactly.
export interface ComparablesFilter {
  genre: string;
  tag?: string;
  from: "browser" | "steam";
}
export function matchesComparablesFilter(c: SteamComparable, f: ComparablesFilter | null): boolean {
  if (!f) return true;
  const a = (c.genre ?? "").trim().toLowerCase();
  const b = f.genre.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

const COMPARABLES_TIP =
  "Open the indie comparables for this market's genre — the realistic peer set that sets its ceiling. Comparables are Steam-only, so this also switches the platform.";

// The cross-link a gap row earns. Its own wrapping strip rather than a bare button, because
// the row is a flex line and a 375px screen has to stack this under the stats, not push it off
// the side — and because the sibling "copy pitch seed" affordance lands here next (#69).
function GapActions({
  filter,
  onComparables,
}: {
  filter: ComparablesFilter;
  onComparables?: (f: ComparablesFilter) => void;
}) {
  if (!onComparables) return null;
  return (
    <div className="gap-actions">
      <button
        type="button"
        className="project-btn"
        title={COMPARABLES_TIP}
        onClick={() => onComparables(filter)}
      >
        → comparables
      </button>
    </div>
  );
}

function GapList({
  gaps,
  onComparables,
}: {
  gaps: Overview["gaps"];
  onComparables?: (f: ComparablesFilter) => void;
}) {
  return (
    <div className="gaplist">
      <p className="gap-legend">
        opportunity = z(appetite: median votes/title) + z(quality ceiling: P90 rating) − z(supply:
        games)
      </p>
      {gaps.map((g, i) => (
        <div className="gap" key={i}>
          <span className="rank num">{i + 1}</span>
          <div className="name">
            {g.label}
            <small>
              opportunity {g.score.toFixed(1)}
              <Tip text={Z_TIP} />
            </small>
            {g.supplyRising && (
              <span
                className="supply-flag"
                title="This genre is accreting new entrants fast — the opening is real but closing."
              >
                supply rising
              </span>
            )}
            <ScoreBreakdown c={g.components} />
          </div>
          <div className="gap-stats num">
            <span>
              <b>{fmt(g.appetite)}</b> median votes/title
            </span>
            <span>
              <b>{g.supplyN}</b> games
            </span>
            <span>
              top rating <b>{g.qualityCeil.toFixed(2)}</b>
            </span>
          </div>
          <GapActions
            filter={{ genre: g.genre, tag: g.tag, from: "browser" }}
            onComparables={onComparables}
          />
          {g.examples?.length ? (
            <div className="gap-examples num">e.g. {g.examples.join(" · ")}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// Loop-family market rollup (#108; cross-platform since #67) — browser demand beside Steam
// economics with a route lean per row. Local mirror of the server shape; `.dtable` scrolls in its
// own container, so the added columns never push the page sideways on a phone.
interface LoopFamilyMarketData {
  rows: {
    family: string;
    supplyN: number;
    appetite: number | null;
    supplyTrend: SupplyTrend;
    steamGenres?: string[];
    steam?: {
      games: number;
      medianPriceCents: number;
      medianRevenuePerGame: number;
      supplyTrend: SupplyTrend;
    } | null;
    routeLean?: "browser" | "steam" | "contested" | "steam-unmapped" | null;
  }[];
  uncovered: string[];
}
// [chip label, chip class, tooltip]. Named for the revenue SHAPE, not an internal route label.
const MARKET_LEAN: Record<string, [string, string, string]> = {
  browser: ["portal-ad lean", "route-23", "Browser demand leads; Steam economics don't."],
  steam: ["premium lean", "route-1", "Steam revenue per game leads — a premium sale."],
  contested: ["contested", "route-both", "Both surfaces read comparably strong."],
  // #179: NOT a fourth lean — the absence of one. No live Steam genre maps into this family, so
  // there is nothing to compare the browser side against; saying "portal-ad lean" here would be
  // reporting a hole in the map as a market finding.
  "steam-unmapped": [
    "no Steam read",
    "route-unmapped",
    "No live Steam genre maps into this family, so the Steam side was never measured — this is a gap in the loop-family map, not evidence that Steam has no such market.",
  ],
};
const LEAN_TIP =
  "Each surface is scored against its own cross-family median, then the two are compared; a surface whose supply is crowding is discounted, so a hot family with a closing door can't read as open.";
const Trend = ({ t }: { t: SupplyTrend }) => (
  <span className={"supply supply-" + t}>{SUPPLY_LABEL[t] || t}</span>
);
const LeanChip = ({ lean }: { lean?: string | null }) => {
  const m = lean ? MARKET_LEAN[lean] : null;
  // The scoring tip only applies to a lean that was actually scored.
  return m ? (
    <span
      className={"route-chip " + m[1]}
      title={lean === "steam-unmapped" ? m[2] : m[2] + " " + LEAN_TIP}
    >
      {m[0]}
    </span>
  ) : null;
};
/** Why a Steam cell is blank — or, when it isn't, which genres fed it. */
const steamCellTip = (steam: unknown, steamGenres?: string[]) =>
  steamGenres?.length
    ? `Steam genres mapped into this family: ${steamGenres.join(", ")}`
    : steam
      ? undefined
      : "No live Steam genre maps into this family — nothing was measured on the Steam side.";

function LoopFamilyMarketCard({ platform }: { platform: Platform }) {
  const [data, setData] = useState<LoopFamilyMarketData | null>(null);
  useEffect(() => {
    let on = true;
    setData(null);
    fetch(`/api/loop-family-market?platform=${platform}`)
      .then((r) => (r.ok ? (r.json() as Promise<LoopFamilyMarketData>) : null))
      .then((d) => on && d && setData(d))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [platform]);
  if (!data) return <Skel h={200} />;
  return (
    <div className="card">
      {head(I.gaps, "Market by loop family", "browser demand beside Steam economics")}
      {data.rows.length ? (
        <table className="dtable">
          <thead>
            <tr>
              <th>Loop family</th>
              <th className="r">Supply</th>
              <th className="r">
                Appetite
                <Tip text="Supply-weighted median votes/reviews" />
              </th>
              <th>
                Supply trend
                <Tip text={SUPPLY_TIP} />
              </th>
              <th className="r">Steam games</th>
              <th className="r">
                Steam median rev/game
                <Tip text="Median revenue per released non-AAA Steam game in this family (owners bucket × price)" />
              </th>
              <th className="r">Steam median price</th>
              <th>
                Steam supply trend
                <Tip text={SUPPLY_TIP} />
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.family}>
                <td className="gname">
                  {r.family}
                  <LeanChip lean={r.routeLean} />
                </td>
                <td className="r">{r.supplyN ? fmt(r.supplyN) : "—"}</td>
                <td className="r">{r.appetite == null ? "—" : fmt(r.appetite)}</td>
                <td>
                  <span className={"supply supply-" + r.supplyTrend}>
                    {SUPPLY_LABEL[r.supplyTrend] || r.supplyTrend}
                  </span>
                </td>
                {/* No Steam coverage prints "—", never a 0: absent is not "earns nothing". The
                    title says WHICH absence — unmapped, or mapped and genuinely empty (#179). */}
                <td className="r" title={steamCellTip(r.steam, r.steamGenres)}>
                  {r.steam ? fmt(r.steam.games) : "—"}
                </td>
                <td className="r">{r.steam ? proxy(r.steam.medianRevenuePerGame) : "—"}</td>
                <td className="r">{r.steam ? money(r.steam.medianPriceCents) : "—"}</td>
                <td>{r.steam ? <Trend t={r.steam.supplyTrend} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="view-head">No mapped market coverage on this platform yet.</p>
      )}
      {data.uncovered.length > 0 && (
        <p className="view-head" style={{ marginTop: 10 }}>
          <b>No market coverage:</b> {data.uncovered.join(" · ")} — the whitespace the plan is
          narrowing on (or a gap in the map).
        </p>
      )}
    </div>
  );
}

function GenresView({ rows }: { rows: GenreRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.games));
  return (
    <div className="card">
      {head(I.genres, "Genre Explorer", `${rows.length} genres`)}
      <table className="dtable">
        <thead>
          <tr>
            <th>Genre</th>
            <th className="r">Games</th>
            <th className="r">Avg rating</th>
            <th className="r">Median votes</th>
            <th className="r">P90 votes (top-10% bar)</th>
            <th className="r">P90 rating</th>
            <th className="r">Votes/day</th>
            <th>
              Demand trend
              <Tip text="Later-half momentum vs earlier-half of the genre's median-vote series: rising / plateau / decaying" />
            </th>
            <th>
              Supply
              <Tip text={SUPPLY_TIP} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.genre}>
              <td className="gname">
                {r.genre}
                <span className="minibar">
                  <i style={{ width: (r.games / max) * 100 + "%" }} />
                </span>
              </td>
              <td className="r">{r.games}</td>
              <td className="r">{r.avgRating.toFixed(2)}</td>
              <td className="r">{fmt(r.medianVotes)}</td>
              <td className="r">{fmt(r.p90Votes)}</td>
              <td className="r">{r.p90Rating.toFixed(2)}</td>
              <td className={"r " + deltaCls(r.votesPerDay)}>
                {r.votesPerDay > 0 ? "+" : ""}
                {fmt(r.votesPerDay)}
              </td>
              <td>
                <span className={"traj traj-" + r.trajectory}>
                  {TRAJ_LABEL[r.trajectory] || r.trajectory}
                </span>
              </td>
              <td title={r.recentEntrants + " new in the trailing window"}>
                <span className={"supply supply-" + r.supplyTrend}>
                  {SUPPLY_LABEL[r.supplyTrend] || r.supplyTrend}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TagsView({ ov }: { ov: Overview }) {
  const max = Math.max(1, ...ov.tags.map((t) => t.count));
  const settings = ov.settings ?? [];
  const setMax = Math.max(1, ...settings.map((s) => s.count));
  return (
    <div className="grid g-2b">
      <div className="card">
        {head(I.tags, "Tag treemap", "by game count")}
        <EChart option={treemapOption(ov.tags)} style={{ minHeight: 360 }} />
      </div>
      <div className="card">
        {head(I.tags, "Tag frequency", `${ov.tags.length} tags · game count`)}
        <table className="dtable">
          <thead>
            <tr>
              <th>Tag</th>
              <th className="r">Games</th>
            </tr>
          </thead>
          <tbody>
            {ov.tags.map((t) => (
              <tr key={t.tag}>
                <td className="gname">
                  {t.tag}
                  <span className="minibar">
                    <i style={{ width: (t.count / max) * 100 + "%" }} />
                  </span>
                </td>
                <td className="r">{fmt(t.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {settings.length > 0 && (
        <div className="card">
          {head(
            I.tags,
            "Setting mix",
            "setting/theme is an axis orthogonal to genre — where the market's white space often hides",
          )}
          <table className="dtable">
            <thead>
              <tr>
                <th>Setting</th>
                <th>Examples</th>
                <th className="r">Games</th>
              </tr>
            </thead>
            <tbody>
              {settings.map((s) => (
                <tr key={s.setting}>
                  <td className="gname">
                    {s.setting}
                    <span className="minibar">
                      <i style={{ width: (s.count / setMax) * 100 + "%" }} />
                    </span>
                  </td>
                  <td style={{ color: "var(--text-3)" }}>{s.examples.join(" · ") || "—"}</td>
                  <td className="r">{fmt(s.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DevelopersView({ rows, platform }: { rows: DeveloperRow[]; platform: Platform }) {
  if (!rows.length)
    return (
      <div className="card">
        <div className="empty">
          <div className="big-ic">{I.developers}</div>
          <h2>No developer data yet</h2>
          <p>
            CrazyGames doesn't expose developer names — Poki does. Once the Poki crawl runs, repeat
            publishers show up here.
          </p>
        </div>
      </div>
    );
  return (
    <div className="card">
      {head(I.developers, "Developer Explorer", `${rows.length} developers`)}
      {(platform === "all" || platform === "crazygames") && (
        <p className="view-head">Developer names come from Poki; CrazyGames doesn't expose them.</p>
      )}
      <table className="dtable">
        <thead>
          <tr>
            <th>Developer</th>
            <th className="r">Games</th>
            <th className="r">Avg rating</th>
            <th className="r">Avg votes</th>
            <th>Top genre</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.developer}>
              <td className="gname">{r.developer}</td>
              <td className="r">{r.games}</td>
              <td className="r">{r.avgRating.toFixed(2)}</td>
              <td className="r">{fmt(r.avgVotes)}</td>
              <td>{r.topGenre}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendsView({ ov }: { ov: Overview }) {
  return (
    <>
      <div className="card">
        {head(I.trends, "Genre momentum", "median votes/day by genre over the crawl window")}
        {ov.momentum.dates.length >= MIN_TREND_DAYS ? (
          <EChart option={momentumOption(ov.momentum)} style={{ minHeight: 340 }} />
        ) : (
          <div
            className="empty-inline"
            style={{
              padding: "28px 8px",
              color: "var(--text-3)",
              fontSize: "var(--fs-3)",
              lineHeight: 1.6,
            }}
          >
            Genre momentum builds as the daily crawl accrues —{" "}
            <b>
              {ov.momentum.dates.length} crawl day{ov.momentum.dates.length === 1 ? "" : "s"}
            </b>{" "}
            so far. Multi-day vote trajectories become meaningful after about a week; for now see{" "}
            <b>Genre vote-velocity</b> on the Overview for what's gaining today.
          </div>
        )}
      </div>
      <div className="card">
        {head(I.genres, "Genre landscape", "supply × quality × audience — top-left = green-field")}
        <EChart option={landscapeOption(ov.landscape)} style={{ minHeight: 360 }} />
      </div>
      <div className="card">
        {head(I.overview, "Rating-band density", "genre × rating band (game counts)")}
        <EChart option={heatmapOption(ov.heatmap)} style={{ minHeight: 300 }} />
      </div>
    </>
  );
}

function GemsView({ ov, rows }: { ov: Overview; rows: HiddenGem[] | null }) {
  return (
    <>
      <div className="card">
        {head(I.gems, "Hidden-gem finder", "high rating × low visibility")}
        <EChart option={scatterOption(ov.scatter)} style={{ minHeight: 320 }} />
      </div>
      <div className="card">
        {head(
          I.gems,
          "Quality discovery missed",
          rows ? `${rows.length} found · well-rated, barely seen` : "…",
        )}
        {!rows ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : (
          <table className="dtable">
            <thead>
              <tr>
                <th>Game</th>
                <th>Genre</th>
                <th className="r">Rating</th>
                <th className="r">Votes</th>
                <th className="r">
                  Tracked
                  <Tip text="Days since KAIROS first crawled this title — discovery age, NOT a release date (browser portals don't publish one). A title seen last month and one seen two years ago mean opposite things at the same rating." />
                </th>
                <th className="r">
                  Votes/day
                  <Tip text="Votes gained per day over the tracked window — separates a game being found late from one that stopped being found." />
                </th>
                <th>
                  Trend
                  <Tip text="Later-half momentum vs earlier-half: rising / plateau / decaying. Flat means quality alone is not pulling players in." />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.gameId}>
                  <td className="gname">{r.title}</td>
                  <td>{r.genre}</td>
                  <td className="r" style={{ color: "var(--green)", fontWeight: 600 }}>
                    {r.rating.toFixed(2)}
                  </td>
                  <td className="r">{fmt(r.votes)}</td>
                  <td className="r">{r.daysTracked > 0 ? r.daysTracked + "d" : "<1d"}</td>
                  <td className="r">{r.votesPerDay > 0 ? "+" + fmt(r.votesPerDay) : "—"}</td>
                  <td>
                    <span className={"traj traj-" + r.trajectory}>
                      {GEM_TRAJ_LABEL[r.trajectory] || r.trajectory}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function NewReleasesView({ rows }: { rows: NewRelease[] }) {
  return (
    <div className="card">
      {head(
        I.releases,
        "New Releases",
        `${rows.length} new in last 14 days · age-adjusted momentum`,
      )}
      <table className="dtable">
        <thead>
          <tr>
            <th>Game</th>
            <th>Genre</th>
            <th className="r">Rating</th>
            <th className="r">Votes</th>
            <th
              className="r"
              title="Votes gained per day over the tracked window — a rocket and a dead evergreen with equal total votes read differently here"
            >
              Votes/day
            </th>
            <th>
              Trend
              <Tip text="Later-half momentum vs earlier-half: rising / plateau / decaying" />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.gameId}>
              <td>
                <a className="gname" href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
              </td>
              <td>{r.genre}</td>
              <td className="r">{r.rating ? r.rating.toFixed(2) : "—"}</td>
              <td className="r">{fmt(r.votes)}</td>
              <td className="r">{r.votesPerDay > 0 ? "+" + fmt(r.votesPerDay) : "—"}</td>
              <td>
                <span className={"traj traj-" + r.trajectory}>
                  {TRAJ_LABEL[r.trajectory] || r.trajectory}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Data caveats surfaced as header tooltips (replaced the old "Reading this" note).
const OWNERS_TIP = "Owners are SteamSpy bucket midpoints (estimates).";
const PROXY_TIP = "Revenue proxy = owners × current price (directional, not a P&L).";
const playH = (m: number) => (m ? Math.round(m / 60) + "h" : "—");

// Per-game revenue reads (#24): total revenue answers "how big is this category",
// not "what does a typical game here earn" — the question that matters when picking
// where to compete. Median/game is the headline (resists mega-hit skew).
const MED_REV_TIP =
  "Median revenue proxy per game — the typical outcome for one title in this genre. Resists mega-hit skew; the honest solo-dev opportunity read.";
const MEAN_REV_TIP =
  "Mean revenue proxy per game (total ÷ games). Mean far above median = top-heavy category where a few hits hold most of the pool.";
const TOTAL_REV_TIP =
  "Total revenue proxy = Σ owners × current price across the genre (directional, not a P&L). Measures category size, not per-game opportunity.";

// Cross-estimate band (#53). One estimator is a point estimate pretending to be a fact; two
// independent ones are an honest range. Rendered under the headline number, never instead of it.
const BAND_TIP =
  "Cross-check range from two independent estimators: owners × price, and reviews × 35 × price (Boxleiter method). Wide range = the underlying data is uncertain, so read the range, not the point.";
const SPLIT_TIP =
  "The two revenue estimators differ by more than 2×, so this genre's revenue is not reliably known — treat the range as the answer.";

// Absolute outcome ladder (#177). The band above says how UNCERTAIN the number is; this says how
// GOOD it would be if true — "$380k median" only becomes decision-ready once you know that is a
// sustainable result rather than a typical one. Labels carry the dollar floor so the tier never
// has to be looked up elsewhere.
const SUCCESS_LABEL: Record<SuccessBand, string> = {
  "sub-scale": "sub-scale · <$50k",
  modest: "modest · $50k–250k",
  sustainable: "sustainable · $250k–1M",
  hit: "hit · $1M–5M",
  breakout: "breakout · $5M+",
};
const SUCCESS_TIP =
  "Where this market's typical title lands on the ladder of commercial outcomes (lifetime gross): sub-scale / modest / sustainable / hit / breakout. Read it with the cohort note above — a paid-games-only benchmark from another tool sits roughly 4× higher.";
// Percentile context is per-row, so it is a title attribute rather than a shared Tip string.
const pctlTitle = (r: SteamGenreEconomics) =>
  r.revenuePercentiles
    ? `Within this market: p25 ${proxy(r.revenuePercentiles.p25)} · p75 ${proxy(r.revenuePercentiles.p75)} · p90 ${proxy(r.revenuePercentiles.p90)}. Clearing p75 puts a title in the top quarter.`
    : "Too few titles in this market to quote quartiles honestly — the tier is shown without percentile context.";

/** Absolute outcome tier for the headline median, under the uncertainty band. */
function SuccessChip({ r }: { r: SteamGenreEconomics }) {
  if (!r.successBand) return null; // older payloads carry no ladder
  return (
    <div className="succ-line">
      <span className={"succ-chip succ-" + r.successBand} title={pctlTitle(r)}>
        {SUCCESS_LABEL[r.successBand] || r.successBand}
      </span>
    </div>
  );
}

/** Sub-line under the headline median: the two estimators as a range, flagged when they split. */
function RevBand({ r }: { r: SteamGenreEconomics }) {
  if (r.revenueBandHighPerGame == null) return null; // older payloads carry no band
  const same = r.revenueBandLowPerGame === r.revenueBandHighPerGame;
  return (
    <div className="est-band">
      {same
        ? proxy(r.revenueBandLowPerGame)
        : `${proxy(r.revenueBandLowPerGame)}–${proxy(r.revenueBandHighPerGame)}`}
      {r.estimatorsDisagree ? <span className="est-split">wide</span> : null}
    </div>
  );
}

const CONV_LABEL: Record<string, string> = {
  strong: "converts well",
  typical: "typical",
  deliberation: "high-deliberation",
};
function ConvChip({ c }: { c: SteamGenreEconomics["conversion"] }) {
  if (!c) return null;
  return (
    <a
      className={"conv-chip conv-" + c.signal}
      href={c.source}
      target="_blank"
      rel="noreferrer"
      title={`${c.note} (as of ${c.asOf} · click for source)`}
    >
      {CONV_LABEL[c.signal] || c.signal}
    </a>
  );
}

function EconTable({
  rows,
  keyLabel = "Genre",
  demand = false,
  trend = false,
}: {
  rows: (SteamGenreEconomics & {
    medianVotes?: number;
    supplyTrend?: SupplyTrend;
    demandTrajectory?: Trajectory;
  })[];
  keyLabel?: string;
  demand?: boolean;
  trend?: boolean;
}) {
  return (
    <table className="dtable">
      <thead>
        <tr>
          <th>{keyLabel}</th>
          <th className="r">Games</th>
          {demand ? (
            <th className="r">
              Median reviews
              <Tip text={DEMAND_TIP} />
            </th>
          ) : null}
          <th className="r">Median price</th>
          <th className="r">Median rating</th>
          <th className="r">
            Total owners
            <Tip text={OWNERS_TIP} />
          </th>
          <th className="r">
            Median rev/game
            <Tip text={MED_REV_TIP} />
            <Tip text={SUCCESS_TIP} />
          </th>
          <th className="r">
            Mean rev/game
            <Tip text={MEAN_REV_TIP} />
          </th>
          <th className="r">
            Total rev proxy
            <Tip text={TOTAL_REV_TIP} />
          </th>
          {trend ? (
            <>
              <th>
                Demand trend
                <Tip text={SUBGENRE_DEMAND_TREND_TIP} />
              </th>
              <th>
                Supply
                <Tip text={SUPPLY_TIP} />
              </th>
            </>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.genre}>
            <td className="gname">
              {r.genre}
              <ConvChip c={r.conversion} />
            </td>
            <td className="r">{r.games}</td>
            {demand ? <td className="r">{fmt(r.medianVotes ?? 0)}</td> : null}
            <td className="r">{money(r.medianPriceCents)}</td>
            <td className="r">{rate(r.medianRating)}</td>
            <td className="r">{fmtOwners(r.totalOwners)}</td>
            <td className="r" style={{ fontWeight: 600 }}>
              {proxy(r.medianRevenuePerGame)}
              <RevBand r={r} />
              <SuccessChip r={r} />
            </td>
            <td className="r">{proxy(r.meanRevenuePerGame)}</td>
            <td className="r">{proxy(r.revenueProxy)}</td>
            {trend ? (
              <>
                <td>
                  <span className={"traj traj-" + (r.demandTrajectory ?? "new")}>
                    {TRAJ_LABEL[r.demandTrajectory ?? "new"] || r.demandTrajectory}
                  </span>
                </td>
                <td>
                  <span className={"supply supply-" + (r.supplyTrend ?? "quiet")}>
                    {SUPPLY_LABEL[r.supplyTrend ?? "quiet"] || r.supplyTrend}
                  </span>
                </td>
              </>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OppList({
  gaps,
  lens,
  onComparables,
}: {
  gaps: SteamGap[];
  lens?: SteeringLens;
  onComparables?: (f: ComparablesFilter) => void;
}) {
  const note = steeringNote(lens);
  if (!gaps.length)
    return (
      <p className="view-head">
        Not enough indie data yet to rank genre × tag opportunities — accrues as the crawl grows.
      </p>
    );
  return (
    <div className="gaplist">
      <p className="gap-legend">
        opportunity = z(demand: median owners) + z(quality ceiling: P90 rating) − z(supply: games) ·
        median price is context, not scored
      </p>
      {note && <p className="gap-legend">{note}</p>}
      {gaps.map((g, i) => (
        <div className="gap" key={i}>
          <span className="rank num">{i + 1}</span>
          <div className="name">
            {g.label}
            <small>
              opportunity {g.score.toFixed(1)}
              <Tip text={Z_TIP} />
            </small>
            {g.supplyRising && (
              <span
                className="supply-flag"
                title="This genre is accreting new releases fast — the opening is real but closing."
              >
                supply rising
              </span>
            )}
            <SteerChip s={g.steering} />
            <ScoreBreakdown c={g.components} />
          </div>
          <div className="gap-stats num">
            <span>
              <b>{fmtOwners(g.medianOwners)}</b> median owners
            </span>
            <span>
              <b>{g.supplyN}</b> games
            </span>
            <span>
              top rating <b>{g.qualityCeil.toFixed(2)}</b>
            </span>
            <span>
              median <b>{money(g.medianPriceCents)}</b>
            </span>
          </div>
          <GapActions
            filter={{ genre: g.genre, tag: g.tag, from: "steam" }}
            onComparables={onComparables}
          />
          {g.examples?.length ? (
            <div className="gap-examples num">e.g. {g.examples.join(" · ")}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PricingTable({ rows }: { rows: SteamPriceBand[] }) {
  return (
    <table className="dtable">
      <thead>
        <tr>
          <th>Price band</th>
          <th className="r">Games</th>
          <th className="r">Median rating</th>
          <th className="r">
            Total owners
            <Tip text={OWNERS_TIP} />
          </th>
          <th className="r">
            Revenue proxy
            <Tip text={PROXY_TIP} />
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.band}>
            <td className="gname">{r.band}</td>
            <td className="r">{r.games}</td>
            <td className="r">{rate(r.medianRating)}</td>
            <td className="r">{fmtOwners(r.totalOwners)}</td>
            <td className="r" style={{ fontWeight: 600 }}>
              {proxy(r.revenueProxy)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const CONTENT_TIP =
  "Median playtime, reframed as a content-scope proxy: buyers of this genre expect roughly this much game — your content bill. A genre players sink 20h into is a very different solo scope than a 2h one.";
function OwnershipTable({ rows }: { rows: SteamOwnershipRow[] }) {
  return (
    <table className="dtable">
      <thead>
        <tr>
          <th>Genre</th>
          <th className="r">Games</th>
          <th className="r">
            Total owners
            <Tip text={OWNERS_TIP} />
          </th>
          <th className="r">Median owners</th>
          <th className="r">Live CCU</th>
          <th className="r">
            Content expectation
            <Tip text={CONTENT_TIP} />
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.genre}>
            <td className="gname">{r.genre}</td>
            <td className="r">{r.games}</td>
            <td className="r">{fmtOwners(r.totalOwners)}</td>
            <td className="r">{fmtOwners(r.medianOwners)}</td>
            <td className="r">{fmt(r.ccu)}</td>
            <td className="r">{playH(r.medianPlaytimeMin)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DevTable({ rows }: { rows: SteamDeveloperRow[] }) {
  return (
    <table className="dtable">
      <thead>
        <tr>
          <th>Developer</th>
          <th className="r">Games</th>
          <th className="r">
            Total owners
            <Tip text={OWNERS_TIP} />
          </th>
          <th className="r">Avg rating</th>
          <th>Top genre</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.developer}>
            <td className="gname">{r.developer}</td>
            <td className="r">{r.games}</td>
            <td className="r">{fmtOwners(r.totalOwners)}</td>
            <td className="r">{r.avgRating.toFixed(2)}</td>
            <td>{r.topGenre}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const REVIEWS_TIP =
  "Review count = launch traction the rating hides. Steam shows no overall score until ~10 reviews, so a “quiet” row (below that) is a launch that landed at near-zero visibility — the modal indie outcome, not an error (#109).";
function NewReleasesTable({ rows }: { rows: SteamNewRelease[] }) {
  // The capsule column exists only if the set has capsules to show.
  const anyArt = rows.some((r) => !!r.capsuleUrl);
  return (
    <table className="dtable">
      <thead>
        <tr>
          <th>Game</th>
          <th className="r">Released</th>
          <th>Genre</th>
          <th className="r">Rating</th>
          <th className="r">
            Reviews
            <Tip text={REVIEWS_TIP} />
          </th>
          <th className="r">
            Rev/day
            <Tip text="Reviews per day since launch — traction rate, not a total." />
          </th>
          <th className="r">
            Owners
            <Tip text={OWNERS_TIP} />
          </th>
          <th className="r">Price</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="gname">
              <span className="gamecell">
                {anyArt && <Capsule url={r.capsuleUrl} title={r.title} />}
                <span>{r.title}</span>
              </span>
            </td>
            <td className="r">{r.releaseDate ?? "—"}</td>
            <td>{r.genre}</td>
            <td className="r">{rate(r.rating)}</td>
            <td className="r">
              {r.votes == null ? "—" : fmt(r.votes)}
              {r.belowScoreThreshold ? (
                <span className="traj traj-decaying" style={{ marginLeft: 6 }} title={REVIEWS_TIP}>
                  quiet
                </span>
              ) : null}
            </td>
            <td className="r">{r.reviewsPerDay == null ? "—" : r.reviewsPerDay.toFixed(2)}</td>
            <td className="r">{fmtOwners(r.owners)}</td>
            <td className="r">{money(r.priceCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const FOLLOWERS_TIP =
  "Followers of the store page. An unreleased game has no reviews and no owners, so this is its only demand reading — and the accepted public stand-in for the wishlist counts Steam does not publish. Blank means not measured, never zero.";
const FOLL_DAY_TIP =
  "Followers gained per day, across the last two days this game was measured. The total says how big the audience already is; only the rate says whether it is still growing. Blank until two days have been measured.";
function UpcomingTable({ rows }: { rows: SteamUpcoming[] }) {
  const anyArt = rows.some((r) => !!r.capsuleUrl);
  if (!rows.length)
    return (
      <div className="empty-inline" style={{ padding: "20px 8px", color: "var(--text-3)" }}>
        No unreleased titles tracked yet — they appear once a crawl reads Steam's upcoming shelf.
      </div>
    );
  return (
    <table className="dtable">
      <thead>
        <tr>
          <th>Game</th>
          <th>Genre</th>
          <th className="r">
            Followers
            <Tip text={FOLLOWERS_TIP} />
          </th>
          <th className="r">
            Foll/day
            <Tip text={FOLL_DAY_TIP} />
          </th>
          <th className="r">Price</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="gname">
              <span className="gamecell">
                {anyArt && <Capsule url={r.capsuleUrl} title={r.title} />}
                <span>{r.title}</span>
              </span>
            </td>
            <td>{r.genre}</td>
            <td className="r">{r.followers == null ? "—" : fmt(r.followers)}</td>
            {/* Window in the title: a widened one (a failed fetch day) stays inspectable. */}
            <td className="r" title={`measured over ${r.followerWindowDays ?? 0} day(s)`}>
              {r.followerVelocity == null ? "—" : signed(r.followerVelocity)}
            </td>
            <td className="r">{money(r.priceCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TEAM_META: Record<string, { label: string; cls: string }> = {
  solo: { label: "Solo", cls: "team-solo" },
  small: { label: "Small", cls: "team-small" },
  mid: { label: "Mid", cls: "team-mid" },
  large: { label: "Large", cls: "team-large" },
};
const isSoloReachable = (c: SteamComparable) =>
  c.teamSize != null && (c.teamSize.bucket === "solo" || c.teamSize.bucket === "small");
// A release within ~90 days is a fresh comparable — paired with the Solo-reachable cohort
// toggle, this surfaces recent solo/small wins (#9) inside the table that already exists,
// instead of a separate near-empty shelf.
const RECENT_DAYS = 90;
const isRecentRelease = (iso: string | null): boolean => {
  if (!iso) return false;
  const days = (Date.now() - new Date(iso + "T00:00:00Z").getTime()) / 86400000;
  return days >= 0 && days <= RECENT_DAYS;
};
// Team size is hand-curated (no API fills it), while comparables roll by recency, so most
// rows resolve no size. Render the Team (est.) column only when a meaningful share of the
// *currently visible* rows carry an estimate — a ~93%-blank column is noise. This self-heals:
// the Solo-reachable cohort (100% tagged) always shows it, and if curation coverage ever
// improves the column returns with no code change.
export const TEAM_COVERAGE_MIN = 0.4;
export const hasTeamCoverage = (rows: SteamComparable[]): boolean => {
  if (rows.length === 0) return false;
  const resolved = rows.filter((c) => c.teamSize != null).length;
  return resolved / rows.length >= TEAM_COVERAGE_MIN;
};
const TEAM_TIP =
  "Team size is not in any Steam/3rd-party API — these are researched estimates (bucket by the team that shipped the studio's breakout). Click for the source.";
const VELOCITY_TIP =
  "Reviews gained per day over the trailing 30-day snapshot window — the public leading-indicator proxy for wishlist velocity (wishlist counts aren't acquirable). Total reviews/owners lag a launch by months; this doesn't. — = not enough snapshot history yet.";

const AI_DISCLOSURE_TIP =
  "Whether the store page carries Steam's AI Generated Content Disclosure. AI = discloses AI-generated content · — = checked, none disclosed · ? = not checked (only recent non-AAA titles are checked). #110";

const PROJECT_TIP =
  "Load this game into the Revenue model as an anchor — its price prefills the calculator and its real outcome (owners × price) shows beside your projection.";

function ComparablesTable({
  rows,
  onProject,
}: {
  rows: SteamComparable[];
  onProject?: (seed: RevenueSeed) => void;
}) {
  const showTeam = hasTeamCoverage(rows);
  // Same discipline as showTeam: the capsule column earns its width only when the
  // set actually has art. Otherwise every row renders an identical dark pill
  // holding one letter that already appears beside it — noise, not information.
  const anyArt = rows.some((r) => !!r.capsuleUrl);
  return (
    <table className="dtable">
      <thead>
        <tr>
          <th>Game</th>
          <th>Tier</th>
          {showTeam && (
            <th>
              Team (est.)
              <Tip text={TEAM_TIP} />
            </th>
          )}
          <th>Genre</th>
          <th className="r">Released</th>
          <th className="r">Rating</th>
          <th className="r">
            AI
            <Tip text={AI_DISCLOSURE_TIP} />
          </th>
          <th className="r">Reviews</th>
          <th className="r">
            Rev./day
            <Tip text={VELOCITY_TIP} />
          </th>
          <th className="r">
            Owners
            <Tip text={OWNERS_TIP} />
          </th>
          <th className="r">Price</th>
          <th>Developer</th>
          {onProject && (
            <th>
              <Tip text={PROJECT_TIP} />
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((c, i) => {
          const tm = TIER_META[c.tier] ?? { label: c.tier, cls: "t-hobby" };
          const ts = c.teamSize;
          const meta = ts ? TEAM_META[ts.bucket] : null;
          return (
            <tr key={i}>
              <td className="gname">
                <span className="gamecell">
                  {anyArt && <Capsule url={c.capsuleUrl} title={c.title} />}
                  <span>{c.title}</span>
                </span>
              </td>
              <td>
                <span className={"tier-chip " + tm.cls}>{tm.label}</span>
              </td>
              {showTeam && (
                <td>
                  {ts && meta ? (
                    <a
                      className={"est-chip " + meta.cls}
                      href={ts.source}
                      target="_blank"
                      rel="noreferrer"
                      title={`${ts.headcount} · ${ts.confidence} confidence · estimated`}
                    >
                      {meta.label} · est.
                    </a>
                  ) : (
                    <span className="est-chip est-unknown" title="Team size not researched yet">
                      —
                    </span>
                  )}
                </td>
              )}
              <td>{c.genre}</td>
              <td className="r">
                {c.releaseDate ? c.releaseDate.slice(0, 4) : "—"}
                {isRecentRelease(c.releaseDate) && (
                  <span
                    className="recent-chip"
                    title={"Released within the last " + RECENT_DAYS + " days"}
                  >
                    new
                  </span>
                )}
              </td>
              <td className="r">{rate(c.rating)}</td>
              <td className="r">
                {c.aiDisclosure === true ? (
                  <span
                    className="ai-chip"
                    title="Store page carries an AI Generated Content Disclosure"
                  >
                    AI
                  </span>
                ) : c.aiDisclosure === false ? (
                  <span style={{ color: "var(--text-3)" }}>—</span>
                ) : (
                  <span style={{ color: "var(--text-3)" }} title="Not checked">
                    ?
                  </span>
                )}
              </td>
              <td className="r">{c.votes == null ? "—" : fmt(c.votes)}</td>
              <td className="r">{c.reviewVelocity == null ? "—" : fmt(c.reviewVelocity)}</td>
              <td className="r">{fmtOwners(c.owners)}</td>
              <td className="r">{money(c.priceCents)}</td>
              <td style={{ color: "var(--text-3)" }}>{c.developer ?? "—"}</td>
              {onProject && (
                <td className="r">
                  <button
                    type="button"
                    className="project-btn"
                    title={PROJECT_TIP}
                    onClick={() =>
                      onProject({
                        title: c.title,
                        priceCents: c.priceCents,
                        owners: c.owners,
                        votes: c.votes,
                        reviewVelocity: c.reviewVelocity,
                      })
                    }
                  >
                    → project
                  </button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ComparablesCard({
  rows,
  onProject,
  filter,
  onClearFilter,
}: {
  rows: SteamComparable[];
  onProject?: (seed: RevenueSeed) => void;
  filter?: ComparablesFilter | null;
  onClearFilter?: () => void;
}) {
  const [cohort, setCohort] = useState<"all" | "solo">("all");
  // A jump in from a gap row narrows the set BEFORE the cohort toggle does, so the toggle's
  // counts describe the market you arrived on rather than the whole catalogue.
  const inMarket = rows.filter((r) => matchesComparablesFilter(r, filter ?? null));
  const shown = cohort === "solo" ? inMarket.filter(isSoloReachable) : inMarket;
  const soloN = inMarket.filter(isSoloReachable).length;
  return (
    <div className="card">
      <h2>
        {I.gems}Indie comparables
        <span className="sub">the realistic peer set — indie-tier games, most recent first</span>
        <span className="seg" role="group" aria-label="Cohort">
          <button
            className={"seg-btn" + (cohort === "all" ? " active" : "")}
            type="button"
            aria-pressed={cohort === "all"}
            onClick={() => setCohort("all")}
          >
            All ({inMarket.length})
          </button>
          <button
            className={"seg-btn" + (cohort === "solo" ? " active" : "")}
            type="button"
            aria-pressed={cohort === "solo"}
            onClick={() => setCohort("solo")}
          >
            Solo-reachable ({soloN})
          </button>
        </span>
      </h2>
      {filter && (
        <p className="filter-chip">
          <span>
            showing <b>{filter.genre}</b>
            {filter.tag ? ` · ${filter.tag}` : ""} — matched on genre
            {filter.from === "browser" ? ", carried over from a browser market gap" : ""}
          </span>
          <button type="button" className="project-btn" onClick={() => onClearFilter?.()}>
            clear filter
          </button>
        </p>
      )}
      {cohort === "solo" && (
        <p className="view-head">
          Studios a <b>1–2 or 3–10 person</b> team could realistically match, by researched
          team-size estimate. Untagged studios are hidden rather than assumed solo.
        </p>
      )}
      {shown.length ? (
        <ComparablesTable rows={shown} onProject={onProject} />
      ) : filter && !inMarket.length ? (
        <p className="view-head">
          No comparables in the current set match <b>{filter.genre}</b>. The peer set rolls by
          recency, so a thin genre can simply have nothing recent — clear the filter to see it all.
        </p>
      ) : (
        <p className="view-head">No solo-reachable comparables tagged in the current set yet.</p>
      )}
    </div>
  );
}

function SteamKpis({ data }: { data: SteamOverview }) {
  return (
    <div className="kpis">
      <div className="kpi">
        <div className="label">{I.steam}Steam games</div>
        <div className="val num">{fmt(data.kpi.games)}</div>
        <span className="delta flat num">{data.kpi.ratedPct}% have reviews</span>
      </div>
      <div className="kpi accent">
        <div className="label">{I.gems}Indie cohort</div>
        <div className="val num">{fmt(data.kpi.indie)}</div>
        <span className="delta up num">addressable for a solo dev</span>
      </div>
      <div className="kpi">
        <div className="label">{I.overview}AAA (context)</div>
        <div className="val num">{fmt(data.kpi.aaa)}</div>
        <span className="delta flat num">excluded from benchmarks</span>
      </div>
      <div className="kpi">
        <div className="label">{I.money}Indie median price</div>
        <div className="val num">{money(data.kpi.indieMedianPriceCents, data.kpi.indie)}</div>
        <span className="delta flat num">what indies charge</span>
      </div>
      <div className="kpi">
        <div className="label">
          {I.releases}Quiet launches
          <Tip text="Share of tracked non-AAA titles released in the last 90 days still under ~10 reviews (Steam shows no overall score yet). The failure floor — what a competent-but-quiet launch actually looks like (#109)." />
        </div>
        <div className="val num">{data.kpi.quietLaunchPct}%</div>
        <span className="delta flat num">
          below score threshold · {fmt(data.kpi.quietLaunchSample)} in 90d
        </span>
      </div>
      <div className="kpi">
        <div className="label">
          {I.gems}AI disclosed
          <Tip text="Share of checked non-AAA titles released in the last 90 days whose store page carries Steam's AI Generated Content Disclosure. Only recent non-AAA titles are checked, so this reads over the sample we actually fetched (#110)." />
        </div>
        <div className="val num">
          {data.kpi.aiDisclosurePct == null ? "—" : `${data.kpi.aiDisclosurePct}%`}
        </div>
        <span className="delta flat num">
          disclose AI content · {fmt(data.kpi.aiDisclosureSample)} checked in 90d
        </span>
      </div>
    </div>
  );
}

const DEMAND_TIP =
  "Median review count per game — a continuous demand signal, unlike owner estimates, which are coarse buckets.";
const SUBGENRE_TIP =
  "Sub-genres come from community tags, so a game carries several — rows overlap and deliberately do not add up to the catalog. Each row reads as “the market of games carrying this tag”.";
const SUBGENRE_DEMAND_TREND_TIP =
  "Later-half vs earlier-half momentum of this sub-genre's median-review series across snapshot windows: rising / plateau / decaying. Reads “new” until enough history accrues to judge — it does not fake a trend from too few captures.";

// Store genres are coarse (Action, Indie, Strategy), so a real market like Deckbuilding is
// split across several of them and can't be read on its own. The sub-genre lens re-keys the
// same economics on community tags (#90).
const TAG_QUERY_MIN = 2; // below this a query matches half the tag table — mirrors the server floor

function GenreEconCard({ data }: { data: SteamOverview }) {
  const [cohort, setCohort] = useState<"indie" | "all">("indie");
  const [lens, setLens] = useState<"genre" | "tag">("genre");
  const tagRows = data.tagEconomics ?? [];
  // Named sub-genre lookup (#113). The ranked list below is the top 30 by TOTAL revenue, which
  // broad tags win by construction — so a specific market has to be reachable by name instead.
  const [tagQuery, setTagQuery] = useState("");
  const [lookup, setLookup] = useState<SteamTagLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const trimmed = tagQuery.trim();
  const searching = lens === "tag" && trimmed.length >= TAG_QUERY_MIN;
  useEffect(() => {
    if (!searching) {
      setLookup(null);
      setLooking(false);
      return;
    }
    let live = true;
    setLooking(true);
    const t = setTimeout(() => {
      fetch(`/api/steam/tags?tag=${encodeURIComponent(trimmed)}`)
        .then((r) => (r.ok ? (r.json() as Promise<SteamTagLookup>) : null))
        .then((r) => live && setLookup(r))
        .catch(() => live && setLookup(null))
        .finally(() => live && setLooking(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [trimmed, searching]);
  return (
    <div className="card">
      <h2>
        {I.money}
        {lens === "genre" ? "Genre economics" : "Sub-genre economics"}
        <span className="sub">owners × realized price — what a market is worth at this scale</span>
        <span className="seg" role="group" aria-label="Lens">
          <button
            className={"seg-btn" + (lens === "genre" ? " active" : "")}
            type="button"
            aria-pressed={lens === "genre"}
            onClick={() => setLens("genre")}
          >
            Genre
          </button>
          <button
            className={"seg-btn" + (lens === "tag" ? " active" : "")}
            type="button"
            aria-pressed={lens === "tag"}
            onClick={() => setLens("tag")}
            disabled={!tagRows.length}
            title={SUBGENRE_TIP}
          >
            Sub-genre
          </button>
        </span>
        {lens === "genre" && (
          <span className="seg" role="group" aria-label="Cohort">
            <button
              className={"seg-btn" + (cohort === "indie" ? " active" : "")}
              type="button"
              aria-pressed={cohort === "indie"}
              onClick={() => setCohort("indie")}
            >
              Indie
            </button>
            <button
              className={"seg-btn" + (cohort === "all" ? " active" : "")}
              type="button"
              aria-pressed={cohort === "all"}
              onClick={() => setCohort("all")}
            >
              All tiers
            </button>
          </span>
        )}
      </h2>
      {/* The ladder is meaningless without its cohort: the same benchmark computed over paid
          games only runs ~4x higher, so a tier quoted from another tool is not comparable. */}
      <p className="view-head">
        Outcome tiers (<b>sub-scale / modest / sustainable / hit / breakout</b>) are absolute
        lifetime-gross bands, calibrated on the cohort these medians already use —{" "}
        <b>released, non-AAA titles with free and unpriced games counted at $0</b>. A
        paid-games-only benchmark sits roughly 4× higher; don't compare the two.
      </p>
      {lens === "genre" && cohort === "all" && (
        <p className="view-head">
          All tiers include AAA — owners/revenue are dominated by mega-hits; demand context only,{" "}
          <b>not</b> a solo-dev benchmark.
        </p>
      )}
      {lens === "tag" && (
        <>
          <p className="view-head">
            Indie cohort, keyed on community tags — the markets store genres hide. Tags overlap, so
            rows <b>don't</b> sum to the catalog; read each as the market of games carrying that
            tag.
          </p>
          {/* Wraps and shrinks so the card never forces a page-level horizontal scroll on a phone. */}
          <form
            role="search"
            style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0 10px" }}
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              type="search"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              placeholder="Find a sub-genre by name — partial matches work"
              aria-label="Find a sub-genre by name"
              style={{
                flex: "1 1 200px",
                minWidth: 0,
                border: "1px solid var(--border)",
                borderRadius: 9,
                padding: "8px 11px",
                fontFamily: "Fira Code",
                fontSize: "var(--fs-3)",
                color: "var(--text)",
                background: "var(--surface-2)",
              }}
            />
            {trimmed ? (
              <button type="button" className="seg-btn" onClick={() => setTagQuery("")}>
                Clear
              </button>
            ) : null}
          </form>
          {searching && (
            <p className="view-head">
              {looking && !lookup
                ? "Searching…"
                : lookup?.rows.length
                  ? `${lookup.rows.length} match${lookup.rows.length === 1 ? "" : "es"} for “${trimmed}” — the revenue ranking is bypassed, so a small market still shows.`
                  : `Nothing above the ${lookup?.minSupply ?? TAG_QUERY_MIN}-title floor matches “${trimmed}”.`}
              {lookup?.thin.length ? (
                <>
                  {" "}
                  Too thin to read as a market:{" "}
                  {lookup.thin.map((t) => `${t.tag} (${t.games})`).join(", ")}.
                </>
              ) : null}
            </p>
          )}
        </>
      )}
      {lens === "tag" ? (
        <EconTable
          rows={searching ? (lookup?.rows ?? []) : tagRows}
          keyLabel="Sub-genre"
          demand
          trend
        />
      ) : (
        <EconTable rows={cohort === "indie" ? data.indie : data.all} />
      )}
    </div>
  );
}

// The P0 this guards against: with zero crawled games the panel still rendered a
// full analysis — six KPIs reading 0, an empty tier chart, an "Indie median price"
// of "Free", and a "This week's read" strip stating "No genre shows extreme
// hit-concentration in the indie cohort this window", which is a CONCLUSION drawn
// from nothing. A decision engine that produces confident sentences without data
// is failing at its only job, so an empty catalog now fails loudly instead.
// A failed load used to render `Failed to load: TypeError: Failed to fetch` in a
// red card with no way out but a page refresh. It now names the problem, says
// what to do, offers the retry, and keeps the raw text available for diagnosis
// without leading with it.
function LoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { title, hint, detail } = describeLoadError(error);
  return (
    <div className="card load-failure" role="alert">
      <div className="lf-head">
        <span className="lf-mark" aria-hidden="true">
          {I.gaps}
        </span>
        <div>
          <b>{title}</b>
          <p>{hint}</p>
        </div>
      </div>
      <div className="lf-actions">
        <button type="button" className="btn-retry" onClick={onRetry}>
          Try again
        </button>
        <details className="lf-detail">
          <summary>Technical detail</summary>
          <code>{detail}</code>
        </details>
      </div>
    </div>
  );
}

// This used to read "Crawl OK" with a healthy green pulse — a hardcoded string,
// so it said OK over an empty catalog too. The dot now reports something the
// client can actually observe.
//
// Honest about its limits: this is derived from the CATALOG SIZE, not from crawl
// freshness, because no timestamp reaches this payload. A stale-but-populated
// catalog therefore still reads healthy. Surfacing last-crawl age is the real fix
// and needs a contract field; naming that here so the next reader knows the dot
// is narrower than "everything is fine".
function CatalogStatus({ loaded, count }: { loaded: boolean; count?: number }) {
  const state = !loaded ? "loading" : count ? "ok" : "empty";
  const label =
    state === "loading" ? "Loading catalog…" : state === "ok" ? `${fmt(count!)} games` : "No data";
  return (
    <div className="side-foot side-status">
      <span className={"pulse pulse-" + state} aria-hidden="true"></span>
      <span role="status">
        {label}
        {state === "empty" && " · nothing crawled"}
      </span>
    </div>
  );
}

function SteamEmpty() {
  return (
    <div className="empty">
      <div className="big-ic">{I.steam}</div>
      <h2>No Steam data yet</h2>
      <p>
        Nothing has been crawled into this catalog, so there is no market to read. The figures,
        charts and rankings below would all be computed from an empty set — they are hidden rather
        than shown as zeroes, because a zero here means "unknown", not "none".
      </p>
      <p className="empty-next">
        Run <code>npm run crawl:steam</code> to populate it, or <code>npm run db:seed</code> for the
        deterministic sample catalog.
      </p>
    </div>
  );
}

function SteamView({
  data,
  section,
  onProject,
  filter,
  onClearFilter,
  onComparables,
}: {
  data: SteamOverview;
  section: SteamSection;
  onProject?: (seed: RevenueSeed) => void;
  filter?: ComparablesFilter | null;
  onClearFilter?: () => void;
  onComparables?: (f: ComparablesFilter) => void;
}) {
  // Applies to every section, not just the overview: with no catalog, Comparables,
  // Pricing and Market Gaps are equally empty, and each would render its own
  // confident-looking shell around nothing.
  if (!data.kpi.games) return <SteamEmpty />;
  if (section === "economics") return <GenreEconCard data={data} />;
  if (section === "pricing")
    return (
      <div className="card">
        {head(
          I.money,
          "Pricing & monetization",
          "indie cohort — what each price band is worth (owners × price)",
        )}
        <PricingTable rows={data.pricing} />
      </div>
    );
  if (section === "ownership")
    return (
      <div className="card">
        {head(
          I.trends,
          "Ownership, demand & engagement",
          "indie cohort — market size, live players & playtime by genre",
        )}
        <OwnershipTable rows={data.ownership} />
      </div>
    );
  if (section === "studios")
    return (
      <>
        <div className="card">
          {head(
            I.developers,
            "Top indie studios",
            "by owners — Steam exposes real developer names",
          )}
          <DevTable rows={data.developers} />
        </div>
        <div className="card">
          {head(I.releases, "Recent releases", "indie cohort, newest first")}
          <NewReleasesTable rows={data.newReleases} />
        </div>
        <div className="card">
          {head(
            I.releases,
            "Upcoming — pre-release demand",
            "unreleased titles, most-followed first · followers stand in for wishlists",
          )}
          <UpcomingTable rows={data.upcoming ?? []} />
        </div>
      </>
    );
  if (section === "comparables")
    return (
      <ComparablesCard
        rows={data.comparables}
        onProject={onProject}
        filter={filter}
        onClearFilter={onClearFilter}
      />
    );
  if (section === "opportunity")
    return (
      <div className="card">
        {head(
          I.gaps,
          "Opportunity — what to build next",
          "indie genre × tag: high demand, low supply, monetizable",
        )}
        <OppList gaps={data.opportunity} lens={data.steering} onComparables={onComparables} />
      </div>
    );
  // overview (default) — KPIs + tier distribution + highlights
  return (
    <>
      <ReadStrip lines={data.read} />
      <SteamKpis data={data} />
      <div className="card hero">
        {head(
          I.overview,
          "Scale-tier distribution",
          "inferred from reviews + owners + self-published · blue = indie cohort, grey = AAA context",
        )}
        <EChart option={tierBarOption(data.tiers)} style={{ minHeight: 240 }} />
      </div>
      <QuadrantCard points={data.quadrant} yName="median reviews" weightName="revenue proxy $" />
      <div className="grid g-2">
        <div className="card">
          {head(I.money, "Top indie genres", "by revenue proxy")}
          <EconTable rows={data.indie.slice(0, 6)} />
        </div>
        <div className="card">
          {head(I.gaps, "Top opportunities", "indie genre × tag")}
          <OppList
            gaps={data.opportunity.slice(0, 4)}
            lens={data.steering}
            onComparables={onComparables}
          />
        </div>
      </div>
    </>
  );
}

/* ───────────── shell ───────────── */
export function Radar({
  hidden,
  section,
  onSection,
  onGoto,
  onProject,
}: {
  hidden: boolean;
  /** Section slug from the URL, or null for this panel's default. */
  section?: string | null;
  /** Report a section move so the URL (and Back) follow it. */
  onSection?: (s: string | null) => void;
  /** Hand off to another service — the funnel's next step. */
  onGoto?: (svc: Service) => void;
  onProject?: (seed: RevenueSeed) => void;
}) {
  const drawer = useDrawer();
  const isDrawer = useIsDrawer();
  const [platform, setPlatform] = useState<Platform>(DEFAULT_PLATFORM);
  const [view, setView] = useState<View>("overview");
  const [steamView, setSteamView] = useState<SteamSection>("overview");
  // The gap → comparables hand-off (#69), the sibling of the Radar → Revenue seed one level
  // up. Both ends live inside Radar (Market Gaps is a section, Comparables a Steam section),
  // so the state lifts to this panel rather than the shell. Comparables exist only on Steam,
  // so a browser gap's jump switches the platform too.
  const [compFilter, setCompFilter] = useState<ComparablesFilter | null>(null);
  const jumpToComparables = (f: ComparablesFilter) => {
    setCompFilter(f);
    setPlatform("steam");
    setSteamView("comparables");
    onSection?.("comparables");
  };
  // The URL is the source of truth for which section is fronted: a deep link, a
  // hand-edited fragment and Back all arrive here. The panel validates the slug
  // against its own vocabulary and ignores anything it does not own.
  useEffect(() => {
    if (hidden) return;
    if (isSteamSection(section)) setSteamView(section);
    else if (isBrowserView(section)) setView(section);
    else if (section == null) {
      setSteamView("overview");
      setView("overview");
    }
  }, [section, hidden]);
  // A jump-in filter belongs to that visit: leaving Comparables drops it, so arriving later
  // from the nav shows the whole peer set rather than a silently narrowed one.
  useEffect(() => {
    if (steamView !== "comparables") setCompFilter(null);
  }, [steamView]);
  const [ov, setOv] = useState<Overview | null>(null);
  const [steam, setSteam] = useState<SteamOverview | null>(null);
  const [extra, setExtra] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  // Bumping this re-runs the load effect — the retry button's whole mechanism.
  // Previously a failed load was terminal: the only recovery was a page refresh,
  // which also discarded whichever panel and section the user was on.
  const [reloadNonce, setReloadNonce] = useState(0);
  const isSteam = platform === "steam";

  useEffect(() => {
    let on = true;
    setErr(null);
    if (isSteam) {
      setSteam(null);
      api.steam().then(
        (d) => on && setSteam(d),
        (e) => on && setErr(e),
      );
    } else {
      setOv(null);
      api.overview(platform).then(
        (d) => on && setOv(d),
        (e) => on && setErr(e),
      );
    }
    return () => {
      on = false;
    };
  }, [platform, reloadNonce]);

  useEffect(() => {
    let on = true;
    setExtra(null);
    if (isSteam)
      return () => {
        on = false;
      };
    const f =
      view === "genres"
        ? api.genres(platform)
        : view === "developers"
          ? api.developers(platform)
          : view === "new-releases"
            ? api.newReleases(platform)
            : view === "hidden-gems"
              ? api.hiddenGems(platform)
              : null;
    if (f) f.then((d) => on && setExtra(d));
    return () => {
      on = false;
    };
  }, [view, platform]);

  const gems = ov ? ov.scatter.filter((p) => p.gem).length : 0;
  // These were <a> with an onClick and no href. An anchor without href is not in
  // the tab order and does not fire on Enter, so the ENTIRE section navigation —
  // Genre Economics, Comparables, Market Gaps, the leaderboard, the engine picker
  // — was unreachable by keyboard or screen reader. They look and behave like
  // buttons, so they are buttons.
  const navItem = (key: View, icon: JSX.Element, label: string, badge?: number) => (
    <button
      type="button"
      className={"nav-item" + (view === key ? " active" : "")}
      aria-current={view === key ? "page" : undefined}
      onClick={() => {
        setView(key);
        onSection?.(key === "overview" ? null : key);
      }}
      key={key}
    >
      {icon}
      {label}
      {badge != null && <span className="badge">{badge}</span>}
    </button>
  );
  const steamNav = (key: SteamSection, icon: JSX.Element, label: string, badge?: number) => (
    <button
      type="button"
      className={"nav-item" + (steamView === key ? " active" : "")}
      aria-current={steamView === key ? "page" : undefined}
      onClick={() => {
        setSteamView(key);
        onSection?.(key === "overview" ? null : key);
      }}
      key={key}
    >
      {icon}
      {label}
      {badge != null && <span className="badge">{badge}</span>}
    </button>
  );

  const subtitle = isSteam ? (steam ? steam.subtitle : "loading…") : ov ? ov.subtitle : "loading…";

  return (
    <section className="service" data-svc="radar" hidden={hidden}>
      <aside
        {...drawerPanelProps(drawer, isDrawer, "Radar sections")}
        className={"side" + (drawer.open ? " open" : "")}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".nav-item")) drawer.closeDrawer();
        }}
      >
        <DrawerClose onClick={drawer.closeDrawer} />
        <div className="side-head">
          <b>GameRadar</b>
          <span>{isSteam ? "PC · Steam" : "market intel"}</span>
        </div>
        {isSteam ? (
          <>
            <div className="nav-label">Discover</div>
            {steamNav("overview", I.overview, "Overview")}
            {steamNav("economics", I.genres, "Genre Economics")}
            {steamNav("pricing", I.money, "Pricing")}
            {steamNav("ownership", I.trends, "Ownership")}
            {steamNav("studios", I.developers, "Studios & Releases")}
            <div className="nav-label">Opportunity</div>
            {steamNav(
              "comparables",
              I.gems,
              "Comparables",
              steam ? steam.comparables.length : undefined,
            )}
            {steamNav(
              "opportunity",
              I.gaps,
              "Market Gaps",
              steam ? steam.opportunity.length : undefined,
            )}
          </>
        ) : (
          <>
            <div className="nav-label">Discover</div>
            {navItem("overview", I.overview, "Overview")}
            {navItem("genres", I.genres, "Genre Explorer")}
            {navItem("tags", I.tags, "Tag Explorer")}
            {navItem("developers", I.developers, "Developers")}
            {navItem("trends", I.trends, "Trends")}
            <div className="nav-label">Opportunity</div>
            {navItem("hidden-gems", I.gems, "Hidden Gems", ov ? gems : undefined)}
            {navItem("new-releases", I.releases, "New Releases", ov ? ov.kpi.newGames : undefined)}
            {navItem("market-gaps", I.gaps, "Market Gaps", ov ? ov.kpi.openGaps : undefined)}
          </>
        )}
        <CatalogStatus
          loaded={isSteam ? !!steam : !!ov}
          count={isSteam ? steam?.kpi.games : ov?.kpi.gamesTracked}
        />
      </aside>
      <NavScrim open={drawer.open} onClose={drawer.closeDrawer} />

      <main className="main">
        <div className="topbar">
          <NavToggle onClick={drawer.openDrawer} />
          <h1>
            {isSteam ? "Steam (PC) Market" : "Market Overview"} <small>{subtitle}</small>
          </h1>
          <div className="platform-groups">
            {PLATFORM_GROUPS.map((grp) => (
              <TabList
                key={grp.group}
                groupLabel={grp.group}
                label={`Platform — ${grp.group}`}
                panelId="radar-panel"
                value={platform}
                onChange={setPlatform}
                tabs={grp.items.map((p) => ({
                  id: p.id,
                  label: p.label,
                }))}
              />
            ))}
          </div>
        </div>

        <div className="content" id="radar-panel" role="tabpanel" aria-label="Market data">
          {err != null && <LoadFailure error={err} onRetry={() => setReloadNonce((n) => n + 1)} />}
          {isSteam ? (
            steam ? (
              <SteamView
                data={steam}
                section={steamView}
                onProject={onProject}
                filter={compFilter}
                onClearFilter={() => setCompFilter(null)}
                onComparables={jumpToComparables}
              />
            ) : (
              <Skel />
            )
          ) : (
            <>
              {view === "overview" &&
                (ov ? <OverviewView ov={ov} onComparables={jumpToComparables} /> : <Skel />)}
              {view === "genres" && (extra ? <GenresView rows={extra} /> : <Skel />)}
              {view === "tags" && (ov ? <TagsView ov={ov} /> : <Skel />)}
              {view === "developers" &&
                (extra ? <DevelopersView rows={extra} platform={platform} /> : <Skel />)}
              {view === "trends" && (ov ? <TrendsView ov={ov} /> : <Skel />)}
              {view === "hidden-gems" && (ov ? <GemsView ov={ov} rows={extra} /> : <Skel />)}
              {view === "new-releases" && (extra ? <NewReleasesView rows={extra} /> : <Skel />)}
              {view === "market-gaps" &&
                (ov ? (
                  <>
                    <div className="card">
                      {head(I.gaps, "Market Gaps", "ranked by opportunity score")}
                      <GapList gaps={ov.gaps} onComparables={jumpToComparables} />
                    </div>
                    <LoopFamilyMarketCard platform={platform} />
                  </>
                ) : (
                  <Skel />
                ))}
            </>
          )}
          <Handoff
            links={[
              {
                label: "Shape a pitch from a gap",
                hint: "take an underserved market into the Library",
                onClick: () => onGoto?.("library"),
              },
              {
                label: "Project the revenue",
                hint: "can this clear the monthly target?",
                onClick: () => onGoto?.("revenue"),
              },
            ]}
          />
        </div>
      </main>
    </section>
  );
}
