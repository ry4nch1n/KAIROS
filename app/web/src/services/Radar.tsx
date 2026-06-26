import { useEffect, useState } from "react";
import type { Overview, Platform } from "shared";
import { api } from "../lib/api.ts";
import { EChart } from "../components/EChart.tsx";
import { momentumOption, treemapOption, scatterOption, heatmapOption } from "../components/charts.ts";
import { InsightSvg, tagClass } from "../components/icons.tsx";

const fmt = (n: number) => n.toLocaleString("en-US");
const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "all", label: "All" },
  { id: "poki", label: "Poki" },
  { id: "crazygames", label: "CrazyGames" },
];

const NAV_DISCOVER = ["Overview", "Genre Explorer", "Tag Explorer", "Developers", "Trends"];

export function Radar({ hidden }: { hidden: boolean }) {
  const [platform, setPlatform] = useState<Platform>("all");
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    setOv(null);
    setErr(null);
    api.overview(platform).then(
      (d) => on && setOv(d),
      (e) => on && setErr(String(e))
    );
    return () => {
      on = false;
    };
  }, [platform]);

  const Skeleton = ({ h = 240 }: { h?: number }) => <div className="skeleton" style={{ height: h, width: "100%" }} />;

  return (
    <section className="service" data-svc="radar" hidden={hidden}>
      <aside className="side">
        <div className="side-head">
          <b>GameRadar</b>
          <span>market intel</span>
        </div>
        <div className="nav-label">Discover</div>
        {NAV_DISCOVER.map((n, i) => (
          <a className={"nav-item" + (i === 0 ? " active" : "")} key={n}>
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
            {n}
          </a>
        ))}
        <div className="nav-label">Opportunity</div>
        <a className="nav-item">
          <svg viewBox="0 0 24 24"><path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" /></svg>
          Hidden Gems
        </a>
        <a className="nav-item">
          <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14" /><circle cx="12" cy="12" r="9" /></svg>
          New Releases{ov && <span className="badge">{ov.kpi.newThisWeek}</span>}
        </a>
        <a className="nav-item">
          <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 2v10l7-7" /></svg>
          Market Gaps{ov && <span className="badge">{ov.kpi.openGaps}</span>}
        </a>
        <div className="side-foot">
          <span className="pulse"></span>Crawl OK · {ov ? fmt(ov.kpi.gamesTracked) : "…"} games
          <br />
          Local PGlite · seeded
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h2>
            Market Overview <small>{ov ? ov.subtitle : "loading…"}</small>
          </h2>
          <div className="seg" role="tablist" aria-label="Platform">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                className={"seg-btn" + (platform === p.id ? " active" : "")}
                role="tab"
                aria-selected={platform === p.id}
                onClick={() => setPlatform(p.id)}
              >
                <span className={"dot " + p.id}></span>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="content">
          {err && <div className="card" style={{ color: "var(--red)" }}>Failed to load: {err}</div>}

          {/* KPI strip */}
          <div className="kpis">
            <div className="kpi">
              <div className="label"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M3 9h6" /></svg>Games tracked</div>
              <div className="val num">{ov ? fmt(ov.kpi.gamesTracked) : "—"}</div>
              <span className="delta up num">▲ {ov ? ov.kpi.newThisWeek : 0} new this week</span>
            </div>
            <div className="kpi">
              <div className="label"><svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" /></svg>Avg rating</div>
              <div className="val num">{ov ? ov.kpi.avgRating.toFixed(2) : "—"}</div>
              <span className="delta flat num">▬ rolling 12-week</span>
            </div>
            <div className="kpi">
              <div className="label"><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8" /></svg>Fastest genre</div>
              <div className="val num" style={{ fontSize: 24, paddingTop: 4 }}>{ov ? ov.kpi.fastestGenre : "—"}</div>
              <span className="delta up num">▲ +{ov ? ov.kpi.fastestGenreDeltaPct : 0}% features / 12w</span>
            </div>
            <div className="kpi accent">
              <div className="label"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 2v10l7-7" /></svg>Open market gaps</div>
              <div className="val num">{ov ? ov.kpi.openGaps : "—"}</div>
              <span className="delta up num">demand ≫ supply</span>
            </div>
          </div>

          {/* momentum + insights */}
          <div className="grid g-2">
            <div className="card">
              <h3><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></svg>Genre momentum <span className="sub">weekly homepage features</span></h3>
              {ov ? <EChart option={momentumOption(ov.momentum)} /> : <Skeleton />}
            </div>
            <div className="card">
              <h3><svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" /><path d="M9 21h6" /></svg>AI Insights <span className="sub">auto-generated</span></h3>
              {!ov ? (
                <Skeleton h={200} />
              ) : (
                <div className="insights">
                  {ov.insights.map((ins, i) => (
                    <div className="insight" key={i}>
                      <div className={"ic " + ins.kind}><InsightSvg kind={ins.kind} /></div>
                      <div className="body">
                        <p dangerouslySetInnerHTML={{ __html: ins.text }} />
                        <div className="meta">
                          <span className={"tag-op " + tagClass(ins.kind)}>{ins.tag}</span>
                          <span>{ins.meta}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* treemap + scatter */}
          <div className="grid g-2b">
            <div className="card">
              <h3><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 11h11M14 3v18M14 13h7" /></svg>Tag frequency <span className="sub">top tags by game count</span></h3>
              {ov ? <EChart option={treemapOption(ov.tags)} /> : <Skeleton />}
            </div>
            <div className="card">
              <h3><svg viewBox="0 0 24 24"><path d="M3 3v18h18" /><circle cx="8" cy="15" r="1.4" /><circle cx="13" cy="9" r="1.4" /><circle cx="17" cy="12" r="1.4" /><circle cx="11" cy="17" r="1.4" /></svg>Hidden-gem finder <span className="sub">rating × visibility</span></h3>
              {ov ? <EChart option={scatterOption(ov.scatter)} /> : <Skeleton />}
            </div>
          </div>

          {/* heatmap + gaps */}
          <div className="grid g-2">
            <div className="card">
              <h3><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>Feature heatmap <span className="sub">genre × week intensity</span></h3>
              {ov ? <EChart option={heatmapOption(ov.heatmap)} style={{ minHeight: 260 }} /> : <Skeleton h={260} />}
            </div>
            <div className="card">
              <h3><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 2v10l7-7" /></svg>Top market gaps <span className="sub">demand ▸ supply</span></h3>
              {!ov ? (
                <Skeleton h={200} />
              ) : (
                <div className="gaplist">
                  {ov.gaps.map((g, i) => (
                    <div className="gap" key={i}>
                      <span className="rank num">{i + 1}</span>
                      <div className="name">{g.label}<small>score {g.score}</small></div>
                      <div className="bars">
                        <div className="barlbl"><span>demand</span><span>{g.demand}</span></div>
                        <div className="bar demand"><i style={{ width: g.demand + "%" }} /></div>
                        <div className="barlbl"><span>supply</span><span>{g.supply}</span></div>
                        <div className="bar supply"><i style={{ width: g.supply + "%" }} /></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="foot-note">KAIROS · GameRadar · live from API · platform via source_id</div>
        </div>
      </main>
    </section>
  );
}
