import type { BriefNotable, BriefTopSignal } from "shared";

// Display helpers for the brief's rich cards (#155, #156). Out of the component so they are
// testable like their sibling libs — the component keeps only the markup.

const isUrl = (s?: string | null) => typeof s === "string" && /^https?:\/\//i.test(s.trim());

/** Steam's public capsule for an appid. Non-numeric appids yield null rather than a URL that
 *  would 404 into a broken <img>. */
export function steamCover(appid?: string | null): string | null {
  const id = (appid || "").trim();
  return /^\d+$/.test(id)
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`
    : null;
}

/** #155 — the art a card should show. `notable` has always fallen back to the Steam capsule
 *  derived from `steam_appid`; the browser branch had no such path, so a browser item with a
 *  perfectly good appid still rendered a source-branded placeholder. Both branches now walk the
 *  same chain, and payload-supplied URLs are validated so a malformed value falls through to the
 *  placeholder instead of producing a broken image. */
export function cardImage(item: BriefNotable, kind: "notable" | "browser"): string | null {
  const fromPayload =
    kind === "notable"
      ? [item.cover_url, item.image_url].find(isUrl)
      : [item.image_url, item.cover_url].find(isUrl);
  return fromPayload ?? steamCover(item.steam_appid);
}

// ── #156 · the Browser section, split by what a card is evidence FOR ──────────────────────
// Portal-native ratings and platform telemetry answer "is the browser market worth entering?";
// a free browser build feeding a paid store release answers "does the browser→store ladder
// convert?". Rendered as one flat list they read as a single accumulating signal for "browser".
// The distinguishing vocabulary already exists in the payload as `kind`, so this groups by it —
// no new taxonomy, no contract change.

export type BrowserGroupId = "native" | "funnel" | "platform";

export interface BrowserGroup {
  id: BrowserGroupId;
  label: string;
  note: string;
}

/** Render order: supply first (the bulk of most editions), then route evidence, then context. */
export const BROWSER_GROUPS: readonly BrowserGroup[] = [
  { id: "native", label: "Browser-native supply", note: "portal-market demand signals" },
  { id: "funnel", label: "Funnel / route evidence", note: "browser build → store release" },
  { id: "platform", label: "Platform notes", note: "portal context" },
] as const;

/** An unexpected or missing `kind` groups with browser-native rather than disappearing —
 *  mis-grouping a card is far cheaper than silently dropping it. */
export function browserGroupOf(kind?: string | null): BrowserGroupId {
  const k = (kind || "").trim().toLowerCase();
  if (k === "loop signal") return "funnel";
  if (k === "browser platform") return "platform";
  return "native";
}

/** Non-empty groups only, in BROWSER_GROUPS order; card order within a group is preserved. */
export function groupBrowserCards<T extends { kind?: string | null }>(
  items: readonly T[],
): (BrowserGroup & { items: T[] })[] {
  return BROWSER_GROUPS.map((g) => ({
    ...g,
    items: items.filter((it) => browserGroupOf(it.kind) === g.id),
  })).filter((g) => g.items.length > 0);
}

/** briefPayload v2 — a Top Signal may be a plain string or `{ text, source }`. Top Signals render
 *  ABOVE the cards, so before v2 a reader had to scroll down and guess which card a signal meant;
 *  the object form gives the line its own link. The string form stays legal forever: editions
 *  published before v2 carry no source, and brief validation is advisory, so an old edition must
 *  keep rendering rather than blank the section. A malformed entry degrades to empty text, never
 *  to a thrown render. */
export function topSignal(s: string | BriefTopSignal): { text: string; source?: string } {
  if (typeof s === "string") return { text: s };
  const src = isUrl(s?.source) ? s.source : undefined;
  return { text: typeof s?.text === "string" ? s.text : "", source: src };
}
