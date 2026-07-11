import { useEffect, useState } from "react";
import { useDrawer, NavToggle, NavScrim, DrawerClose } from "../components/MobileNav.tsx";
import type {
  Overview, Platform, GenreRow, DeveloperRow, NewRelease, HiddenGem,
  SteamOverview, SteamGenreEconomics, SteamGap, SteamPriceBand, SteamOwnershipRow,
  SteamDeveloperRow, SteamNewRelease, SteamComparable,
} from "shared";
import { api } from "../lib/api.ts";
import type { RevenueSeed } from "../lib/steamRevenue.ts";
import { EChart } from "../components/EChart.tsx";
import { momentumOption, treemapOption, scatterOption, heatmapOption, landscapeOption, velocityBarOption, tierBarOption } from "../components/charts.ts";
import { InsightSvg, tagClass } from "../components/icons.tsx";

const fmt = (n: number) => n.toLocaleString("en-US");
const MIN_TREND_DAYS = 5;
// Platforms grouped by category to reflect the hierarchy: "All Browser" aggregates its
// children (CrazyGames + Poki); Steam is the PC surface (an "all PC" of one, for now).
// CrazyGames is listed before Poki by preference.
const PLATFORM_GROUPS: { group: string; items: { id: Platform; label: string }[] }[] = [
  { group: "Browser", items: [
    { id: "all", label: "All Browser" },
    { id: "crazygames", label: "CrazyGames" },
    { id: "poki", label: "Poki" },
  ] },
  { group: "PC", items: [
    { id: "steam", label: "Steam" },
  ] },
];

// ── Steam formatting helpers ──
const fmtOwners = (n: number | null) =>
  n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);
const money = (cents: number | null) =>
  cents == null ? "—" : cents === 0 ? "Free" : "$" + (cents / 100).toFixed(2);
const proxy = (d: number) =>
  d >= 1e9 ? "$" + (d / 1e9).toFixed(1) + "B" : d >= 1e6 ? "$" + (d / 1e6).toFixed(2) + "M" : d >= 1e3 ? "$" + Math.round(d / 1e3) + "K" : "$" + d;
const rate = (r: number | null) => (r == null ? "—" : r.toFixed(2));
const TIER_META: Record<string, { label: string; cls: string }> = {
  hobby: { label: "hobby", cls: "t-hobby" },
  small_indie: { label: "small", cls: "t-small" },
  est_indie: { label: "est. indie", cls: "t-est" },
  aaa: { label: "AAA", cls: "t-aaa" },
};

type View = "overview" | "genres" | "tags" | "developers" | "trends" | "hidden-gems" | "new-releases" | "market-gaps";
type SteamSection = "overview" | "economics" | "pricing" | "ownership" | "studios" | "comparables" | "opportunity";
const I = {
  overview: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>,
  genres: <svg viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></svg>,
  tags: <svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="9" cy="17" r="2.5" /><path d="M8 7l8 1M8 8l1 7M16 10l-6 6" /></svg>,
  developers: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" /></svg>,
  trends: <svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></svg>,
  gems: <svg viewBox="0 0 24 24"><path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" /></svg>,
  releases: <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14" /><circle cx="12" cy="12" r="9" /></svg>,
  gaps: <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 2v10l7-7" /></svg>,
  steam: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="15" cy="9" r="2.5" /><path d="M6 14l4 1.6" /><circle cx="9.5" cy="15.5" r="1.6" /></svg>,
  money: <svg viewBox="0 0 24 24"><path d="M12 3v18M8 7h6a2.5 2.5 0 0 1 0 5H9a2.5 2.5 0 0 0 0 5h7" /></svg>,
};

const Skel = ({ h = 300 }: { h?: number }) => <div className="card"><div className="skeleton" style={{ height: h }} /></div>;
const head = (icon: JSX.Element, title: string, sub?: string) => (
  <h3>{icon}{title}{sub && <span className="sub">{sub}</span>}</h3>
);
const deltaCls = (d: number) => (d > 3 ? "delta-up" : d < -3 ? "delta-dn" : "delta-fl");
const TRAJ_LABEL: Record<string, string> = { rising: "▲ rising", plateau: "▬ plateau", decaying: "▼ decaying", new: "· new" };

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

/* ───────────── views ───────────── */
function OverviewView({ ov }: { ov: Overview }) {
  return (
    <>
      <ReadStrip lines={ov.read} />
      <div className="kpis">
        <div className="kpi"><div className="label">{I.overview}Games tracked</div><div className="val num">{fmt(ov.kpi.gamesTracked)}</div><span className="delta up num">▲ {ov.kpi.newGames} new (14d)</span></div>
        <div className="kpi"><div className="label">★ Avg rating</div><div className="val num">{ov.kpi.avgRating.toFixed(2)}</div><span className="delta flat num">P90 {ov.kpi.avgRatingP90.toFixed(2)} · point-in-time</span></div>
        <div className="kpi"><div className="label">{I.trends}Rising genre</div><div className="val num" style={{ fontSize: 24, paddingTop: 4 }}>{ov.kpi.risingGenre}</div><span className="delta up num">▲ +{ov.kpi.risingVotesPerDay} votes/day</span></div>
        <div className="kpi accent"><div className="label">{I.gaps}Open market gaps</div><div className="val num">{ov.kpi.openGaps}</div><span className="delta up num">appetite &gt; supply</span></div>
      </div>
      <div className="card hero">{head(I.genres, "Genre landscape", "supply × quality × audience — top-left = green-field")}<EChart option={landscapeOption(ov.landscape)} style={{ minHeight: 360 }} /></div>
      <div className="grid g-2">
        <div className="card">{head(I.trends, "Genre vote-velocity", "votes/day by genre — gainers vs flat/decliners")}<EChart option={velocityBarOption(ov.velocityBars)} /></div>
        <div className="card">{head(I.gems, "AI Insights", "auto-generated")}
          <div className="insights">{ov.insights.map((ins, i) => (
            <div className="insight" key={i}><div className={"ic " + ins.kind}><InsightSvg kind={ins.kind} /></div>
              <div className="body"><p dangerouslySetInnerHTML={{ __html: ins.text }} />
                {ins.implication && <p className="implication">→ {ins.implication}</p>}
                <div className="meta"><span className={"tag-op " + tagClass(ins.kind)}>{ins.tag}</span><span>{ins.meta}</span></div></div></div>
          ))}</div>
        </div>
      </div>
      <div className="grid g-2b">
        <div className="card">{head(I.tags, "Tag frequency", "top tags by game count")}<EChart option={treemapOption(ov.tags)} /></div>
        <div className="card">{head(I.gems, "Hidden-gem finder", "rating × visibility")}<EChart option={scatterOption(ov.scatter)} /></div>
      </div>
      <div className="grid g-2">
        <div className="card">{head(I.overview, "Rating-band density", "genre × rating band (game counts)")}<EChart option={heatmapOption(ov.heatmap)} style={{ minHeight: 260 }} /></div>
        <div className="card">{head(I.gaps, "Top market gaps", "appetite × quality × supply")}<GapList gaps={ov.gaps} /></div>
      </div>
      <div className="card">{head(I.tags, "Tag glossary", "what the tags on this dashboard mean — definition + example games")}
        <table className="dtable"><thead><tr><th>Tag</th><th>What it describes</th><th>Example games</th></tr></thead>
          <tbody>{ov.glossary.map((r) => (
            <tr key={r.label}><td className="gname">{r.label}</td>
              <td style={{ maxWidth: 360 }}>{r.definition}</td>
              <td style={{ color: "var(--ink-3, #6b7280)" }}>{r.examples.join(" · ") || "—"}</td></tr>
          ))}</tbody></table>
      </div>
    </>
  );
}

// The opportunity score is not a black box (#12): the exact formula is stated in each
// list's legend and unpacked here. Pinned by the server test "opportunity score formula".
const Z_TIP = "z(x) = how many standard deviations x sits above the average across all genre × tag pairs ranked here. Positive score = better opportunity than the average pair; each term contributes roughly ±1 per standard deviation.";

function GapList({ gaps }: { gaps: Overview["gaps"] }) {
  return (
    <div className="gaplist">
      <p className="gap-legend" title={Z_TIP}>opportunity = z(appetite: median votes/title) + z(quality ceiling: P90 rating) − z(supply: games)</p>
      {gaps.map((g, i) => (
        <div className="gap" key={i}><span className="rank num">{i + 1}</span>
          <div className="name">{g.label}<small title={Z_TIP}>opportunity {g.score.toFixed(1)}</small></div>
          <div className="gap-stats num">
            <span><b>{fmt(g.appetite)}</b> median votes/title</span>
            <span><b>{g.supplyN}</b> games</span>
            <span>top rating <b>{g.qualityCeil.toFixed(2)}</b></span>
          </div>
          {g.examples?.length ? <div className="gap-examples num">e.g. {g.examples.join(" · ")}</div> : null}
        </div>
      ))}
    </div>
  );
}

function GenresView({ rows }: { rows: GenreRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.games));
  return (
    <div className="card">{head(I.genres, "Genre Explorer", `${rows.length} genres`)}
      <table className="dtable"><thead><tr><th>Genre</th><th className="r">Games</th><th className="r">Avg rating</th><th className="r">Median votes</th><th className="r">P90 votes (top-10% bar)</th><th className="r">P90 rating</th><th className="r">Votes/day</th><th title="Later-half momentum vs earlier-half of the genre's median-vote series: rising / plateau / decaying">Trend</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.genre}><td className="gname">{r.genre}<span className="minibar"><i style={{ width: (r.games / max) * 100 + "%" }} /></span></td>
            <td className="r">{r.games}</td><td className="r">{r.avgRating.toFixed(2)}</td><td className="r">{fmt(r.medianVotes)}</td><td className="r">{fmt(r.p90Votes)}</td>
            <td className="r">{r.p90Rating.toFixed(2)}</td>
            <td className={"r " + deltaCls(r.votesPerDay)}>{r.votesPerDay > 0 ? "+" : ""}{fmt(r.votesPerDay)}</td>
            <td><span className={"traj traj-" + r.trajectory}>{TRAJ_LABEL[r.trajectory] || r.trajectory}</span></td></tr>
        ))}</tbody></table>
    </div>
  );
}

function TagsView({ ov }: { ov: Overview }) {
  const max = Math.max(1, ...ov.tags.map((t) => t.count));
  return (
    <div className="grid g-2b">
      <div className="card">{head(I.tags, "Tag treemap", "by game count")}<EChart option={treemapOption(ov.tags)} style={{ minHeight: 360 }} /></div>
      <div className="card">{head(I.tags, "Tag frequency", `${ov.tags.length} tags · game count`)}
        <table className="dtable"><thead><tr><th>Tag</th><th className="r">Games</th></tr></thead>
          <tbody>{ov.tags.map((t) => (<tr key={t.tag}><td className="gname">{t.tag}<span className="minibar"><i style={{ width: (t.count / max) * 100 + "%" }} /></span></td><td className="r">{fmt(t.count)}</td></tr>))}</tbody></table>
      </div>
    </div>
  );
}

function DevelopersView({ rows, platform }: { rows: DeveloperRow[]; platform: Platform }) {
  if (!rows.length)
    return (
      <div className="card"><div className="empty"><div className="big-ic">{I.developers}</div><h3>No developer data yet</h3>
        <p>CrazyGames doesn't expose developer names — Poki does. Once the Poki crawl runs, repeat publishers show up here.</p></div></div>
    );
  return (
    <div className="card">{head(I.developers, "Developer Explorer", `${rows.length} developers`)}
      {(platform === "all" || platform === "crazygames") && (
        <p className="view-head">Developer names come from Poki; CrazyGames doesn't expose them.</p>
      )}
      <table className="dtable"><thead><tr><th>Developer</th><th className="r">Games</th><th className="r">Avg rating</th><th className="r">Avg votes</th><th>Top genre</th></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.developer}><td className="gname">{r.developer}</td><td className="r">{r.games}</td><td className="r">{r.avgRating.toFixed(2)}</td><td className="r">{fmt(r.avgVotes)}</td><td>{r.topGenre}</td></tr>))}</tbody></table>
    </div>
  );
}

function TrendsView({ ov }: { ov: Overview }) {
  return (
    <>
      <div className="card">{head(I.trends, "Genre momentum", "median votes/day by genre over the crawl window")}
        {ov.momentum.dates.length >= MIN_TREND_DAYS
          ? <EChart option={momentumOption(ov.momentum)} style={{ minHeight: 340 }} />
          : <div className="empty-inline" style={{ padding: "28px 8px", color: "var(--ink-3, #6b7280)", fontSize: 13, lineHeight: 1.6 }}>
              Genre momentum builds as the daily crawl accrues — <b>{ov.momentum.dates.length} crawl day{ov.momentum.dates.length === 1 ? "" : "s"}</b> so far.
              Multi-day vote trajectories become meaningful after about a week; for now see <b>Genre vote-velocity</b> on the Overview for what's gaining today.
            </div>}
      </div>
      <div className="card">{head(I.genres, "Genre landscape", "supply × quality × audience — top-left = green-field")}<EChart option={landscapeOption(ov.landscape)} style={{ minHeight: 360 }} /></div>
      <div className="card">{head(I.overview, "Rating-band density", "genre × rating band (game counts)")}<EChart option={heatmapOption(ov.heatmap)} style={{ minHeight: 300 }} /></div>
    </>
  );
}

function GemsView({ ov, rows }: { ov: Overview; rows: HiddenGem[] | null }) {
  return (
    <>
      <div className="card">{head(I.gems, "Hidden-gem finder", "high rating × low visibility")}<EChart option={scatterOption(ov.scatter)} style={{ minHeight: 320 }} /></div>
      <div className="card">{head(I.gems, "Hidden gems", rows ? `${rows.length} found` : "…")}
        {!rows ? <div className="skeleton" style={{ height: 200 }} /> : (
          <table className="dtable"><thead><tr><th>Game</th><th>Genre</th><th className="r">Rating</th><th className="r">Votes</th></tr></thead>
            <tbody>{rows.map((r) => (<tr key={r.gameId}><td className="gname">{r.title}</td><td>{r.genre}</td><td className="r" style={{ color: "var(--green)", fontWeight: 600 }}>{r.rating.toFixed(2)}</td><td className="r">{fmt(r.votes)}</td></tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}

function NewReleasesView({ rows }: { rows: NewRelease[] }) {
  return (
    <div className="card">{head(I.releases, "New Releases", `${rows.length} new in last 14 days · age-adjusted momentum`)}
      <table className="dtable"><thead><tr><th>Game</th><th>Genre</th><th className="r">Rating</th><th className="r">Votes</th><th className="r" title="Votes gained per day over the tracked window — a rocket and a dead evergreen with equal total votes read differently here">Votes/day</th><th title="Later-half momentum vs earlier-half: rising / plateau / decaying">Trend</th></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.gameId}><td><a className="gname" href={r.url} target="_blank" rel="noreferrer">{r.title}</a></td><td>{r.genre}</td><td className="r">{r.rating ? r.rating.toFixed(2) : "—"}</td><td className="r">{fmt(r.votes)}</td><td className="r">{r.votesPerDay > 0 ? "+" + fmt(r.votesPerDay) : "—"}</td><td><span className={"traj traj-" + r.trajectory}>{TRAJ_LABEL[r.trajectory] || r.trajectory}</span></td></tr>))}</tbody></table>
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
const MED_REV_TIP = "Median revenue proxy per game — the typical outcome for one title in this genre. Resists mega-hit skew; the honest solo-dev opportunity read.";
const MEAN_REV_TIP = "Mean revenue proxy per game (total ÷ games). Mean far above median = top-heavy category where a few hits hold most of the pool.";
const TOTAL_REV_TIP = "Total revenue proxy = Σ owners × current price across the genre (directional, not a P&L). Measures category size, not per-game opportunity.";

function EconTable({ rows }: { rows: SteamGenreEconomics[] }) {
  return (
    <table className="dtable"><thead><tr><th>Genre</th><th className="r">Games</th><th className="r">Median price</th><th className="r">Median rating</th><th className="r" title={OWNERS_TIP}>Total owners</th><th className="r" title={MED_REV_TIP}>Median rev/game</th><th className="r" title={MEAN_REV_TIP}>Mean rev/game</th><th className="r" title={TOTAL_REV_TIP}>Total rev proxy</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.genre}><td className="gname">{r.genre}</td>
          <td className="r">{r.games}</td><td className="r">{money(r.medianPriceCents)}</td>
          <td className="r">{rate(r.medianRating)}</td><td className="r">{fmtOwners(r.totalOwners)}</td>
          <td className="r" style={{ fontWeight: 600 }}>{proxy(r.medianRevenuePerGame)}</td>
          <td className="r">{proxy(r.meanRevenuePerGame)}</td>
          <td className="r">{proxy(r.revenueProxy)}</td></tr>
      ))}</tbody></table>
  );
}

function OppList({ gaps }: { gaps: SteamGap[] }) {
  if (!gaps.length) return <p className="view-head">Not enough indie data yet to rank genre × tag opportunities — accrues as the crawl grows.</p>;
  return (
    <div className="gaplist">
      <p className="gap-legend" title={Z_TIP}>opportunity = z(demand: median owners) + z(quality ceiling: P90 rating) − z(supply: games) · median price is context, not scored</p>
      {gaps.map((g, i) => (
        <div className="gap" key={i}><span className="rank num">{i + 1}</span>
          <div className="name">{g.label}<small title={Z_TIP}>opportunity {g.score.toFixed(1)}</small></div>
          <div className="gap-stats num">
            <span><b>{fmtOwners(g.medianOwners)}</b> median owners</span>
            <span><b>{g.supplyN}</b> games</span>
            <span>top rating <b>{g.qualityCeil.toFixed(2)}</b></span>
            <span>median <b>{money(g.medianPriceCents)}</b></span>
          </div>
          {g.examples?.length ? <div className="gap-examples num">e.g. {g.examples.join(" · ")}</div> : null}
        </div>
      ))}
    </div>
  );
}

function PricingTable({ rows }: { rows: SteamPriceBand[] }) {
  return (
    <table className="dtable"><thead><tr><th>Price band</th><th className="r">Games</th><th className="r">Median rating</th><th className="r" title={OWNERS_TIP}>Total owners</th><th className="r" title={PROXY_TIP}>Revenue proxy</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.band}><td className="gname">{r.band}</td><td className="r">{r.games}</td><td className="r">{rate(r.medianRating)}</td><td className="r">{fmtOwners(r.totalOwners)}</td><td className="r" style={{ fontWeight: 600 }}>{proxy(r.revenueProxy)}</td></tr>
      ))}</tbody></table>
  );
}

function OwnershipTable({ rows }: { rows: SteamOwnershipRow[] }) {
  return (
    <table className="dtable"><thead><tr><th>Genre</th><th className="r">Games</th><th className="r" title={OWNERS_TIP}>Total owners</th><th className="r">Median owners</th><th className="r">Live CCU</th><th className="r">Median playtime</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.genre}><td className="gname">{r.genre}</td><td className="r">{r.games}</td><td className="r">{fmtOwners(r.totalOwners)}</td><td className="r">{fmtOwners(r.medianOwners)}</td><td className="r">{fmt(r.ccu)}</td><td className="r">{playH(r.medianPlaytimeMin)}</td></tr>
      ))}</tbody></table>
  );
}

function DevTable({ rows }: { rows: SteamDeveloperRow[] }) {
  return (
    <table className="dtable"><thead><tr><th>Developer</th><th className="r">Games</th><th className="r" title={OWNERS_TIP}>Total owners</th><th className="r">Avg rating</th><th>Top genre</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.developer}><td className="gname">{r.developer}</td><td className="r">{r.games}</td><td className="r">{fmtOwners(r.totalOwners)}</td><td className="r">{r.avgRating.toFixed(2)}</td><td>{r.topGenre}</td></tr>
      ))}</tbody></table>
  );
}

function NewReleasesTable({ rows }: { rows: SteamNewRelease[] }) {
  return (
    <table className="dtable"><thead><tr><th>Game</th><th className="r">Released</th><th>Genre</th><th className="r">Rating</th><th className="r" title={OWNERS_TIP}>Owners</th><th className="r">Price</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i}><td className="gname">{r.title}</td><td className="r">{r.releaseDate ?? "—"}</td><td>{r.genre}</td><td className="r">{rate(r.rating)}</td><td className="r">{fmtOwners(r.owners)}</td><td className="r">{money(r.priceCents)}</td></tr>
      ))}</tbody></table>
  );
}

const TEAM_META: Record<string, { label: string; cls: string }> = {
  solo: { label: "Solo", cls: "team-solo" }, small: { label: "Small", cls: "team-small" },
  mid: { label: "Mid", cls: "team-mid" }, large: { label: "Large", cls: "team-large" },
};
const isSoloReachable = (c: SteamComparable) => c.teamSize != null && (c.teamSize.bucket === "solo" || c.teamSize.bucket === "small");
const TEAM_TIP = "Team size is not in any Steam/3rd-party API — these are researched estimates (bucket by the team that shipped the studio's breakout). Click for the source.";
const VELOCITY_TIP = "Reviews gained per day over the trailing 30-day snapshot window — the public leading-indicator proxy for wishlist velocity (wishlist counts aren't acquirable). Total reviews/owners lag a launch by months; this doesn't. — = not enough snapshot history yet.";

const PROJECT_TIP = "Load this game into the Revenue model as an anchor — its price prefills the calculator and its real outcome (owners × price) shows beside your projection.";

function ComparablesTable({ rows, onProject }: { rows: SteamComparable[]; onProject?: (seed: RevenueSeed) => void }) {
  return (
    <table className="dtable"><thead><tr><th>Game</th><th>Tier</th><th title={TEAM_TIP}>Team (est.)</th><th>Genre</th><th className="r">Released</th><th className="r">Rating</th><th className="r">Reviews</th><th className="r" title={VELOCITY_TIP}>Rev./day</th><th className="r" title={OWNERS_TIP}>Owners</th><th className="r">Price</th><th>Developer</th>{onProject && <th title={PROJECT_TIP}></th>}</tr></thead>
      <tbody>{rows.map((c, i) => {
        const tm = TIER_META[c.tier] ?? { label: c.tier, cls: "t-hobby" };
        const ts = c.teamSize;
        const meta = ts ? TEAM_META[ts.bucket] : null;
        return (
          <tr key={i}><td className="gname">{c.title}</td>
            <td><span className={"tier-chip " + tm.cls}>{tm.label}</span></td>
            <td>{ts && meta
              ? <a className={"est-chip " + meta.cls} href={ts.source} target="_blank" rel="noreferrer" title={`${ts.headcount} · ${ts.confidence} confidence · estimated`}>{meta.label} · est.</a>
              : <span className="est-chip est-unknown" title="Team size not researched yet">—</span>}</td>
            <td>{c.genre}</td><td className="r">{c.releaseDate ? c.releaseDate.slice(0, 4) : "—"}</td>
            <td className="r">{rate(c.rating)}</td><td className="r">{c.votes == null ? "—" : fmt(c.votes)}</td>
            <td className="r">{c.reviewVelocity == null ? "—" : fmt(c.reviewVelocity)}</td>
            <td className="r">{fmtOwners(c.owners)}</td><td className="r">{money(c.priceCents)}</td>
            <td style={{ color: "var(--ink-3, #6b7280)" }}>{c.developer ?? "—"}</td>
            {onProject && <td className="r"><button type="button" className="project-btn" title={PROJECT_TIP}
              onClick={() => onProject({ title: c.title, priceCents: c.priceCents, owners: c.owners, votes: c.votes, reviewVelocity: c.reviewVelocity })}>
              → project</button></td>}</tr>
        );
      })}</tbody></table>
  );
}

function ComparablesCard({ rows, onProject }: { rows: SteamComparable[]; onProject?: (seed: RevenueSeed) => void }) {
  const [cohort, setCohort] = useState<"all" | "solo">("all");
  const shown = cohort === "solo" ? rows.filter(isSoloReachable) : rows;
  const soloN = rows.filter(isSoloReachable).length;
  return (
    <div className="card">
      <h3>{I.gems}Indie comparables<span className="sub">the realistic peer set — indie-tier games, most recent first</span>
        <span className="seg" role="tablist" aria-label="Cohort" style={{ marginLeft: "auto" }}>
          <button className={"seg-btn" + (cohort === "all" ? " active" : "")} onClick={() => setCohort("all")}>All ({rows.length})</button>
          <button className={"seg-btn" + (cohort === "solo" ? " active" : "")} onClick={() => setCohort("solo")}>Solo-reachable ({soloN})</button>
        </span>
      </h3>
      {cohort === "solo" && <p className="view-head">Studios a <b>1–2 or 3–10 person</b> team could realistically match, by researched team-size estimate. Untagged studios are hidden rather than assumed solo.</p>}
      {shown.length ? <ComparablesTable rows={shown} onProject={onProject} /> : <p className="view-head">No solo-reachable comparables tagged in the current set yet.</p>}
    </div>
  );
}

function SteamKpis({ data }: { data: SteamOverview }) {
  return (
    <div className="kpis">
      <div className="kpi"><div className="label">{I.steam}Steam games</div><div className="val num">{fmt(data.kpi.games)}</div><span className="delta flat num">{data.kpi.ratedPct}% have reviews</span></div>
      <div className="kpi accent"><div className="label">{I.gems}Indie cohort</div><div className="val num">{fmt(data.kpi.indie)}</div><span className="delta up num">addressable for a solo dev</span></div>
      <div className="kpi"><div className="label">{I.overview}AAA (context)</div><div className="val num">{fmt(data.kpi.aaa)}</div><span className="delta flat num">excluded from benchmarks</span></div>
      <div className="kpi"><div className="label">{I.money}Indie median price</div><div className="val num">{money(data.kpi.indieMedianPriceCents)}</div><span className="delta flat num">what indies charge</span></div>
    </div>
  );
}

function GenreEconCard({ data }: { data: SteamOverview }) {
  const [cohort, setCohort] = useState<"indie" | "all">("indie");
  return (
    <div className="card">
      <h3>{I.money}Genre economics<span className="sub">owners × realized price — what a genre is worth at this scale</span>
        <span className="seg" role="tablist" aria-label="Cohort" style={{ marginLeft: "auto" }}>
          <button className={"seg-btn" + (cohort === "indie" ? " active" : "")} onClick={() => setCohort("indie")}>Indie</button>
          <button className={"seg-btn" + (cohort === "all" ? " active" : "")} onClick={() => setCohort("all")}>All tiers</button>
        </span>
      </h3>
      {cohort === "all" && <p className="view-head">All tiers include AAA — owners/revenue are dominated by mega-hits; demand context only, <b>not</b> a solo-dev benchmark.</p>}
      <EconTable rows={cohort === "indie" ? data.indie : data.all} />
    </div>
  );
}

function SteamView({ data, section, onProject }: { data: SteamOverview; section: SteamSection; onProject?: (seed: RevenueSeed) => void }) {
  if (section === "economics") return <GenreEconCard data={data} />;
  if (section === "pricing")
    return <div className="card">{head(I.money, "Pricing & monetization", "indie cohort — what each price band is worth (owners × price)")}<PricingTable rows={data.pricing} /></div>;
  if (section === "ownership")
    return <div className="card">{head(I.trends, "Ownership, demand & engagement", "indie cohort — market size, live players & playtime by genre")}<OwnershipTable rows={data.ownership} /></div>;
  if (section === "studios")
    return (
      <>
        <div className="card">{head(I.developers, "Top indie studios", "by owners — Steam exposes real developer names")}<DevTable rows={data.developers} /></div>
        <div className="card">{head(I.releases, "Recent releases", "indie cohort, newest first")}<NewReleasesTable rows={data.newReleases} /></div>
      </>
    );
  if (section === "comparables")
    return <ComparablesCard rows={data.comparables} onProject={onProject} />;
  if (section === "opportunity")
    return <div className="card">{head(I.gaps, "Opportunity — what to build next", "indie genre × tag: high demand, low supply, monetizable")}<OppList gaps={data.opportunity} /></div>;
  // overview (default) — KPIs + tier distribution + highlights
  return (
    <>
      <ReadStrip lines={data.read} />
      <SteamKpis data={data} />
      <div className="card hero">{head(I.overview, "Scale-tier distribution", "inferred from reviews + owners + self-published · blue = indie cohort, grey = AAA context")}
        <EChart option={tierBarOption(data.tiers)} style={{ minHeight: 240 }} /></div>
      <div className="grid g-2">
        <div className="card">{head(I.money, "Top indie genres", "by revenue proxy")}<EconTable rows={data.indie.slice(0, 6)} /></div>
        <div className="card">{head(I.gaps, "Top opportunities", "indie genre × tag")}<OppList gaps={data.opportunity.slice(0, 4)} /></div>
      </div>
    </>
  );
}

/* ───────────── shell ───────────── */
export function Radar({ hidden, onProject }: { hidden: boolean; onProject?: (seed: RevenueSeed) => void }) {
  const drawer = useDrawer();
  const [platform, setPlatform] = useState<Platform>("all");
  const [view, setView] = useState<View>("overview");
  const [steamView, setSteamView] = useState<SteamSection>("overview");
  const [ov, setOv] = useState<Overview | null>(null);
  const [steam, setSteam] = useState<SteamOverview | null>(null);
  const [extra, setExtra] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const isSteam = platform === "steam";

  useEffect(() => {
    let on = true;
    setErr(null);
    if (isSteam) {
      setSteam(null);
      api.steam().then((d) => on && setSteam(d), (e) => on && setErr(String(e)));
    } else {
      setOv(null);
      api.overview(platform).then((d) => on && setOv(d), (e) => on && setErr(String(e)));
    }
    return () => { on = false; };
  }, [platform]);

  useEffect(() => {
    let on = true;
    setExtra(null);
    if (isSteam) return () => { on = false; };
    const f = view === "genres" ? api.genres(platform) : view === "developers" ? api.developers(platform)
      : view === "new-releases" ? api.newReleases(platform) : view === "hidden-gems" ? api.hiddenGems(platform) : null;
    if (f) f.then((d) => on && setExtra(d));
    return () => { on = false; };
  }, [view, platform]);

  const gems = ov ? ov.scatter.filter((p) => p.gem).length : 0;
  const navItem = (key: View, icon: JSX.Element, label: string, badge?: number) => (
    <a className={"nav-item" + (view === key ? " active" : "")} onClick={() => setView(key)} key={key}>
      {icon}{label}{badge != null && <span className="badge">{badge}</span>}
    </a>
  );
  const steamNav = (key: SteamSection, icon: JSX.Element, label: string, badge?: number) => (
    <a className={"nav-item" + (steamView === key ? " active" : "")} onClick={() => setSteamView(key)} key={key}>
      {icon}{label}{badge != null && <span className="badge">{badge}</span>}
    </a>
  );

  const subtitle = isSteam ? (steam ? steam.subtitle : "loading…") : (ov ? ov.subtitle : "loading…");

  return (
    <section className="service" data-svc="radar" hidden={hidden}>
      <aside
        className={"side" + (drawer.open ? " open" : "")}
        onClick={(e) => { if ((e.target as HTMLElement).closest(".nav-item")) drawer.closeDrawer(); }}
      >
        <DrawerClose onClick={drawer.closeDrawer} />
        <div className="side-head"><b>GameRadar</b><span>{isSteam ? "PC · Steam" : "market intel"}</span></div>
        {isSteam ? (
          <>
            <div className="nav-label">Discover</div>
            {steamNav("overview", I.overview, "Overview")}
            {steamNav("economics", I.genres, "Genre Economics")}
            {steamNav("pricing", I.money, "Pricing")}
            {steamNav("ownership", I.trends, "Ownership")}
            {steamNav("studios", I.developers, "Studios & Releases")}
            <div className="nav-label">Opportunity</div>
            {steamNav("comparables", I.gems, "Comparables", steam ? steam.comparables.length : undefined)}
            {steamNav("opportunity", I.gaps, "Market Gaps", steam ? steam.opportunity.length : undefined)}
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
        <div className="side-foot"><span className="pulse"></span>Crawl OK · {isSteam ? (steam ? fmt(steam.kpi.games) : "…") : (ov ? fmt(ov.kpi.gamesTracked) : "…")} games<br />live · Neon</div>
      </aside>
      <NavScrim open={drawer.open} onClose={drawer.closeDrawer} />

      <main className="main">
        <div className="topbar">
          <NavToggle onClick={drawer.openDrawer} />
          <h2>{isSteam ? "Steam (PC) Market" : "Market Overview"} <small>{subtitle}</small></h2>
          <div className="platform-groups" role="tablist" aria-label="Platform">
            {PLATFORM_GROUPS.map((grp) => (
              <div className="seg-group" key={grp.group}>
                <span className="seg-group-label">{grp.group}</span>
                <div className="seg">
                  {grp.items.map((p) => (
                    <button key={p.id} className={"seg-btn" + (platform === p.id ? " active" : "")} role="tab" aria-selected={platform === p.id} onClick={() => setPlatform(p.id)}>
                      <span className={"dot " + p.id}></span>{p.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="content">
          {err && <div className="card" style={{ color: "var(--red)" }}>Failed to load: {err}</div>}
          {isSteam ? (
            steam ? <SteamView data={steam} section={steamView} onProject={onProject} /> : <Skel />
          ) : (
            <>
              {view === "overview" && (ov ? <OverviewView ov={ov} /> : <Skel />)}
              {view === "genres" && (extra ? <GenresView rows={extra} /> : <Skel />)}
              {view === "tags" && (ov ? <TagsView ov={ov} /> : <Skel />)}
              {view === "developers" && (extra ? <DevelopersView rows={extra} platform={platform} /> : <Skel />)}
              {view === "trends" && (ov ? <TrendsView ov={ov} /> : <Skel />)}
              {view === "hidden-gems" && (ov ? <GemsView ov={ov} rows={extra} /> : <Skel />)}
              {view === "new-releases" && (extra ? <NewReleasesView rows={extra} /> : <Skel />)}
              {view === "market-gaps" && (ov ? <div className="card">{head(I.gaps, "Market Gaps", "ranked by opportunity score")}<GapList gaps={ov.gaps} /></div> : <Skel />)}
            </>
          )}
          <div className="foot-note">KAIROS · GameRadar · live from Neon</div>
        </div>
      </main>
    </section>
  );
}
