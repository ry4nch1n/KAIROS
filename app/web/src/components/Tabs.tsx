import { useRef } from "react";

// A real tab list.
//
// Both platform selectors previously declared role="tablist" with role="tab"
// children and then delivered none of the contract: no aria-controls, no element
// with role="tabpanel", and no roving tabindex. A screen reader announced "tab
// list, 4 items" and then handed over controls that did not behave like tabs —
// worse than plain buttons, because it promised a pattern it did not implement.
//
// This supplies the parts that were missing:
//   - roving tabindex, so the group is ONE tab stop and arrows move within it
//   - Home/End, which users of this pattern expect
//   - aria-controls pointing at a real tabpanel the caller renders
//
// Selection follows focus (automatic activation), which is the recommended
// behaviour when switching costs nothing but a re-render.

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Optional leading mark (the platform dot). Decorative. */
  mark?: React.ReactNode;
}

export function TabList<T extends string>({
  tabs,
  value,
  onChange,
  panelId,
  label,
  groupLabel,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (v: T) => void;
  /** id of the element carrying role="tabpanel". */
  panelId: string;
  label: string;
  /** Optional visible caption for a sub-group (e.g. "PC" / "BROWSER"). */
  groupLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const move = (dir: 1 | -1 | "home" | "end") => {
    const i = tabs.findIndex((t) => t.id === value);
    const next =
      dir === "home" ? 0 : dir === "end" ? tabs.length - 1 : (i + dir + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    // Focus must follow selection or the roving tabindex strands the user on a
    // button that is no longer tabbable.
    requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${tabs[next].id}"]`)?.focus();
    });
  };

  return (
    <div className="seg-group" ref={ref}>
      {groupLabel && <span className="seg-group-label">{groupLabel}</span>}
      <div
        className="seg"
        role="tablist"
        aria-label={label}
        onKeyDown={(e) => {
          const k = e.key;
          if (k === "ArrowRight" || k === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (k === "ArrowLeft" || k === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (k === "Home") {
            e.preventDefault();
            move("home");
          } else if (k === "End") {
            e.preventDefault();
            move("end");
          }
        }}
      >
        {tabs.map((t, i) => {
          const selected = t.id === value;
          // Roving tabindex needs exactly one tabbable stop per list. The platform
          // selector splits across two lists sharing one value, so the group that
          // does NOT hold the current value would otherwise have every tab at
          // tabIndex -1 — making it completely unreachable by Tab. Fall back to
          // the first tab so each list always has an entry point.
          const hasSelected = tabs.some((x) => x.id === value);
          const tabbable = hasSelected ? selected : i === 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab={t.id}
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={tabbable ? 0 : -1}
              className={"seg-btn" + (selected ? " active" : "")}
              onClick={() => onChange(t.id)}
            >
              {t.mark}
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
