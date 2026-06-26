export type Service = "radar" | "brief" | "library";

export function Rail({ active, onSelect }: { active: Service; onSelect: (s: Service) => void }) {
  return (
    <nav className="rail">
      <div className="rail-logo">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      </div>
      <div className="rail-group">
        <button
          className={"rail-btn" + (active === "radar" ? " active" : "")}
          data-label="GameRadar — Market Intel"
          onClick={() => onSelect("radar")}
          aria-label="GameRadar"
        >
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 12l6-3" />
            <path d="M12 3v3M21 12h-3" />
            <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button
          className={"rail-btn" + (active === "brief" ? " active" : "")}
          data-label="News Brief"
          onClick={() => onSelect("brief")}
          aria-label="News Brief"
        >
          <svg viewBox="0 0 24 24">
            <path d="M4 5h13v14a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z" />
            <path d="M17 8h3v10a2 2 0 0 1-2 2" />
            <path d="M7 9h7M7 13h7M7 17h4" />
          </svg>
        </button>
        <button
          className={"rail-btn" + (active === "library" ? " active" : "")}
          data-label="Library"
          onClick={() => onSelect("library")}
          aria-label="Library"
        >
          <svg viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
      </div>
      <div className="rail-foot">
        <div className="avatar">R</div>
      </div>
    </nav>
  );
}
