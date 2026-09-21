import { describe, expect, it } from "vitest";
import type { SupplyCensus } from "shared";
import { censusNote, censusTitle } from "./supplyCensus.ts";

const c = (o: Partial<SupplyCensus>): SupplyCensus => ({
  capturedOn: "2026-09-21",
  recent: 44,
  prior: 50,
  coveredDays: 60,
  truncated: false,
  totalCount: 887,
  medianPriceCents: 799,
  ...o,
});

describe("censusNote", () => {
  it("states a complete reading as an exact count with its median price", () => {
    expect(censusNote(c({}))).toBe("94 releases in 60 days · $7.99 median");
  });
  it("marks a page that ran out early as a lower bound", () => {
    expect(censusNote(c({ recent: 100, prior: 0, coveredDays: 11, truncated: true }))).toBe(
      "100+ releases in 11 days · $7.99 median",
    );
  });
  it("omits the price when none was read", () => {
    expect(censusNote(c({ medianPriceCents: null }))).toBe("94 releases in 60 days");
  });
  it("the tooltip names the store listing and flags a lower bound", () => {
    expect(censusTitle(c({}))).toContain("887 tagged games");
    expect(censusTitle(c({ truncated: true }))).toContain("lower bound");
  });
});
