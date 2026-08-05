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

/**
 * The fragment (including `#`) that addresses a panel, optionally down to a
 * section within it: `#radar/comparables`.
 *
 * Only the top-level panel used to be addressable, so "look at Comparables →
 * Solo-reachable" was unsendable and unbookmarkable, and Back from a section
 * jumped to a different SERVICE — a trapdoor rather than an undo. The section is
 * an opaque slug: this module does not know a panel's sections, and the panel
 * validates what it gets, so adding a section needs no change here.
 */
export function serviceHash(svc: Service, section?: string | null): string {
  const base = `#${SLUG[svc]}`;
  return section ? `${base}/${encodeURIComponent(section)}` : base;
}

/** Split a fragment into its `service/section` parts. */
function segments(hash: string | null | undefined): string[] {
  if (!hash) return [];
  return hash
    .replace(/^#+/, "")
    .split("/")
    .map((s) => decodeURIComponent(s.trim()).toLowerCase())
    .filter((s, i) => i === 0 || s.length > 0);
}

/**
 * The section within the addressed panel, or null when the fragment names only a
 * panel. Returns whatever slug is present — the caller decides whether it is one
 * of its own, and falls back to its default when it is not.
 */
export function parseSectionHash(hash: string | null | undefined): string | null {
  const parts = segments(hash);
  if (parts.length < 2) return null;
  // A section is meaningless without a valid service in front of it.
  if (!BY_SLUG.has(parts[0])) return null;
  return parts[1] || null;
}

/**
 * Resolve a `location.hash` to the panel it addresses. Tolerant by design —
 * a missing, empty, junk or foreign fragment falls back to the default panel
 * rather than rendering nothing.
 */
export function parseServiceHash(hash: string | null | undefined): Service {
  return BY_SLUG.get(segments(hash)[0] ?? "") ?? DEFAULT_SERVICE;
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
  section?: string | null,
  target: HashTarget | undefined = globalThis.location,
) {
  if (!target) return;
  const next = serviceHash(svc, section);
  if (target.hash === next) return;
  target.hash = next;
}
