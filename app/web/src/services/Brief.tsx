import { Fragment, useEffect, useState } from "react";
import { Handoff } from "../components/Handoff.tsx";
import type { Service } from "../components/Rail.tsx";
import {
  useDrawer,
  useIsDrawer,
  drawerPanelProps,
  NavToggle,
  NavScrim,
  DrawerClose,
} from "../components/MobileNav.tsx";
import type { BriefEditionMeta, BriefEdition, BriefNotable, BriefSteering } from "shared";
import { api } from "../lib/api.ts";
import { isSameWeek } from "../lib/week.ts";
import { rowSummary } from "../lib/briefTracker.ts";
import { cardImage, groupBrowserCards } from "../lib/briefCards.ts";

function fmt(date: string): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
const DAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dow = (date: string) => new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
// Minimal, safe markdown: escape HTML then render **bold**.
function md(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}
const srcLink = {
  fontFamily: "'Fira Code'",
  fontSize: "var(--fs-1)",
  color: "var(--primary)",
  marginTop: 8,
  display: "inline-block",
} as const;
const CAT: Record<string, string> = {
  "Contained-systemic": "teal",
  "Cozy/management": "green",
  "Automation/logistics": "blue",
  "City-builder": "indigo",
  "Bigger-budget": "amber",
  "Market signal": "gray",
  "Foundational update": "purple",
  "Loop reference": "amber",
};
const KIND: Record<string, string> = {
  "Browser game": "cyan",
  "Browser platform": "gray",
  "Loop signal": "teal",
};

// Portal marks, drawn in the same 24px / 1.8-stroke grammar as components/icons.tsx.
const MARK = {
  pad: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="4" />
      <path d="M7 12h3M8.5 10.5v3M15 11.5h.01M17.5 13.5h.01" />
    </svg>
  ),
  trend: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 17l5-5 4 3 8-8" />
      <path d="M15 7h5v5" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  ),
  shelf: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4v16M9 4v16M14 5l5 15" />
      <path d="M3 20h18" />
    </svg>
  ),
};

function platformOf(it: BriefNotable) {
  const s = `${it.source || ""} ${it.name || ""} ${it.kind || ""}`.toLowerCase();
  if (/crazygames/.test(s)) return { label: "CrazyGames", cls: "pf-crazy", icon: MARK.pad };
  if (/\bpoki\b/.test(s)) return { label: "Poki", cls: "pf-poki", icon: MARK.pad };
  if (/itch\.io|itch /.test(s)) return { label: "itch.io", cls: "pf-itch", icon: MARK.pad };
  if ((it.kind || "") === "Loop signal")
    return { label: "Loop signal", cls: "pf-signal", icon: MARK.trend };
  return { label: it.kind || "Browser", cls: "pf-web", icon: MARK.globe };
}

function RichCard({ item, kind }: { item: BriefNotable; kind: "notable" | "browser" }) {
  const [err, setErr] = useState(false);
  const img = cardImage(item, kind);
  const badge = kind === "notable" ? item.category : item.kind;
  const badgeCls =
    kind === "notable" ? CAT[item.category || ""] || "gray" : KIND[item.kind || ""] || "cyan";
  const meta = (
    kind === "notable"
      ? [item.status, item.date, item.team ? `team ${item.team}` : ""]
      : [item.status, item.date]
  )
    .filter(Boolean)
    .join(" · ");
  const pf = platformOf(item);
  return (
    <article className="bcard">
      {img && !err ? (
        <div className="thumb">
          <img src={img} alt={item.name} loading="lazy" onError={() => setErr(true)} />
          {badge && <span className="ph">{badge}</span>}
        </div>
      ) : kind === "browser" ? (
        <div className={"thumb banner " + pf.cls}>
          <span className="bwordmark">
            {pf.icon} {pf.label}
          </span>
        </div>
      ) : (
        <div className="thumb noimg">
          <span className="ph">{badge || item.name}</span>
        </div>
      )}
      <div className="bbody">
        <div className="btags">
          {badge && <span className={"btag " + badgeCls}>{badge}</span>}
          {item.figure && <span className="bfig">{item.figure}</span>}
        </div>
        <h2>{item.name}</h2>
        {meta && <div className="bmeta">{meta}</div>}
        {item.blurb && <p className="bblurb">{item.blurb}</p>}
        {item.relevance && <p className="brel">{item.relevance}</p>}
        {item.source && (
          <div className="bcardfoot">
            <a href={item.source} target="_blank" rel="noreferrer">
              source ↗
            </a>
          </div>
        )}
      </div>
    </article>
  );
}

// The demand tracker (#12a) — this edition's own signals rolled up by loop family, sitting right
// above the prose it summarises. Reuses the reference-card grid, already proven at 375px.
function DemandTracker({ t }: { t: NonNullable<BriefEdition["tracker"]> }) {
  return (
    <>
      <p style={{ fontSize: "var(--fs-3)", color: "var(--text-2)", margin: "0 0 4px" }}>
        {t.total} signals below, grouped by loop family — {t.tagged} placed by the curated map,{" "}
        {t.total - t.tagged} unclassified (no family claimed)
        {t.comparedTo ? `; arrows vs the ${fmt(t.comparedTo)} edition` : ""}.
      </p>
      <div className="ref-grid">
        {t.rows.map((r) => (
          <div className="ref-card" key={r.family ?? "_none"}>
            <span className="rtag">{r.family ?? "unclassified"}</span>
            <h3>{rowSummary(r)}</h3>
            {r.titles.length > 0 && <div className="src">{r.titles.join(" · ")}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

export function Brief({ hidden, onGoto }: { hidden: boolean; onGoto?: (svc: Service) => void }) {
  const drawer = useDrawer();
  const isDrawer = useIsDrawer();
  const [list, setList] = useState<BriefEditionMeta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [ed, setEd] = useState<BriefEdition | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [steering, setSteering] = useState<BriefSteering | null>(null);

  useEffect(() => {
    api.briefEditions().then((l) => {
      setList(l);
      setLoaded(true);
      // A gap row is not selectable — the first REAL edition is what opens.
      const first = l.find((e) => !e.missing);
      if (first) setSel(first.editionDate);
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
  const gaps = list.filter((e) => e.missing);
  const last = list.find((e) => !e.missing);
  const daysAgo = last
    ? Math.max(
        0,
        Math.round(
          (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
            new Date(`${last.editionDate}T00:00:00Z`).getTime()) /
            86_400_000,
        ),
      )
    : null;
  // The header states the gap in words — a greyed row is easy to skim past, and one missed
  // slot is the threshold, not several (#180).
  const headline =
    daysAgo === null
      ? null
      : `last edition ${daysAgo === 0 ? "today" : daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`}` +
        (gaps.length
          ? ` · ${gaps.length} expected edition${gaps.length === 1 ? "" : "s"} missing`
          : "");
  const editionRow = (e: BriefEditionMeta) => {
    const di = dow(e.editionDate);
    // A missed slot is not a row you can open — it is the absence of one. Static, greyed
    // text, in its own date order, so the list stops being a record of only what succeeded.
    if (e.missing)
      return (
        <div className="edition gap" key={`gap-${e.editionDate}`}>
          <span>{fmt(e.editionDate)}</span>
          <span className="gap-note">no edition · {DAYS_SHORT[di]}</span>
        </div>
      );
    return (
      <button
        type="button"
        key={e.id}
        className={"edition" + (sel === e.editionDate ? " active" : "")}
        aria-current={sel === e.editionDate ? "page" : undefined}
        onClick={() => setSel(e.editionDate)}
      >
        <span>{fmt(e.editionDate)}</span>
        <span className={"ed-tag " + (di === 4 ? "thu" : di === 1 ? "mon" : "day")}>
          {DAYS_SHORT[di]}
        </span>
      </button>
    );
  };

  const p = ed?.payload;
  return (
    <section className="service" data-svc="brief" hidden={hidden}>
      <aside
        {...drawerPanelProps(drawer, isDrawer, "Brief editions")}
        className={"side" + (drawer.open ? " open" : "")}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".edition")) drawer.closeDrawer();
        }}
      >
        <DrawerClose onClick={drawer.closeDrawer} />
        <div className="side-head">
          <b>News Brief</b>
          <span>indie + gaming</span>
        </div>
        {headline && (
          <div className={"cadence-note" + (gaps.length ? " alert" : "")}>{headline}</div>
        )}
        {thisWeek.length > 0 && <div className="nav-label">This week</div>}
        {thisWeek.map(editionRow)}
        {earlier.length > 0 && <div className="nav-label">Earlier</div>}
        {earlier.map(editionRow)}
        {steering && steering.flags.length > 0 && (
          <div className="steer">
            <div className="nav-label">Steering this brief</div>
            <ul className="steer-list">
              {steering.flags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
            <div className="steer-note">standing interests · refreshed each edition</div>
          </div>
        )}
        <div className="side-foot">
          <span className="pulse"></span>Auto-published
          <br />
          twice weekly
        </div>
      </aside>
      <NavScrim open={drawer.open} onClose={drawer.closeDrawer} />

      <main className="main">
        <div className="topbar">
          <NavToggle onClick={drawer.openDrawer} />
          <h1>
            Indie &amp; Gaming Brief{" "}
            <small>
              {ed ? `Edition ${ed.editionDate} · ${DAYS_LONG[dow(ed.editionDate)]}` : "…"}
            </small>
          </h1>
          <div className="filters">
            {ed && ed.sourceCount > 0 && (
              <div className="chip">
                <svg viewBox="0 0 24 24">
                  <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
                </svg>
                {ed.sourceCount} sources
              </div>
            )}
          </div>
        </div>

        <div className="content">
          {loaded && list.length === 0 ? (
            <div className="empty">
              <div className="big-ic">
                <svg viewBox="0 0 24 24">
                  <path d="M4 5h13v14a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z" />
                  <path d="M17 8h3v10a2 2 0 0 1-2 2" />
                  <path d="M7 9h7M7 13h7M7 17h4" />
                </svg>
              </div>
              <h2>No brief editions yet</h2>
              <p>Editions appear here automatically as they're published.</p>
            </div>
          ) : !p ? (
            <div className="card">
              <div className="skeleton" style={{ height: 200 }} />
            </div>
          ) : (
            <>
              {p.top_signals && p.top_signals.length > 0 && (
                <>
                  <div className="section-title">
                    <span className="n">1</span>Top signals
                  </div>
                  <div className="card" style={{ gap: 10 }}>
                    {p.top_signals.map((s, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, fontSize: "var(--fs-3)" }}>
                        <span style={{ color: "var(--primary)" }}>▸</span>
                        <span dangerouslySetInnerHTML={{ __html: md(s) }} />
                      </div>
                    ))}
                  </div>
                </>
              )}

              {ed?.tracker && ed.tracker.rows.length > 0 && (
                <>
                  <div className="section-title">
                    <span className="n">Σ</span>Loop-family demand
                  </div>
                  <DemandTracker t={ed.tracker} />
                </>
              )}

              {p.new_notable && p.new_notable.length > 0 && (
                <>
                  <div className="section-title">
                    <span className="n">2</span>New &amp; notable
                  </div>
                  <div className="bcard-grid">
                    {p.new_notable.map((n, i) => (
                      <RichCard key={i} item={n} kind="notable" />
                    ))}
                  </div>
                </>
              )}

              {p.browser && p.browser.length > 0 && (
                <>
                  <div className="section-title">
                    <span className="n">3</span>Browser
                  </div>
                  {/* Grouped by what each card is evidence FOR (#156): portal-market supply and
                      browser→store funnel proof point at different routes, and read as one
                      accumulating "browser" signal when listed flat. */}
                  {groupBrowserCards(p.browser).map((g) => (
                    <Fragment key={g.id}>
                      <div className="sub-title">
                        {g.label}
                        <span className="sub-note">{g.note}</span>
                      </div>
                      <div className="bcard-grid">
                        {g.items.map((n, i) => (
                          <RichCard key={i} item={n} kind="browser" />
                        ))}
                      </div>
                    </Fragment>
                  ))}
                </>
              )}

              {p.tooling && p.tooling.items && p.tooling.items.length > 0 && (
                <>
                  <div className="section-title">
                    <span className="n">4</span>Tooling
                  </div>
                  {p.tooling.headline && (
                    <p
                      style={{ fontSize: "var(--fs-3)", color: "var(--text-2)", margin: "0 0 4px" }}
                    >
                      {p.tooling.headline}
                    </p>
                  )}
                  <div className="ref-grid">
                    {p.tooling.items.map((t, i) => (
                      <div className="ref-card" key={i}>
                        {t.group && <span className="rtag">{t.group}</span>}
                        <h3>{t.headline}</h3>
                        {t.version_or_date && <div className="src">{t.version_or_date}</div>}
                        {t.detail && <p>{t.detail}</p>}
                        {t.relevance && (
                          <p style={{ marginTop: 6, color: "var(--text-3)", fontStyle: "italic" }}>
                            {t.relevance}
                          </p>
                        )}
                        {t.source && (
                          <a href={t.source} target="_blank" rel="noreferrer" style={srcLink}>
                            source ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {p.market && p.market.length > 0 && (
                <>
                  <div className="section-title">
                    <span className="n">5</span>Market signals
                  </div>
                  <div className="card" style={{ gap: 12 }}>
                    {p.market.map((m, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "baseline",
                          borderBottom:
                            i < p.market!.length - 1 ? "1px solid var(--border-soft)" : "none",
                          paddingBottom: 10,
                        }}
                      >
                        {m.figure && (
                          <span
                            className="num"
                            style={{ color: "var(--green)", fontWeight: 700, minWidth: 60 }}
                          >
                            {m.figure}
                          </span>
                        )}
                        <div>
                          <div style={{ fontSize: "var(--fs-3)", fontWeight: 600 }}>
                            {m.headline}
                          </div>
                          {m.detail && (
                            <div style={{ fontSize: "var(--fs-2)", color: "var(--text-3)" }}>
                              {m.detail}
                              {m.source && (
                                <>
                                  {" "}
                                  ·{" "}
                                  <a
                                    href={m.source}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: "var(--primary)" }}
                                  >
                                    source ↗
                                  </a>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {p.founder_take && p.founder_take.length > 0 && (
                <>
                  <div className="section-title">
                    <span className="n">6</span>Founder's take
                  </div>
                  <div className="card" style={{ gap: 10 }}>
                    {p.founder_take.map((para, i) => (
                      <p
                        key={i}
                        style={{ fontSize: "var(--fs-3)", lineHeight: 1.55, color: "var(--text)" }}
                      >
                        {para}
                      </p>
                    ))}
                  </div>
                </>
              )}

              {p.reference_shelf && (
                <div className="foot-note ref-shelf">
                  {MARK.shelf}
                  {p.reference_shelf}
                </div>
              )}
              <Handoff
                links={[
                  {
                    label: "Check the market behind this",
                    hint: "open Radar on the genres this edition names",
                    onClick: () => onGoto?.("radar"),
                  },
                ]}
              />
            </>
          )}
        </div>
      </main>
    </section>
  );
}
