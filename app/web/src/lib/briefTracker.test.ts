import { describe, it, expect } from "vitest";
import { compact, rowSummary } from "./briefTracker.ts";
import type { BriefFamilyRow } from "shared";

const row = (over: Partial<BriefFamilyRow> = {}): BriefFamilyRow => ({
  family: "extraction-lite",
  signals: 6,
  titles: [],
  ...over,
});

describe("#12a brief tracker display", () => {
  it("compacts counts", () => {
    expect([940, 12_000, 380_000, 1_200_000].map(compact)).toEqual(["940", "12K", "380K", "1.2M"]);
  });

  it("summarises a family, omitting parts the data can't support", () => {
    expect(rowSummary(row())).toBe("6 signals"); // no figures, no previous edition → neither shown
    const mag = { value: 380_000, unit: "wishlist", sampled: 4 };
    expect(rowSummary(row({ magnitude: mag, direction: "up" }))).toBe(
      "6 signals ↑ · 380K wishlists (4/6)",
    );
    expect(rowSummary(row({ signals: 1, magnitude: { value: 1, unit: "copy", sampled: 1 } }))).toBe(
      "1 signal · 1 copy (1/1)",
    );
  });
});
