import type { SupplyCensus } from "shared";

// One-line reading of a Steam release census (#245) under the supply chip. A page that ran out
// early is a LOWER BOUND ("100+ in 11 days"), never a fake exact count.
export function censusNote(c: SupplyCensus): string {
  const n = c.recent + c.prior;
  const count = `${n}${c.truncated ? "+" : ""} releases in ${c.coveredDays} days`;
  const price =
    c.medianPriceCents == null ? "" : ` · $${(c.medianPriceCents / 100).toFixed(2)} median`;
  return count + price;
}

export function censusTitle(c: SupplyCensus): string {
  return (
    `Counted from the Steam store's own listing for this tag on ${c.capturedOn} ` +
    `(${c.totalCount.toLocaleString("en-US")} tagged games), not from tracked titles.` +
    (c.truncated ? " The listing page ran out early, so this is a lower bound." : "")
  );
}

// Survivor qualifier for the success-band chip (#258). Where the crawl holds a sliver of a tag's
// census (below 5%), the band is the median of the market's crawled leaders, so the chip says
// "top 3 of 909" and the tooltip says what the median is of. Null when the band reads the market.
export function survivorBandNote(r: {
  games: number;
  survivorBand?: boolean;
  census?: SupplyCensus | null;
}): { note: string; title: string } | null {
  if (!r.survivorBand || !r.census) return null;
  const total = r.census.totalCount.toLocaleString("en-US");
  return {
    note: `top ${r.games} of ${total}`,
    title:
      `Survivor read: this tier is the median of the ${r.games} crawled leaders, not of the ` +
      `${total} games carrying the tag on the store. The market's typical title earns less.`,
  };
}
