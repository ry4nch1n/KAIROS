import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDrawer, NavToggle, NavScrim, DrawerClose } from "../components/MobileNav.tsx";
import type { LibraryItem, Pitch } from "shared";
import { api } from "../lib/api.ts";

// Collections map to a source: "pitches" reads the pitches table; the rest read
// library_items by kind. New collections just add a row here.
const COLLECTIONS = [
  { key: "pitch", name: "Pitches", icon: <><path d="M12 2l2.4 6.9H21l-5.3 4 2 6.6L12 15.8 6.3 19.5l2-6.6L3 8.9h6.6z" /></> },
  { key: "prototype", name: "Prototypes", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></> },
] as const;

const DEFAULT_COLLECTION = COLLECTIONS[0].key; // Pitches — the primary collection

const LOOP_LABEL: Record<string, string> = {
  "extraction-lite": "Extraction-lite",
  "automation-under-pressure": "Automation-under-pressure",
  "wave-defense-prep": "Wave-defense + prep",
  "cozy-craft": "Cozy craft-loop",
  "contained-systemic": "Contained-systemic",
  "idle-tycoon": "Idle / tycoon",
  "route-planning": "Route-planning",
  "synergy-builder": "Synergy / luck-builder",
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
const isUrl = (s: string | null): s is string => !!s && /^https?:\/\//i.test(s.trim());
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
    ["Hook", p.hook],
    ["Art style", p.artStyle],
    ["Browser MVP", p.browserMvp],
    ["Steam ladder", p.steamLadder],
    ["Tech risk", p.techRisk],
    ["Why me", p.whyMe],
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
            {isUrl(p.source) && <a className="prov-receipt" href={p.source} target="_blank" rel="noreferrer" title="The market evidence this pitch is grounded in">receipt ↗</a>}
          </div>
          <h3>{p.title}{p.codeName && <span className="pcode">"{p.codeName}"</span>}</h3>
          <div className="bmeta">{ladder(p.platformLadder)} · {fmtDate(p.pitchDate)}</div>
        </div>
      </div>
      {p.oneLiner && <p className="bblurb pone">{p.oneLiner}</p>}
      {(p.grayBoxDays != null || p.contentScope) && (
        <div className="pscope">
          {p.grayBoxDays != null && <span className="pscope-chip clock" title="Estimated days to a testable gray-box loop — the Aug kill-gate clock. A loop only provable at month six is out of scope no matter the market.">⏱ ~{p.grayBoxDays}d to a testable loop</span>}
          {p.contentScope && <span className="pscope-chip" title="Content bill vs. what this genre's buyers expect">content: {p.contentScope}</span>}
        </div>
      )}
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
      {(p.browserFit !== null || p.steamFit !== null || p.buildEase !== null || p.marketability !== null || p.founderFit !== null) && (
        <div className="pscores">
          <span className="pfit-pair" title="Co-equal platform-fit axes — together they map which strategy route a pitch fits">
            <span>Browser fit {p.browserFit !== null ? <Dots n={p.browserFit} /> : <em className="pna">n/a</em>}</span>
            <span>Steam fit {p.steamFit !== null ? <Dots n={p.steamFit} /> : <em className="pna">n/a</em>}</span>
          </span>
          <span>Build ease <Dots n={p.buildEase} /></span>
          {(p.marketability !== null || p.founderFit !== null) && (
            <span className="pfit-pair pjudge" title="The two lenses the commercial scores miss — first-session hook pull, and whether you'd still care in month four">
              <span>Hook {p.marketability !== null ? <Dots n={p.marketability} /> : <em className="pna">n/a</em>}</span>
              <span>Founder fit {p.founderFit !== null ? <Dots n={p.founderFit} /> : <em className="pna">n/a</em>}</span>
            </span>
          )}
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

const COLLECTION_BLURB: Record<string, string> = {
  prototype: "Playable builds and paper tests will collect here — each one linked back to the loop family it validates.",
};

// ── Leaderboard (evaluation Phase A4) ──
// The gallery answers "what pitches exist"; the leaderboard answers "which candidate is
// currently winning, and what evidence would change that" — score dots side by side,
// sorted by evidence state (tested beats untested paper strength), with explicit
// missing-evidence chips so the next action is legible per row.
const STATUS_RANK: Record<string, number> = { shipped: 0, prototyping: 1, proposed: 2 };

function scoreSum(p: Pitch): number {
  // All five 1..3 axes — a pitch strong on hook + founder-fit should edge out an equal
  // one that's weak on the two lenses the commercial scores miss.
  return (p.browserFit ?? 0) + (p.steamFit ?? 0) + (p.buildEase ?? 0) + (p.marketability ?? 0) + (p.founderFit ?? 0);
}

export function rankPitches(pitches: Pitch[]): Pitch[] {
  return pitches
    .filter((p) => p.status !== "shelved")
    .sort((a, b) => {
      const s = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      if (s !== 0) return s;
      const sc = scoreSum(b) - scoreSum(a);
      if (sc !== 0) return sc;
      return b.pitchDate.localeCompare(a.pitchDate);
    });
}

function evidenceChips(p: Pitch): { label: string; missing: boolean }[] {
  const chips: { label: string; missing: boolean }[] = [];
  if (p.status === "proposed") chips.push({ label: "unprototyped", missing: true });
  else if (p.status === "prototyping") chips.push({ label: "in gray-box", missing: false });
  else chips.push({ label: p.status, missing: false });
  chips.push(p.evidence ? { label: "evidence noted", missing: false } : { label: "no evidence", missing: true });
  chips.push(p.source ? { label: "source linked", missing: false } : { label: "no source", missing: true });
  return chips;
}

function LeaderboardView({ pitches }: { pitches: Pitch[] }) {
  const ranked = rankPitches(pitches);
  if (!ranked.length) return <div className="empty"><h3>No active pitches to rank yet</h3></div>;
  return (
    <div className="card">
      <h3>Candidate leaderboard<span className="sub">non-shelved pitches — evidence state first, paper scores second</span></h3>
      <p className="view-head">
        A tested loop outranks a stronger-looking untested one. The chips say what's missing —
        that's the next action for the row, not a demerit.
      </p>
      <table className="dtable"><thead><tr>
        <th>#</th><th>Pitch</th><th>Loop</th>
        <th className="r" title="Browser-native viability: instant hook, portal retention, ad-monetizability">Browser</th>
        <th className="r" title="Paid-Steam laddering potential + revenue ceiling vs comps">Steam</th>
        <th className="r" title="Solo-dev feasibility — higher = cheaper/easier">Build</th>
        <th className="r" title="First-session hook / does it capsule (the marketability lens)">Hook</th>
        <th className="r" title="Personal pull + edge — would you still care in month four?">Founder</th>
        <th className="r" title="Estimated days to a testable gray-box loop — the kill-gate clock">Gray-box</th>
        <th>Status</th><th>Evidence</th>
      </tr></thead>
        <tbody>{ranked.map((p, i) => (
          <tr key={p.slug}>
            <td className="r">{i + 1}</td>
            <td className="gname">{p.title}{p.codeName && <span className="pcode"> "{p.codeName}"</span>}</td>
            <td>{p.loopFamily ? (LOOP_LABEL[p.loopFamily] || p.loopFamily) : "—"}</td>
            <td className="r">{p.browserFit !== null ? <Dots n={p.browserFit} /> : "—"}</td>
            <td className="r">{p.steamFit !== null ? <Dots n={p.steamFit} /> : "—"}</td>
            <td className="r">{p.buildEase !== null ? <Dots n={p.buildEase} /> : "—"}</td>
            <td className="r">{p.marketability !== null ? <Dots n={p.marketability} /> : "—"}</td>
            <td className="r">{p.founderFit !== null ? <Dots n={p.founderFit} /> : "—"}</td>
            <td className="r">{p.grayBoxDays != null ? "~" + p.grayBoxDays + "d" : "—"}</td>
            <td><span className={"ptag st st-" + p.status}>{p.status}</span></td>
            <td><span className="ev-chips">{evidenceChips(p).map((c) => (
              <span key={c.label} className={"ev-chip" + (c.missing ? " ev-missing" : "")}>{c.label}</span>
            ))}</span></td>
          </tr>
        ))}</tbody></table>
    </div>
  );
}

export function Library({ hidden }: { hidden: boolean }) {
  const drawer = useDrawer();
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [active, setActive] = useState<string>(DEFAULT_COLLECTION);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([api.pitches().catch(() => []), api.library().catch(() => [])])
      .then(([p, l]) => { setPitches(p); setItems(l); })
      .finally(() => setLoaded(true));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { pitch: pitches.length };
    for (const it of items) c[it.kind] = (c[it.kind] || 0) + 1;
    return c;
  }, [pitches, items]);

  const isLeaderboard = active === "leaderboard";
  const activeName = isLeaderboard ? "Leaderboard" : COLLECTIONS.find((c) => c.key === active)?.name || "";
  const shownPitches = active === "pitch" ? pitches : [];
  const shownItems = active === "pitch" || isLeaderboard ? [] : items.filter((i) => i.kind === active);
  const isEmpty = loaded && !isLeaderboard && shownPitches.length === 0 && shownItems.length === 0;
  const totalLatest = pitches[0]?.pitchDate;
  const activePitchCount = pitches.filter((p) => p.status !== "shelved").length;

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
        <div className="nav-label">Views</div>
        <a
          className={"nav-item" + (isLeaderboard ? " active" : "")}
          onClick={() => setActive("leaderboard")}
        >
          <svg viewBox="0 0 24 24"><path d="M4 20V10M12 20V4M20 20v-7" /></svg>
          Leaderboard
          <span className="badge" style={{ background: activePitchCount ? "var(--accent-soft)" : "var(--text-3)" }}>
            {activePitchCount}
          </span>
        </a>
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
            {activeName} <small>{isLeaderboard ? "which candidate is winning — and what evidence would change that" : "ideas and explorations, next to the market intel that informs them"}</small>
          </h2>
        </div>

        <div className="content">
          {!loaded ? (
            <div className="bcard-grid">
              {[0, 1, 2].map((i) => <div className="bcard skeleton" key={i} style={{ height: 220 }} />)}
            </div>
          ) : isLeaderboard ? (
            <LeaderboardView pitches={pitches} />
          ) : isEmpty ? (
            <EmptyState collectionKey={active} name={activeName} />
          ) : (
            <>
              {active === "pitch" && shownPitches.length > 0 && (
                <div className="bcard-grid">
                  {shownPitches.map((p) => <PitchCard key={p.slug} p={p} />)}
                </div>
              )}
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
      <h3>No {name.toLowerCase()} yet</h3>
      <p>{blurb}</p>
      <div className="soon">New pitches and prototypes are published automatically each week.</div>
    </div>
  );
}
