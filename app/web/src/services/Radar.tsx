import { useEffect, useState } from "react";
import type { Overview, Platform, GenreRow, DeveloperRow, NewRelease, HiddenGem } from "shared";
import { api } from "../lib/api.ts";
import { EChart } from "../components/EChart.tsx";
import { momentumOption, treemapOption, scatterOption, heatmapOption, landscapeOption } from "../components/charts.ts";
import { InsightSvg, tagClass } from "../components/icons.tsx";

const fmt = (n: number) => n.toLocaleString("en-US");
const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "all", label: "All" },
  { id: "poki", label: "Poki" },
  { id: "crazygames", label: "CrazyGames" },
];

type View = "overview" | "genres" | "tags" | "developers" | "trends" | "hidden-gems" | "new-releases" | "market-gaps";
const I = {
  overview: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>,
  genres: <svg viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></svg>,
  tags: <svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="9" cy="17" r="2.5" /><path d="M8 7l8 1M8 8l1 7M16 10l-6 6" /></svg>,
  developers: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" /></svg>,
  trends: <svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></svg>,
  gems: <svg viewBox="0 0 24 24"><path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" /></svg>,
  releases: <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14" /><circle cx="12" cy="12" r="9" /></svg>,
  gaps: <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 2v10l7-7" /></svg>,
};

const Skel = ({ h = 300 }: { h?: number }) => <div className="card"><div className="skeleton" style={{ height: h }} /></div>;
const head = (icon: JSX.Element, title: string, sub?: string) => (
  <h3>{icon}{title}{sub && <span className="sub">{sub}</span>}</h3>
);
const deltaCls = (d: number) => (d > 3 ? "delta-up" : d < -3 ? "delta-dn" : "delta-fl");

/* ───────────── views ───────────── */
function OverviewView({ ov }: { ov: Overview }) {
  return (
    <>
      <div className="kpis">
        <div className="kpi"><div className="label">{I.overview}Games tracked</div><div className="val num">{fmt(ov.kpi.gamesTracked)}</div><span className="delta up num">▲ {ov.kpi.newGames} new (14d)</span></div>
        <div className="kpi"><div className="label">★ Avg rating</div><div className="val num">{ov.kpi.avgRating.toFixed(2)}</div><span className="delta flat num">P90 {ov.kpi.avgRatingP90.toFixed(2)} · point-in-time</span></div>
        <div className="kpi"><div className="label">{I.trends}Rising genre</div><div className="val num" style={{ fontSize: 24, paddingTop: 4 }}>{ov.kpi.risingGenre}</div><span className="delta up num">▲ +{ov.kpi.risingVotesPerDay} votes/day</span></div>
        <div className="kpi accent"><div className="label">{I.gaps}Open market gaps</div><div className="val num">{ov.kpi.openGaps}</div><span className="delta up num">appetite &gt; supply</span></div>
      </div>
      <div className="card hero">{head(I.genres, "Genre landscape", "supply × quality × audience — top-left = green-field")}<EChart option={landscapeOption(ov.landscape)} style={{ minHeight: 320 }} /></div>
      <div className="grid g-2">
        <div className="card">{head(I.trends, "Genre momentum", "median votes by genre over time")}
          {ov.momentum.building
            ? <div className="empty-inline">History building — need ≥2 crawl days</div>
            : <EChart option={momentumOption(ov.momentum)} />}
        </div>
        <div className="card">{head(I.gems, "AI Insights", "auto-generated")}
          <div className="insights">{ov.insights.map((ins, i) => (
            <div className="insight" key={i}><div className={"ic " + ins.kind}><InsightSvg kind={ins.kind} /></div>
              <div className="body"><p dangerouslySetInnerHTML={{ __html: ins.text }} /><div className="meta"><span className={"tag-op " + tagClass(ins.kind)}>{ins.tag}</span><span>{ins.meta}</span></div></div></div>
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
    </>
  );
}

function GapList({ gaps }: { gaps: Overview["gaps"] }) {
  return (
    <div className="gaplist">
      <p className="gap-legend">high appetite + high quality ceiling + low supply = opportunity</p>
      {gaps.map((g, i) => (
        <div className="gap" key={i}><span className="rank num">{i + 1}</span>
          <div className="name">{g.label}<small>opportunity {g.score.toFixed(1)}</small></div>
          <div className="gap-stats num">
            <span><b>{fmt(g.appetite)}</b> median votes/title</span>
            <span><b>{g.supplyN}</b> games</span>
            <span>top rating <b>{g.qualityCeil.toFixed(2)}</b></span>
          </div>
        </div>
      ))}
    </div>
  );
}

function GenresView({ rows }: { rows: GenreRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.games));
  return (
    <div className="card">{head(I.genres, "Genre Explorer", `${rows.length} genres`)}
      <table className="dtable"><thead><tr><th>Genre</th><th className="r">Games</th><th className="r">Avg rating</th><th className="r">Median votes</th><th className="r">P90 votes (top-10% bar)</th><th className="r">P90 rating</th><th className="r">Votes/day</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.genre}><td className="gname">{r.genre}<span className="minibar"><i style={{ width: (r.games / max) * 100 + "%" }} /></span></td>
            <td className="r">{r.games}</td><td className="r">{r.avgRating.toFixed(2)}</td><td className="r">{fmt(r.medianVotes)}</td><td className="r">{fmt(r.p90Votes)}</td>
            <td className="r">{r.p90Rating.toFixed(2)}</td>
            <td className={"r " + deltaCls(r.votesPerDay)}>{r.votesPerDay > 0 ? "+" : ""}{fmt(r.votesPerDay)}</td></tr>
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
      <div className="card">{head(I.trends, "Genre momentum", "median votes/day by genre over crawl window")}
        {ov.momentum.building
          ? <div className="empty-inline">History building — need ≥2 crawl days</div>
          : <><EChart option={momentumOption(ov.momentum)} style={{ minHeight: 340 }} /></>}
      </div>
      <div className="card">{head(I.genres, "Genre landscape", "supply × quality × audience — top-left = green-field")}<EChart option={landscapeOption(ov.landscape)} style={{ minHeight: 300 }} /></div>
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
    <div className="card">{head(I.releases, "New Releases", `${rows.length} new in last 14 days`)}
      <table className="dtable"><thead><tr><th>Game</th><th>Genre</th><th className="r">Rating</th><th className="r">Votes</th></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.gameId}><td><a className="gname" href={r.url} target="_blank" rel="noreferrer">{r.title}</a></td><td>{r.genre}</td><td className="r">{r.rating ? r.rating.toFixed(2) : "—"}</td><td className="r">{fmt(r.votes)}</td></tr>))}</tbody></table>
    </div>
  );
}

/* ───────────── shell ───────────── */
export function Radar({ hidden }: { hidden: boolean }) {
  const [platform, setPlatform] = useState<Platform>("all");
  const [view, setView] = useState<View>("overview");
  const [ov, setOv] = useState<Overview | null>(null);
  const [extra, setExtra] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    setOv(null); setErr(null);
    api.overview(platform).then((d) => on && setOv(d), (e) => on && setErr(String(e)));
    return () => { on = false; };
  }, [platform]);

  useEffect(() => {
    let on = true;
    setExtra(null);
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

  const subtitle = ov ? ov.subtitle : "loading…";

  return (
    <section className="service" data-svc="radar" hidden={hidden}>
      <aside className="side">
        <div className="side-head"><b>GameRadar</b><span>market intel</span></div>
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
        <div className="side-foot"><span className="pulse"></span>Crawl OK · {ov ? fmt(ov.kpi.gamesTracked) : "…"} games<br />live · Neon</div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h2>Market Overview <small>{subtitle}</small></h2>
          <div className="seg" role="tablist" aria-label="Platform">
            {PLATFORMS.map((p) => (
              <button key={p.id} className={"seg-btn" + (platform === p.id ? " active" : "")} role="tab" aria-selected={platform === p.id} onClick={() => setPlatform(p.id)}>
                <span className={"dot " + p.id}></span>{p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="content">
          {err && <div className="card" style={{ color: "var(--red)" }}>Failed to load: {err}</div>}
          {view === "overview" && (ov ? <OverviewView ov={ov} /> : <Skel />)}
          {view === "genres" && (extra ? <GenresView rows={extra} /> : <Skel />)}
          {view === "tags" && (ov ? <TagsView ov={ov} /> : <Skel />)}
          {view === "developers" && (extra ? <DevelopersView rows={extra} platform={platform} /> : <Skel />)}
          {view === "trends" && (ov ? <TrendsView ov={ov} /> : <Skel />)}
          {view === "hidden-gems" && (ov ? <GemsView ov={ov} rows={extra} /> : <Skel />)}
          {view === "new-releases" && (extra ? <NewReleasesView rows={extra} /> : <Skel />)}
          {view === "market-gaps" && (ov ? <div className="card">{head(I.gaps, "Market Gaps", "ranked by opportunity score")}<GapList gaps={ov.gaps} /></div> : <Skel />)}
          <div className="foot-note">KAIROS · GameRadar · live from Neon · platform via source_id</div>
        </div>
      </main>
    </section>
  );
}
