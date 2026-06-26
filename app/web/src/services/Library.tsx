const COLLECTIONS = [
  { name: "All items", icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></> },
  { name: "Prototypes", icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></> },
  { name: "Design Docs", icon: <><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></> },
  { name: "Art Explorations", icon: <><circle cx="9" cy="9" r="2" /><path d="M4 4h16v16H4z" /><path d="M4 16l5-4 4 3 3-2 4 3" /></> },
  { name: "References", icon: <><path d="M12 3l8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4M4 17l8 4 8-4" /></> },
];

export function Library({ hidden }: { hidden: boolean }) {
  return (
    <section className="service" data-svc="library" hidden={hidden}>
      <aside className="side">
        <div className="side-head">
          <b>Library</b>
          <span>work showcase</span>
        </div>
        <div className="nav-label">Collections</div>
        {COLLECTIONS.map((c, i) => (
          <a className={"nav-item" + (i === 0 ? " active" : "")} key={c.name}>
            <svg viewBox="0 0 24 24">{c.icon}</svg>
            {c.name}
            <span className="badge" style={{ background: "var(--text-3)" }}>0</span>
          </a>
        ))}
        <div className="side-foot">Empty · wire up in V2</div>
      </aside>
      <main className="main">
        <div className="topbar">
          <h2>
            Library <small>prototypes · design docs · art exploration</small>
          </h2>
        </div>
        <div className="content">
          <div className="empty">
            <div className="big-ic">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 17.5h7M17.5 14v7" />
              </svg>
            </div>
            <h3>Your library is empty</h3>
            <p>
              A home for your prototypes, design docs, and art-style explorations — so your own work
              lives next to the market intel that informs it.
            </p>
            <div className="ghost-row">
              <div className="ghost"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>Prototypes</div>
              <div className="ghost"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8" /></svg>Design Docs</div>
              <div className="ghost"><svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="2" /><path d="M4 4h16v16H4z" /><path d="M4 16l5-4 4 3 3-2 4 3" /></svg>Art</div>
              <div className="ghost"><svg viewBox="0 0 24 24"><path d="M12 3l8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /></svg>References</div>
            </div>
            <button className="btn-soft" disabled>
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Add item
            </button>
            <div className="soon">Planned for V2 — schema ready (library_items)</div>
          </div>
        </div>
      </main>
    </section>
  );
}
