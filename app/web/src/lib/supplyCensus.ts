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
