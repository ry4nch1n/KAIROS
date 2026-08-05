import { useEffect, useRef, useState } from "react";

// Mobile secondary-nav drawer. On phones/tablets the per-service `.side` sidebar
// is hidden off-canvas and slid in via a hamburger; on desktop these pieces are
// display:none (see styles.css) so the sidebar stays a static rail.
// The `.side` sidebar is TWO different things depending on width: a static rail on
// desktop, and an overlay drawer below 1080px (see styles.css). Dialog semantics
// belong to the drawer only — announcing the desktop rail as a modal dialog would
// be its own bug — so they are applied from the same breakpoint the CSS uses.
const DRAWER_MQ = "(max-width: 1080px)";

export function useIsDrawer(): boolean {
  const [isDrawer, setIsDrawer] = useState(
    () => globalThis.matchMedia?.(DRAWER_MQ).matches ?? false,
  );
  useEffect(() => {
    const mq = globalThis.matchMedia?.(DRAWER_MQ);
    if (!mq) return;
    const on = () => setIsDrawer(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isDrawer;
}

export function useDrawer() {
  const [open, setOpen] = useState(false);
  // The element that opened the drawer, so focus can go back where it came from.
  const opener = useRef<HTMLElement | null>(null);
  // The drawer panel, for the focus trap.
  const panel = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Escape already closed it, but focus had never MOVED INTO the drawer, so a
    // keyboard user was dismissing something they were never inside. Move focus
    // in on open, trap Tab within it while it is over the page, and restore focus
    // to the opener on close — the three halves of the dialog contract this
    // component claimed by behaviour but never implemented.
    const el = panel.current;
    const focusables = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((n) => n.offsetParent !== null);

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Must go through the same close path as the × and the scrim, or focus is
        // left on an element inside a panel that is now off-canvas.
        setOpen(false);
        opener.current?.focus();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !el?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return {
    open,
    panelRef: panel,
    openDrawer: (e?: { currentTarget: HTMLElement }) => {
      opener.current = e?.currentTarget ?? (document.activeElement as HTMLElement | null);
      setOpen(true);
    },
    closeDrawer: () => {
      setOpen(false);
      opener.current?.focus();
    },
  };
}

// Hamburger button — lives in each service's topbar, only visible on mobile.
export function NavToggle({ onClick }: { onClick: (e: { currentTarget: HTMLElement }) => void }) {
  return (
    <button
      type="button"
      className="nav-toggle"
      aria-label="Open sections menu"
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}

/** ARIA + ref for a service's `.side` element. Spread onto the <aside>. Returns
 *  dialog semantics only while the sidebar is actually an overlay drawer. */
export function drawerPanelProps(
  drawer: ReturnType<typeof useDrawer>,
  isDrawer: boolean,
  label: string,
) {
  return {
    ref: drawer.panelRef as React.Ref<HTMLElement>,
    ...(isDrawer
      ? {
          role: "dialog",
          "aria-modal": drawer.open,
          "aria-label": label,
          // Keeps the closed drawer out of the tab order entirely, so a keyboard
          // user cannot tab into an off-canvas panel they cannot see.
          inert: drawer.open ? undefined : ("" as unknown as boolean),
        }
      : {}),
  };
}

// Dark overlay behind an open drawer; tap to dismiss.
export function NavScrim({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className={"side-scrim" + (open ? " open" : "")} onClick={onClose} aria-hidden="true" />
  );
}

// Close (×) affordance pinned inside the drawer, for an explicit escape route.
export function DrawerClose({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="side-close" aria-label="Close menu" onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
