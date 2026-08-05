// The end of a panel.
//
// Every panel used to close on `KAIROS · GameRadar · live from Neon` — 11px grey
// centred filler. After scrolling a dense analytical surface, the last thing you
// read was a signature.
//
// Success in this product is a build/no-build call, and that call is a path:
// Radar (find an underserved market) → a pitch → a prototype → Revenue (can it
// clear the income target?). So a panel ends by handing off to the next step on
// that path, not by naming itself. The peak-end of each screen becomes the next
// action instead of a byline.

export interface HandoffLink {
  label: string;
  hint: string;
  onClick: () => void;
}

export function Handoff({ links }: { links: HandoffLink[] }) {
  if (!links.length) return null;
  return (
    <nav className="handoff" aria-label="Next step">
      {links.map((l) => (
        <button type="button" className="handoff-link" key={l.label} onClick={l.onClick}>
          <span className="handoff-label">{l.label}</span>
          <span className="handoff-hint">{l.hint}</span>
          <svg className="handoff-arrow" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </button>
      ))}
    </nav>
  );
}
