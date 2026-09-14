// #204 S4 — a vote LEVEL cell reads the raw count on one portal and the within-portal percentile on
// All Browser, where raw counts on different bases are never pooled.
import { describe, expect, it } from "vitest";
import { levelCell } from "./Radar.tsx";

describe("levelCell", () => {
  it("one portal: the raw count, grouped exactly as before", () => {
    expect(levelCell(18000, null)).toBe("18,000");
    expect(levelCell(0, null)).toBe("0");
  });
  it("All Browser: the percentile as a P-value", () => {
    expect(levelCell(null, 47)).toBe("P47");
    expect(levelCell(null, 0)).toBe("P0");
  });
  it("neither present reads as a dash, never as zero", () => {
    expect(levelCell(null, null)).toBe("—");
    expect(levelCell(undefined, undefined)).toBe("—");
  });
});
