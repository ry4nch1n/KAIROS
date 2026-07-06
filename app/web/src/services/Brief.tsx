import { useEffect, useState } from "react";
import type { BriefEditionMeta, BriefEdition, BriefNotable, BriefSteering } from "shared";
import { api } from "../lib/api.ts";
import { isSameWeek } from "../lib/week.ts";

function fmt(date: string): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
const DAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dow = (date: string) => new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
// Minimal, safe markdown: escape HTML then render **bold**.
function md(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}
const srcLink = { fontFamily: "'Fira Code'", fontSize: 11, color: "var(--primary)", marginTop: 8, display: "inline-block" } as const;
const steamCover = (appid?: string | null) => (appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg` : null);
const CAT: Record<string, string> = { "Contained-systemic": "teal", "Cozy/management": "green", "Automation/logistics": "blue", "City-builder": "indigo", "Bigger-budget": "amber", "Market signal": "gray", "Foundational update": "purple", "Loop reference": "amber" };
const KIND: Record<string, string> = { "Browser game": "cyan", "Browser platform": "gray", "Loop signal": "teal" };
const isUrl = (s?: string | null) => typeof s === "string" && /^https?:\/\//i.test(s.trim());

function platformOf(it: BriefNotable) {
  const s = `${it.source || ""} ${it.name || ""} ${it.kind || ""}`.toLowerCase();
  if (/crazygames/.test(s)) return { label: "CrazyGames", cls: "pf-crazy", icon: "🕹️" };
  if (/\bpoki\b/.test(s)) return { label: "Poki", cls: "pf-poki", icon: "🎮" };
  if (/itch\.io|itch /.test(s)) return { label: "itch.io", cls: "pf-itch", icon: "🎮" };
  if ((it.kind || "") === "Loop signal") return { label: "Loop signal", cls: "pf-signal", icon: "📈" };
  return { label: it.kind || "Browser", cls: "pf-web", icon: "🌐" };
}

function RichCard({ item, kind }: { item: BriefNotable; kind: "notable" | "browser" }) {
  const [err, setErr] = useState(false);
  const img = kind === "notable" ? item.cover_url || steamCover(item.steam_appid) : isUrl(item.image_url) ? item.image_url! : null;
  const badge = kind === "notable" ? item.category : item.kind;
  const badgeCls = kind === "notable" ? CAT[item.category || ""] || "gray" : KIND[item.kind || ""] || "cyan";
  const meta = (kind === "notable" ? [item.status, item.date, item.team ? `team ${item.team}` : ""] : [item.status, item.date]).filter(Boolean).join(" · ");
  const pf = platformOf(item);
  return (
    <article className="bcard">
      {img && !err ? (
        <div className="thumb"><img src={img} alt={item.name} loading="lazy" onError={() => setErr(true)} />{badge && <span className="ph">{badge}</span>}</div>
      ) : kind === "browser" ? (
        <div className={"thumb banner " + pf.cls}><span className="bwordmark">{pf.icon} {pf.label}</span></div>
      ) : (
        <div className="thumb noimg"><span className="ph">{badge || item.name}</span></div>
      )}
      <div className="bbody">
        <div className="btags">{badge && <span className={"btag " + badgeCls}>{badge}</span>}{item.figure && <span className="bfig">{item.figure}</span>}</div>
        <h3>{item.name}</h3>
        {meta && <div className="bmeta">{meta}</div>}
        {item.blurb && <p className="bblurb">{item.blurb}</p>}
        {item.relevance && <p className="brel">{item.relevance}</p>}
        {item.source && <div className="bcardfoot"><a href={item.source} target="_blank" rel="noreferrer">source ↗</a></div>}
      </div>
    </article>
  );
}

export function Brief({ hidden }: { hidden: boolean }) {
  const [list, setList] = useState<BriefEditionMeta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [ed, setEd] = useState<BriefEdition | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [steering, setSteering] = useState<BriefSteering | null>(null);

  useEffect(() => {
    api.briefEditions().then((l) => {
      setList(l);
      setLoaded(true);
      if (l.length) setSel(l[0].editionDate);
    });
    api.briefSteering().then(setSteering, () => setSteering(null));
  }, []);

  useEffect(() => {
    if (sel) {
      setEd(null);
      api.briefEdition(sel).then(setEd);
    }
  }, [sel]);

  // Group by real calendar week (Monday-start) relative to today, so "This week"
  // is literally this week — a Friday edition from last week falls under "Earlier".
  const now = new Date();
  const thisWeek = list.filter((e) => isSameWeek(e.editionDate, now));
  const earlier = list.filter((e) => !isSameWeek(e.editionDate, now));
  const editionRow = (e: BriefEditionMeta) => {
    const di = dow(e.editionDate);
    return (
      <a key={e.id} className={"edition" + (sel === e.editionDate ? " active" : "")} onClick={() => setSel(e.editionDate)}>
        <span>{fmt(e.editionDate)}</span>
        <span className={"ed-tag " + (di === 4 ? "thu" : di === 1 ? "mon" : "day")}>{DAYS_SHORT[di]}</span>
      </a>
    );
  };

  const p = ed?.payload;
  return (
    <section className="service" data-svc="brief" hidden={hidden}>
      <aside className="side">
        <div className="side-head"><b>News Brief</b><span>indie + gaming</span></div>
        {thisWeek.length > 0 && <div className="nav-label">This week</div>}
        {thisWeek.map(editionRow)}
        {earlier.length > 0 && <div className="nav-label">Earlier</div>}
        {earlier.map(editionRow)}
        {steering && steering.flags.length > 0 && (
          <div className="steer">
            <div className="nav-label">Steering this brief</div>
            <ul className="steer-list">{steering.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
            <div className="steer-note">curated on Notion · synced each run</div>
          </div>
        )}
        <div className="side-foot"><span className="pulse"></span>Auto-published<br />Routine: indie-brief</div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h2>Indie &amp; Gaming Brief <small>{ed ? `Edition ${ed.editionDate} · ${DAYS_LONG[dow(ed.editionDate)]}` : "…"}</small></h2>
          <div className="filters">
            {ed && ed.sourceCount > 0 && (
              <div className="chip"><svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" /></svg>{ed.sourceCount} sources</div>
            )}
          </div>
        </div>

        <div className="content">
          {loaded && list.length === 0 ? (
            <div className="empty">
              <div className="big-ic"><svg viewBox="0 0 24 24"><path d="M4 5h13v14a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z" /><path d="M17 8h3v10a2 2 0 0 1-2 2" /><path d="M7 9h7M7 13h7M7 17h4" /></svg></div>
              <h3>No brief editions yet</h3>
              <p>Editions appear here automatically once your indie-brief routine publishes them to the database.</p>
            </div>
          ) : !p ? (
            <div className="card"><div className="skeleton" style={{ height: 200 }} /></div>
          ) : (
            <>
              {p.top_signals && p.top_signals.length > 0 && (
                <>
                  <div className="section-title"><span className="n">1</span>Top signals</div>
                  <div className="card" style={{ gap: 10 }}>
                    {p.top_signals.map((s, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, fontSize: 13.5 }}>
                        <span style={{ color: "var(--primary)" }}>▸</span>
                        <span dangerouslySetInnerHTML={{ __html: md(s) }} />
                      </div>
                    ))}
                  </div>
                </>
              )}

              {p.new_notable && p.new_notable.length > 0 && (
                <>
                  <div className="section-title"><span className="n">2</span>New &amp; notable</div>
                  <div className="bcard-grid">{p.new_notable.map((n, i) => <RichCard key={i} item={n} kind="notable" />)}</div>
                </>
              )}

              {p.browser && p.browser.length > 0 && (
                <>
                  <div className="section-title"><span className="n">3</span>Browser</div>
                  <div className="bcard-grid">{p.browser.map((n, i) => <RichCard key={i} item={n} kind="browser" />)}</div>
                </>
              )}

              {p.tooling && p.tooling.items && p.tooling.items.length > 0 && (
                <>
                  <div className="section-title"><span className="n">4</span>Tooling</div>
                  {p.tooling.headline && <p style={{ fontSize: 13, color: "var(--text-2)", margin: "0 0 4px" }}>{p.tooling.headline}</p>}
                  <div className="ref-grid">
                    {p.tooling.items.map((t, i) => (
                      <div className="ref-card" key={i}>
                        {t.group && <span className="rtag">{t.group}</span>}
                        <h4>{t.headline}</h4>
                        {t.version_or_date && <div className="src">{t.version_or_date}</div>}
                        {t.detail && <p>{t.detail}</p>}
                        {t.relevance && <p style={{ marginTop: 6, color: "var(--text-3)", fontStyle: "italic" }}>{t.relevance}</p>}
                        {t.source && <a href={t.source} target="_blank" rel="noreferrer" style={srcLink}>source ↗</a>}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {p.market && p.market.length > 0 && (
                <>
                  <div className="section-title"><span className="n">5</span>Market signals</div>
                  <div className="card" style={{ gap: 12 }}>
                    {p.market.map((m, i) => (
                      <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", borderBottom: i < p.market!.length - 1 ? "1px solid var(--border-soft)" : "none", paddingBottom: 10 }}>
                        {m.figure && <span className="num" style={{ color: "var(--green)", fontWeight: 700, minWidth: 60 }}>{m.figure}</span>}
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.headline}</div>
                          {m.detail && <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>{m.detail}{m.source && <> · <a href={m.source} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>source ↗</a></>}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {p.founder_take && p.founder_take.length > 0 && (
                <>
                  <div className="section-title"><span className="n">6</span>Founder's take</div>
                  <div className="card" style={{ gap: 10 }}>
                    {p.founder_take.map((para, i) => <p key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text)" }}>{para}</p>)}
                  </div>
                </>
              )}

              {p.reference_shelf && <div className="foot-note">📚 {p.reference_shelf}</div>}
              <div className="foot-note">KAIROS · News Brief · from brief_editions (published by the indie-brief routine)</div>
            </>
          )}
        </div>
      </main>
    </section>
  );
}
