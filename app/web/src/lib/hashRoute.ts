import type { Service } from "../components/Rail.tsx";

// URL state for the four service panels — the shell's only routing.
//
// KAIROS is a one-shell SPA with no router: the panels are always mounted and
// toggled by `hidden` props. This module adds the *address* of the fronted panel
// (`#brief`, `#library`, …) so a view is bookmarkable, survives a refresh, and
// works with browser back/forward — without pulling in a router dependency or
// changing how the panels render.
//
// Contract: an empty, absent or unrecognised fragment resolves to the default
// panel, so a plain visit to `/` behaves exactly as it did before URL state
// existed. The fragment is never written on load — only on an actual switch.

export const DEFAULT_SERVICE: Service = "radar";

// Service id → URL slug. Ids and slugs are deliberately identical: the slug is a
// user-visible name, so keep it stable even if an internal id is ever renamed.
const SLUG: Record<Service, string> = {
  radar: "radar",
  brief: "brief",
  library: "library",
  revenue: "revenue",
};

const BY_SLUG = new Map<string, Service>(
  (Object.keys(SLUG) as Service[]).map((svc) => [SLUG[svc], svc]),
);

/** The fragment (including `#`) that addresses a panel. */
export function serviceHash(svc: Service): string {
  return `#${SLUG[svc]}`;
}

/**
 * Resolve a `location.hash` to the panel it addresses. Tolerant by design —
 * a missing, empty, junk or foreign fragment falls back to the default panel
 * rather than rendering nothing.
 */
export function parseServiceHash(hash: string | null | undefined): Service {
  if (!hash) return DEFAULT_SERVICE;
  const slug = decodeURIComponent(hash.replace(/^#+/, "").trim()).toLowerCase();
  return BY_SLUG.get(slug) ?? DEFAULT_SERVICE;
}

/** Minimal slice of `window.location` this module writes to (keeps it testable). */
export type HashTarget = { hash: string };

/**
 * Point the URL at a panel. Assigning `location.hash` pushes a history entry, so
 * back/forward walks the panels the user actually visited; a no-op write is
 * skipped so re-selecting the current panel doesn't stack duplicate entries.
 */
export function writeServiceHash(
  svc: Service,
  target: HashTarget | undefined = globalThis.location,
) {
  if (!target) return;
  const next = serviceHash(svc);
  if (target.hash === next) return;
  target.hash = next;
}
