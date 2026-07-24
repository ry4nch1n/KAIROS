import type { Service } from "../components/Rail.tsx";

// Which service panels have ever been fronted. The shell lazy-mounts a panel only
// after its tab is first activated, then keeps it mounted (hidden) — so state and
// scroll survive tab switches while a never-opened panel ships no JS and runs no
// fetch. Radar is the default tab, so it counts as activated from first paint.
export const INITIAL_ACTIVATED: readonly Service[] = ["radar"];

// Pure state transition for the activated set: idempotent add. Returns the same
// Set reference when `svc` is already present so React can bail out of a re-render.
export function addActivated(prev: Set<Service>, svc: Service): Set<Service> {
  if (prev.has(svc)) return prev;
  const next = new Set(prev);
  next.add(svc);
  return next;
}
