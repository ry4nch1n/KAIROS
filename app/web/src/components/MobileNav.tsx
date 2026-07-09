import { useEffect, useState } from "react";

// Mobile secondary-nav drawer. On phones/tablets the per-service `.side` sidebar
// is hidden off-canvas and slid in via a hamburger; on desktop these pieces are
// display:none (see styles.css) so the sidebar stays a static rail.
export function useDrawer() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return { open, openDrawer: () => setOpen(true), closeDrawer: () => setOpen(false) };
}

// Hamburger button — lives in each service's topbar, only visible on mobile.
export function NavToggle({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="nav-toggle" aria-label="Open sections menu" onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </button>
  );
}

// Dark overlay behind an open drawer; tap to dismiss.
export function NavScrim({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <div className={"side-scrim" + (open ? " open" : "")} onClick={onClose} aria-hidden="true" />;
}

// Close (×) affordance pinned inside the drawer, for an explicit escape route.
export function DrawerClose({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="side-close" aria-label="Close menu" onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
}
