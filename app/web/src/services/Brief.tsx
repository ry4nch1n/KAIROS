import { useEffect, useState } from "react";
import type { BriefEditionMeta, BriefEdition } from "shared";
import { api } from "../lib/api.ts";
import { InsightSvg, tagClass } from "../components/icons.tsx";

function fmt(date: string): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function Brief({ hidden }: { hidden: boolean }) {
  const [list, setList] = useState<BriefEditionMeta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [ed, setEd] = useState<BriefEdition | null>(null);

  useEffect(() => {
    api.briefEditions().then((l) => {
      setList(l);
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
  const isThisWeek = (d: string) =>
    latest ? (new Date(latest).getTime() - new Date(d).getTime()) / 86400000 <= 7 : false;
  const thisWeek = list.filter((e) => isThisWeek(e.editionDate));
  const earlier = list.filter((e) => !isThisWeek(e.editionDate));

  const editionRow = (e: BriefEditionMeta) => (
    <a
      key={e.id}
      className={"edition" + (sel === e.editionDate ? " active" : "")}
      onClick={() => setSel(e.editionDate)}
    >
      <span>{fmt(e.editionDate)}</span>
      <span className={"ed-tag " + (e.weekday === "thu" ? "thu" : "mon")}>{e.weekday.toUpperCase()}</span>
    </a>
  );

  return (
    <section className="service" data-svc="brief" hidden={hidden}>
      <aside className="side">
        <div className="side-head">
          <b>News Brief</b>
          <span>indie + gaming · mon/thu</span>
        </div>
        {thisWeek.length > 0 && <div className="nav-label">This week</div>}
        {thisWeek.map(editionRow)}
        {earlier.length > 0 && <div className="nav-label">Earlier</div>}
        {earlier.map(editionRow)}
        <div className="side-foot">
          <span className="pulse"></span>Next: Mon · 07:00
          <br />
          Routine: indie-brief-pipeline
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h2>
            Indie &amp; Gaming Brief{" "}
            <small>{ed ? `Edition ${ed.editionDate} · ${ed.weekday === "thu" ? "Thursday" : "Monday"}` : "…"}</small>
          </h2>
          <div className="filters">
            {ed && (
              <div className="chip">
                <svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" /></svg>
                {ed.sourceCount} sources
              </div>
            )}
            <div className="chip">
              <svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></svg>
              Open in Notion
            </div>
          </div>
        </div>

        <div className="content">
          {!ed ? (
            <div className="card"><div className="skeleton" style={{ height: 200 }} /></div>
          ) : (
            <>
              <div className="section-title"><span className="n">1</span>Design references — Tier 1</div>
              <div className="ref-grid">
                {ed.payload.refsTier1.map((r, i) => (
                  <div className="ref-card" key={i}>
                    <span className="rtag">{r.rtag}</span>
                    <h4>{r.title}</h4>
                    <div className="src">{r.src}</div>
                    <p>{r.body}</p>
                  </div>
                ))}
              </div>

              <div className="section-title"><span className="n">2</span>Solo-dev benchmarks — Tier 2</div>
              <div className="ref-grid">
                {ed.payload.refsTier2.map((r, i) => (
                  <div className="ref-card" key={i}>
                    <span className="rtag">{r.rtag}</span>
                    <h4>{r.title}</h4>
                    <div className="src">{r.src}</div>
                    <p>{r.body}</p>
                  </div>
                ))}
              </div>

              <div className="section-title"><span className="n">3</span>Market signals</div>
              <div className="insights">
                {ed.payload.signals.map((s, i) => (
                  <div className="insight" key={i}>
                    <div className={"ic " + s.kind}><InsightSvg kind={s.kind} /></div>
                    <div className="body">
                      <p dangerouslySetInnerHTML={{ __html: s.text }} />
                      <div className="meta">
                        <span className={"tag-op " + tagClass(s.kind)}>{s.tag}</span>
                        <span>{s.meta}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="section-title"><span className="n">4</span>Action items</div>
              <div>
                {ed.payload.actions.map((a, i) => (
                  <div className="action" key={i}>
                    <div className="box"></div>
                    <p>{a}</p>
                  </div>
                ))}
              </div>
              <div className="foot-note">KAIROS · News Brief · from brief_editions (written by the Mon/Thu routine)</div>
            </>
          )}
        </div>
      </main>
    </section>
  );
}
