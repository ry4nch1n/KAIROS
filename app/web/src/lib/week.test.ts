import { describe, it, expect } from "vitest";
import { mondayOf, isSameWeek } from "./week.ts";

// 2026-06-30 is a Tuesday; its calendar week starts Monday 2026-06-29.
const tue = new Date("2026-06-30T12:00:00Z");

describe("mondayOf", () => {
  it("returns the Monday that starts the week", () => {
    expect(mondayOf(tue)).toBe(Date.UTC(2026, 5, 29)); // Tue → Mon Jun 29
    expect(mondayOf(new Date("2026-06-29T00:00:00Z"))).toBe(Date.UTC(2026, 5, 29)); // Mon → itself
    expect(mondayOf(new Date("2026-06-28T00:00:00Z"))).toBe(Date.UTC(2026, 5, 22)); // Sun → prior Mon
  });
});

describe("isSameWeek — the brief 'This week' grouping", () => {
  it("a Monday edition this week is 'this week'", () => {
    expect(isSameWeek("2026-06-29", tue)).toBe(true);
  });
  it("last week's Friday edition is NOT this week", () => {
    expect(isSameWeek("2026-06-26", tue)).toBe(false); // the reported bug
    expect(isSameWeek("2026-06-23", tue)).toBe(false);
  });
});
