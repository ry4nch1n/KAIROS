import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDrawer, NavToggle, NavScrim, DrawerClose } from "../components/MobileNav.tsx";
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
const PROV_LABEL: Record<string, string> = {
  "market-backed": "Market-backed",
  "design-derived": "Design-derived",
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

// Spine fields are always shown (clamped to ~2 lines) so every card is a similar
// height; the wordier fields + the in-game shot live behind "Read full pitch" so a
// long pitch can't bloat the grid row. Missing spine fields keep a muted placeholder
// so rows still line up. (Scores are unchanged here — the rating rework is Phase 2.)
function PitchCard({ p }: { p: Pitch }) {
  const [open, setOpen] = useState(false);
  // Spine fields clamp to 2 lines. A hard mid-word ellipsis reads as "cut off
  // abruptly", so we soft-fade the tail instead — but only on fields that are
  // actually truncated (mark them `is-clamped`), leaving fields that fit solid.
  const fieldsRef = useRef<HTMLDivElement>(null);
  const mark = () => fieldsRef.current?.querySelectorAll<HTMLElement>(".pfield").forEach((el) => {
    el.classList.toggle("is-clamped", el.scrollHeight > el.clientHeight + 1);
  });
  // Re-measure after every commit: the card first mounts inside a hidden
  // (display:none) service panel where fields measure 0×0, and only gets real
  // dimensions when the panel is revealed — which re-renders this card, so a
  // no-dependency layout effect catches that moment (and the open toggle).
  useLayoutEffect(mark);
  // A viewport resize reflows the column count and the web-font swap shifts wrap
  // points, neither of which re-renders the card — cover both explicitly.
  useEffect(() => {
    window.addEventListener("resize", mark);
    document.fonts?.ready.then(mark);
    return () => window.removeEventListener("resize", mark);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const spine: [string, string | null, string?][] = [
    ["Loop", p.loopDetail],
    ["Setting", p.setting],
    ["Risk", p.risk, "prisk"],
  ];
  const detail: [string, string | null][] = [
    ["Art style", p.artStyle],
    ["Browser MVP", p.browserMvp],
    ["Steam ladder", p.steamLadder],
    ["Evidence", p.evidence],
  ];
  const hasDetail = detail.some(([, v]) => v) || !!p.shotUrl;
  return (
    <article className="bcard pcard">
      {p.headerUrl && (
        <div className="pcapsule">
          <img src={p.headerUrl} alt={(p.codeName || p.title) + " — header capsule"} loading="lazy" />
        </div>
      )}
      <div className="pcard-head">
        {p.rank !== null && <span className="prank">{p.rank}</span>}
        <div className="pcard-headmain">
          <div className="btags">
            {p.badge && <span className={"ptag badge-" + p.badge}>{BADGE_LABEL[p.badge] || p.badge}</span>}
            {p.loopFamily && <span className="ptag lf">{LOOP_LABEL[p.loopFamily] || p.loopFamily}</span>}
            <span className={"ptag st st-" + p.status}>{p.status}</span>
            {p.provenance && <span className={"ptag prov-" + p.provenance}>{PROV_LABEL[p.provenance] || p.provenance}</span>}
          </div>
          <h3>{p.title}{p.codeName && <span className="pcode">"{p.codeName}"</span>}</h3>
          <div className="bmeta">{ladder(p.platformLadder)} · {fmtDate(p.pitchDate)}</div>
        </div>
      </div>
      {p.oneLiner && <p className="bblurb pone">{p.oneLiner}</p>}
      <div className={"pfields" + (open ? " open" : "")} ref={fieldsRef}>
        {spine.map(([label, val, cls]) => (
          <div key={label} className={"pfield" + (cls ? " " + cls : "")}>
            <span className="plabel">{label}</span>
            {val ? val : <span className="pmissing">not specified</span>}
          </div>
        ))}
        {open && detail.map(([label, val]) => (val
          ? <div key={label} className="pfield-full"><span className="plabel">{label}</span>{val}</div>
          : null))}
      </div>
      {open && p.shotUrl && (
        <figure className="pshot">
          <img src={p.shotUrl} alt={(p.codeName || p.title) + " — in-game"} loading="lazy" />
          <figcaption>In-game concept</figcaption>
        </figure>
      )}
      {hasDetail && (
        <button type="button" className="pexpand" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "▾ Show less" : "▸ Read full pitch"}
        </button>
      )}
      {(p.browserFit !== null || p.steamFit !== null || p.buildEase !== null) && (
        <div className="pscores">
          <span className="pfit-pair" title="Co-equal platform-fit axes — together they map which strategy route a pitch fits">
            <span>Browser fit {p.browserFit !== null ? <Dots n={p.browserFit} /> : <em className="pna">n/a</em>}</span>
            <span>Steam fit {p.steamFit !== null ? <Dots n={p.steamFit} /> : <em className="pna">n/a</em>}</span>
          </span>
          <span>Build ease <Dots n={p.buildEase} /></span>
        </div>
      )}
    </article>
  );
}

function LibCard({ it }: { it: LibraryItem }) {
  return (
    <article className="bcard pcard">
      {it.imageUrl && (
        <div className="pcapsule">
          <img src={it.imageUrl} alt={it.title + " — preview"} loading="lazy" />
        </div>
      )}
      <div className="btags">
        {(it.tags || []).slice(0, 4).map((t) => <span key={t} className="ptag lf">{t}</span>)}
        <span className={"ptag st st-" + it.status}>{it.status}</span>
      </div>
      <h3>{it.title}</h3>
      {it.date && <div className="bmeta">Published {fmtDate(it.date)}</div>}
      {it.summary && <p className="bblurb">{it.summary}</p>}
      {it.mediaUrl && (
        <a className="plink" href={it.mediaUrl} target="_blank" rel="noreferrer">▶ Play prototype</a>
      )}
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
  const drawer = useDrawer();
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
      <aside
        className={"side" + (drawer.open ? " open" : "")}
        onClick={(e) => { if ((e.target as HTMLElement).closest(".nav-item")) drawer.closeDrawer(); }}
      >
        <DrawerClose onClick={drawer.closeDrawer} />
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
      <NavScrim open={drawer.open} onClose={drawer.closeDrawer} />

      <main className="main">
        <div className="topbar">
          <NavToggle onClick={drawer.openDrawer} />
          <h2>
            {activeName} <small>ideas and explorations, next to the market intel that informs them</small>
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
