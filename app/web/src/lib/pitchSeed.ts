import type { BriefDemandTracker, BriefNotable, MarketGap, SteamGap } from "shared";

// "Copy pitch seed" (#69): a plain structured brief of one market gap or Brief card. Names the
// evidence only — never a tool, skill or command — and drops a line rather than print a blank.
/** source = where the row was read ("Steam indie cohort", "CrazyGames"); captured = YYYY-MM-DD */
export type SeedContext = { source: string; captured: string };

const num = (v: number) => Math.round(v).toLocaleString("en-US");
const join = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join("\n");

type Gap = MarketGap | SteamGap;
function gapSeed(g: Gap, ctx: SeedContext, appetite: string | null, price?: string | null) {
  return join([
    `Pitch seed — ${g.label}`,
    `Market: ${g.genre} · ${g.tag}`,
    `Source: ${ctx.source} · captured ${ctx.captured}`,
    appetite,
    `Supply: ${g.supplyN} games${g.supplyRising ? " · supply rising" : ""}`,
    `Quality ceiling: ${g.qualityCeil.toFixed(2)} (P90 rating)`,
    price,
    `Opportunity score: ${g.score.toFixed(1)}`,
    g.examples?.length ? `Examples: ${g.examples.join(" · ")}` : null,
  ]);
}

export const browserGapSeed = (g: MarketGap, ctx: SeedContext) =>
  gapSeed(g, ctx, `Appetite: ${num(g.appetite)} median votes per title`);

export function steamGapSeed(g: SteamGap, ctx: SeedContext): string {
  // Demand is median reviews (#218); owners are a coarse SteamSpy bucket, context only.
  const owners = g.medianOwners ? `≈${num(g.medianOwners)} median owners` : null;
  const appetite =
    g.medianVotes != null
      ? `Appetite: ${num(g.medianVotes)} median reviews per game${owners ? ` (${owners}, context)` : ""}`
      : owners && `Appetite: ${owners} (context)`;
  const c = g.medianPriceCents;
  const price = c == null ? null : `Median price: ${c === 0 ? "Free" : `$${(c / 100).toFixed(2)}`}`;
  return gapSeed(g, ctx, appetite, price);
}

/** The loop family the edition's tracker placed this title in; null when it was not placed. */
export function familyFor(title: string, tracker?: BriefDemandTracker | null): string | null {
  const key = title.trim().toLowerCase();
  const hit = (t: string) => t.trim().toLowerCase() === key;
  return tracker?.rows.find((r) => r.family && r.titles.some(hit))?.family ?? null;
}

export function briefSeed(
  item: BriefNotable,
  edition: { editionDate: string; tracker?: BriefDemandTracker | null },
): string {
  const family = familyFor(item.name, edition.tracker);
  const signal = [item.category || item.kind, item.status, item.date].filter(Boolean).join(" · ");
  return join([
    `Pitch seed — ${item.name}`,
    signal && `Signal: ${signal}`,
    family && `Loop family: ${family}`,
    item.figure && `Figure: ${item.figure}`,
    item.blurb && `What: ${item.blurb}`,
    item.relevance && `Why it matters: ${item.relevance}`,
    `Source: News Brief ${edition.editionDate}${item.source ? ` · ${item.source}` : ""}`,
  ]);
}

/** Today as YYYY-MM-DD (UTC) — the capture stamp for a gap read. */
export const today = () => new Date().toISOString().slice(0, 10);

// `navigator.clipboard` is undefined in insecure contexts (and node), so fall back to a hidden
// textarea + execCommand("copy"). Never throws — resolves false so the button can say so.
export async function copyText(text: string): Promise<boolean> {
  try {
    const clip = globalThis.navigator?.clipboard;
    if (clip?.writeText) return await clip.writeText(text).then(() => true);
  } catch {
    // denied or unsupported — fall through
  }
  try {
    const doc = globalThis.document;
    if (!doc || typeof doc.execCommand !== "function") return false;
    const ta = Object.assign(doc.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
