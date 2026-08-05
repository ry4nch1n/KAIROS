import { useEffect, useId, useRef, useState } from "react";

// The definition layer.
//
// KAIROS carries a large, deliberately specific vocabulary — crowding, wide,
// quiet, est., z(demand) + z(quality) − z(supply) — and all of it lived in 67
// `title=` attributes. `title` never fires on touch, has a ~1s delay, cannot be
// styled, and is announced inconsistently by screen readers.
//
// That made it a product gap rather than a polish item: this app is opened on
// phones, and an unaided third-party reader is a real audience. Both got the
// chips and none of their meanings.
//
// Opens on click AND hover, so it works for a thumb and for a pointer. Escape,
// outside-click and blur all close it. The trigger is a real button, so it is in
// the tab order and announces itself; aria-describedby ties the bubble to it.

export function Tip({ text, label = "What this means" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  // Hover-out should not slam it shut while the pointer crosses the gap.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => void (closeTimer.current && clearTimeout(closeTimer.current)), []);

  const hoverOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <span className="tip-wrap" ref={wrap} onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
      <button
        type="button"
        className="tip-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onFocus={hoverOpen}
        onBlur={hoverClose}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
      {open && (
        <span className="tip-bubble" id={id} role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}
