// Brief cadence gaps (#180). A list of the editions that exist cannot show the edition that
// does not, so the expected cadence is INFERRED from trailing history and the missed slots are
// derived. The load-bearing properties are the negative ones: a clean history claims no gap,
// a short history claims no cadence at all, and no slot in the future is ever called missing.
import { describe, expect, it } from "vitest";
import type { BriefEditionMeta } from "shared";
import { deriveBriefGaps } from "../src/queries/library.ts";

const ed = (date: string, id: number): BriefEditionMeta => ({
  id,
  editionDate: date,
  weekday: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${date}T00:00:00Z`).getUTCDay()
  ],
  briefType: "indie",
  sourceCount: 0,
});

// Tue + Thu, every week, for the eight weeks ending Sun 2026-08-30.
function tueThuHistory(weeks = 8, firstTuesday = "2026-07-07"): string[] {
  const out: string[] = [];
  const t0 = new Date(`${firstTuesday}T00:00:00Z`).getTime();
  for (let w = 0; w < weeks; w++) {
    out.push(new Date(t0 + w * 7 * 86_400_000).toISOString().slice(0, 10));
    out.push(new Date(t0 + (w * 7 + 2) * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

const build = (dates: string[]) => dates.map((d, i) => ed(d, i + 1));
const MON = new Date("2026-08-31T09:00:00Z"); // a Monday: the six complete weeks end 08-30

describe("deriveBriefGaps", () => {
  const dates = (gaps: BriefEditionMeta[]) => gaps.map((g) => g.editionDate);

  it("reports no gap on an unbroken Tue/Thu history", () => {
    expect(deriveBriefGaps(build(tueThuHistory()), MON)).toEqual([]);
  });

  it("reports exactly the one skipped Thursday, and only that slot", () => {
    const gaps = deriveBriefGaps(build(tueThuHistory().filter((d) => d !== "2026-08-20")), MON);
    expect(dates(gaps)).toEqual(["2026-08-20"]);
    expect(gaps[0]).toMatchObject({ weekday: "thu", missing: true, id: 0, sourceCount: 0 });
  });

  it("catches the first miss — one slot is the threshold, not a run of them", () => {
    const gaps = deriveBriefGaps(build(tueThuHistory().filter((d) => d !== "2026-08-27")), MON);
    expect(dates(gaps)).toEqual(["2026-08-27"]);
  });

  it("reports both misses when a weekday is skipped twice — the #180 sighting", () => {
    const kept = tueThuHistory().filter((d) => d !== "2026-08-20" && d !== "2026-08-27");
    expect(dates(deriveBriefGaps(build(kept), MON))).toEqual(["2026-08-27", "2026-08-20"]);
  });

  it("claims no cadence — and therefore no gaps — on a short history", () => {
    expect(deriveBriefGaps(build(tueThuHistory(3, "2026-08-11")), MON)).toEqual([]);
  });

  it("never calls today or a future slot missing", () => {
    // Thursday 2026-09-03, that day's edition not yet published.
    const gaps = deriveBriefGaps(build(tueThuHistory(9)), new Date("2026-09-03T02:00:00Z"));
    expect(gaps.every((g) => g.editionDate < "2026-09-03")).toBe(true);
    expect(gaps).toEqual([]);
  });

  it("manufactures no gap at the start of the trailing window", () => {
    // Long enough to claim a cadence, but the first edition lands on the window's own
    // Monday — the Tue/Thu slots before it were never expected.
    const hist = tueThuHistory(20, "2026-04-14").filter((d) => d >= "2026-07-21");
    hist.unshift("2026-07-20");
    expect(deriveBriefGaps(build(hist), MON)).toEqual([]);
  });

  it("says nothing at all with no editions", () => {
    expect(deriveBriefGaps([], MON)).toEqual([]);
  });

  it("a weekday that publishes only occasionally is not cadence", () => {
    // One lone Friday in the window must not turn every other Friday into a miss.
    expect(deriveBriefGaps(build([...tueThuHistory(), "2026-08-28"]), MON)).toEqual([]);
  });
});
