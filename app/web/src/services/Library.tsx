import { useEffect, useMemo, useState } from "react";
import type { LibraryItem, Pitch } from "shared";
import { api } from "../lib/api.ts";

// Collections map to a source: "pitches" reads the pitches table; the rest read
// library_items by kind. New collections just add a row here.
const COLLECTIONS = [
  { key: "all", name: "All items", icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></> },
  { key: "pitch", name: "Pitches", icon: <><path d="M12 2l2.4 6.9H21l-5.3 4 2 6.6L12 15.8 6.3 19.5l2-6.6L3 8.9h6.6z" /></> },
  { key: "prototype", name: "Prototypes", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></> },
] as const;

const LOOP_LABEL: Record<string, string> = {
  "extraction-lite": "Extraction-lite",
  "automation-under-pressure": "Automation-under-pressure",
  "wave-defense-prep": "Wave-defense + prep",
  "cozy-craft": "Cozy craft-loop",
  "contained-systemic": "Contained-systemic",
  "idle-tycoon": "Idle / tycoon",
  "route-planning": "Route-planning",
};
const BADGE_LABEL: Record<string, string> = {
  "recommended": "Recommended",
  "retention-safe": "Retention-safe",
  "cashflow": "Cashflow",
  "cheapest-build": "Cheapest to build",
};

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
function ladder(p: string | null): string {
  return (p || "browser->steam").replace("->", " → ");
}
function Dots({ n, of = 3 }: { n: number | null; of?: number }) {
  if (n === null) return null;
  return (
    <span className="pdots-row" aria-hidden>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={"pdot" + (i < n ? " on" : "")} />
      ))}
    </span>
  );
}

function PitchCard({ p }: { p: Pitch }) {
  return (
    <article className="bcard pcard">
      <div className="pcard-head">
        {p.rank !== null && <span className="prank">{p.rank}</span>}
        <div className="pcard-headmain">
          <div className="btags">
            {p.badge && <span className={"ptag badge-" + p.badge}>{BADGE_LABEL[p.badge] || p.badge}</span>}
            {p.loopFamily && <span className="ptag lf">{LOOP_LABEL[p.loopFamily] || p.loopFamily}</span>}
            <span className={"ptag st st-" + p.status}>{p.status}</span>
          </div>
          <h3>{p.title}</h3>
          <div className="bmeta">{ladder(p.platformLadder)} · {fmtDate(p.pitchDate)}</div>
        </div>
      </div>
      {p.oneLiner && <p className="bblurb pone">{p.oneLiner}</p>}
      <div className="pfields">
        {p.loopDetail && <div><span className="plabel">Loop</span>{p.loopDetail}</div>}
        {p.browserMvp && <div><span className="plabel">Browser MVP</span>{p.browserMvp}</div>}
        {p.steamLadder && <div><span className="plabel">Steam ladder</span>{p.steamLadder}</div>}
        {p.evidence && <div><span className="plabel">Evidence</span>{p.evidence}</div>}
        {p.risk && <div className="prisk"><span className="plabel">Risk</span>{p.risk}</div>}
      </div>
      {(p.d1Fit !== null || p.steamCeiling !== null || p.buildCost !== null) && (
        <div className="pscores">
          <span>D1 fit <Dots n={p.d1Fit} /></span>
          <span>Steam ceiling <Dots n={p.steamCeiling} /></span>
          <span>Build ease <Dots n={p.buildCost} /></span>
        </div>
      )}
    </article>
  );
}

function LibCard({ it }: { it: LibraryItem }) {
  return (
    <article className="bcard pcard">
      <div className="btags">
        {(it.tags || []).slice(0, 4).map((t) => <span key={t} className="ptag lf">{t}</span>)}
        <span className={"ptag st st-" + it.status}>{it.status}</span>
      </div>
      <h3>{it.title}</h3>
      {it.summary && <p className="bblurb">{it.summary}</p>}
    </article>
  );
}

// Group pitches by date (newest first) so batches stay cleanly separated as more are added.
function groupByDate(pitches: Pitch[]): [string, Pitch[]][] {
  const map = new Map<string, Pitch[]>();
  for (const p of pitches) {
    const k = p.pitchDate;
    (map.get(k) || map.set(k, []).get(k)!).push(p);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

const COLLECTION_BLURB: Record<string, string> = {
  prototype: "Playable builds and paper tests will collect here — each one linked back to the loop family it validates.",
};

export function Library({ hidden }: { hidden: boolean }) {
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [active, setActive] = useState<string>("all");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([api.pitches().catch(() => []), api.library().catch(() => [])])
      .then(([p, l]) => { setPitches(p); setItems(l); })
      .finally(() => setLoaded(true));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: pitches.length + items.length, pitch: pitches.length };
    for (const it of items) c[it.kind] = (c[it.kind] || 0) + 1;
    return c;
  }, [pitches, items]);

  const activeName = COLLECTIONS.find((c) => c.key === active)?.name || "";
  const shownPitches = active === "all" || active === "pitch" ? pitches : [];
  const shownItems = active === "all" ? items : active === "pitch" ? [] : items.filter((i) => i.kind === active);
  const isEmpty = loaded && shownPitches.length === 0 && shownItems.length === 0;
  const totalLatest = pitches[0]?.pitchDate;

  return (
    <section className="service" data-svc="library" hidden={hidden}>
      <aside className="side">
        <div className="side-head">
          <b>Library</b>
          <span>idea exploration</span>
        </div>
        <div className="nav-label">Collections</div>
        {COLLECTIONS.map((c) => (
          <a
            className={"nav-item" + (c.key === active ? " active" : "")}
            key={c.key}
            onClick={() => setActive(c.key)}
          >
            <svg viewBox="0 0 24 24">{c.icon}</svg>
            {c.name}
            <span className="badge" style={{ background: counts[c.key] ? "var(--accent-soft)" : "var(--text-3)" }}>
              {counts[c.key] || 0}
            </span>
          </a>
        ))}
        <div className="side-foot">
          {pitches.length > 0
            ? `${pitches.length} pitch${pitches.length === 1 ? "" : "es"} · latest ${totalLatest ? fmtDate(totalLatest) : "—"}`
            : "Synced from KAIROS · Neon"}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h2>
            {activeName} <small>your work, next to the market intel that informs it</small>
          </h2>
        </div>

        <div className="content">
          {!loaded ? (
            <div className="bcard-grid">
              {[0, 1, 2].map((i) => <div className="bcard skeleton" key={i} style={{ height: 220 }} />)}
            </div>
          ) : isEmpty ? (
            <EmptyState collectionKey={active} name={activeName} />
          ) : (
            <>
              {(active === "all" || active === "pitch") && shownPitches.length > 0 &&
                groupByDate(shownPitches).map(([date, group]) => (
                  <div className="pgroup" key={date}>
                    <div className="section-title">
                      <span className="n">{group.length}</span>
                      Game pitches · {fmtDate(date)}
                      {group[0]?.batch && <span className="pbatch">batch {group[0].batch}</span>}
                    </div>
                    <div className="bcard-grid">
                      {group.map((p) => <PitchCard key={p.slug} p={p} />)}
                    </div>
                  </div>
                ))}
              {shownItems.length > 0 && (
                <div className="bcard-grid">
                  {shownItems.map((it) => <LibCard key={it.id} it={it} />)}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </section>
  );
}

function EmptyState({ collectionKey, name }: { collectionKey: string; name: string }) {
  const blurb =
    COLLECTION_BLURB[collectionKey] ||
    "A home for your prototypes, design docs, and art-style explorations — so your own work lives next to the market intel that informs it.";
  return (
    <div className="empty">
      <div className="big-ic">
        <svg viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 17.5h7M17.5 14v7" />
        </svg>
      </div>
      <h3>{collectionKey === "all" ? "Your library is empty" : `No ${name.toLowerCase()} yet`}</h3>
      <p>{blurb}</p>
      <div className="soon">Added via the weekly kairos-iterate routine → POST /api/pitches</div>
    </div>
  );
}
