import { useEffect, useState } from "react";
import type { BriefEditionMeta, BriefEdition, BriefNotable } from "shared";
import { api } from "../lib/api.ts";

function fmt(date: string): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
// Minimal, safe markdown: escape HTML then render **bold**.
function md(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}
const greenPill = { color: "var(--green)", background: "rgba(5,150,105,.1)" } as const;
const srcLink = { fontFamily: "'Fira Code'", fontSize: 11, color: "var(--primary)", marginTop: 8, display: "inline-block" } as const;

function NotableCard({ n }: { n: BriefNotable }) {
  return (
    <div className="ref-card">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
        {n.status && <span className="rtag">{n.status}</span>}
        {(n.kind || n.category) && <span className="rtag" style={{ background: "rgba(124,58,237,.1)", color: "var(--violet)" }}>{n.kind || n.category}</span>}
        {n.figure && <span className="rtag" style={greenPill}>{n.figure}</span>}
      </div>
      <h4>{n.name}</h4>
      {(n.team || n.date) && <div className="src">{[n.team, n.date].filter(Boolean).join(" · ")}</div>}
      {n.blurb && <p>{n.blurb}</p>}
      {n.relevance && <p style={{ marginTop: 6, color: "var(--text-3)", fontStyle: "italic" }}>{n.relevance}</p>}
      {n.source && <a href={n.source} target="_blank" rel="noreferrer" style={srcLink}>source ↗</a>}
    </div>
  );
}

export function Brief({ hidden }: { hidden: boolean }) {
  const [list, setList] = useState<BriefEditionMeta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [ed, setEd] = useState<BriefEdition | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.briefEditions().then((l) => {
      setList(l);
      setLoaded(true);
      if (l.length) setSel(l[0].editionDate);
    });
  }, []);

  useEffect(() => {
    if (sel) {
      setEd(null);
      api.briefEdition(sel).then(setEd);
    }
  }, [sel]);

  const latest = list[0]?.editionDate;
  const isThisWeek = (d: string) => (latest ? (new Date(latest).getTime() - new Date(d).getTime()) / 86400000 <= 7 : false);
  const thisWeek = list.filter((e) => isThisWeek(e.editionDate));
  const earlier = list.filter((e) => !isThisWeek(e.editionDate));
  const wkClass = (w: string) => (String(w).toLowerCase().startsWith("thu") ? "thu" : "mon");
  const wkShort = (w: string) => String(w).slice(0, 3).toUpperCase();

  const editionRow = (e: BriefEditionMeta) => (
    <a key={e.id} className={"edition" + (sel === e.editionDate ? " active" : "")} onClick={() => setSel(e.editionDate)}>
      <span>{fmt(e.editionDate)}</span>
      <span className={"ed-tag " + wkClass(e.weekday)}>{wkShort(e.weekday)}</span>
    </a>
  );

  const p = ed?.payload;
  return (
    <section className="service" data-svc="brief" hidden={hidden}>
      <aside className="side">
        <div className="side-head"><b>News Brief</b><span>indie + gaming · mon/thu</span></div>
        {thisWeek.length > 0 && <div className="nav-label">This week</div>}
        {thisWeek.map(editionRow)}
        {earlier.length > 0 && <div className="nav-label">Earlier</div>}
        {earlier.map(editionRow)}
        <div className="side-foot"><span className="pulse"></span>Next: Mon · 08:00<br />Routine: indie-brief</div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h2>Indie &amp; Gaming Brief <small>{ed ? `Edition ${ed.editionDate}${p?.weekday ? " · " + p.weekday : ""}` : "…"}</small></h2>
          <div className="filters">
            {ed && ed.sourceCount > 0 && (
              <div className="chip"><svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" /></svg>{ed.sourceCount} sources</div>
            )}
            <div className="chip"><svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></svg>Open in Notion</div>
          </div>
        </div>

        <div className="content">
          {loaded && list.length === 0 ? (
            <div className="empty">
              <div className="big-ic"><svg viewBox="0 0 24 24"><path d="M4 5h13v14a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z" /><path d="M17 8h3v10a2 2 0 0 1-2 2" /><path d="M7 9h7M7 13h7M7 17h4" /></svg></div>
              <h3>No brief editions yet</h3>
              <p>Editions appear here automatically once your Mon/Thu indie-brief routine publishes them to the database.</p>
            </div>
          ) : !p ? (
            <div className="card"><div className="skeleton" style={{ height: 200 }} /></div>
          ) : (
            <>
              {p.phase_badge && (
                <div className="card" style={{ padding: "12px 16px", flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <span className="tag-op opp">PHASE</span>
                  <span style={{ fontSize: 13, color: "var(--text-2)" }}>{p.phase_badge}</span>
                </div>
              )}

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
                  <div className="ref-grid">{p.new_notable.map((n, i) => <NotableCard key={i} n={n} />)}</div>
                </>
              )}

              {p.browser && p.browser.length > 0 && (
                <>
                  <div className="section-title"><span className="n">3</span>Browser &amp; UEFN</div>
                  <div className="ref-grid">{p.browser.map((n, i) => <NotableCard key={i} n={n} />)}</div>
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
              <div className="foot-note">KAIROS · News Brief · from brief_editions (published by the Mon/Thu routine)</div>
            </>
          )}
        </div>
      </main>
    </section>
  );
}
