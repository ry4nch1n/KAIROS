import { describe, it, expect } from "vitest";
import { routeLean } from "./routeLean.ts";

describe("routeLean — the pitch-level route compass (C2)", () => {
  it("browser-heavy leans Routes 2/3, Steam-heavy leans Route 1", () => {
    expect(routeLean(3, 1)?.cls).toBe("route-23");
    expect(routeLean(1, 3)?.cls).toBe("route-1");
  });
  it("a null axis (platform doesn't apply) is itself a firm lean", () => {
    expect(routeLean(2, null)?.cls).toBe("route-23"); // browser-only ladder
    expect(routeLean(null, 2)?.cls).toBe("route-1"); // steam-only ladder
  });
  it("both strong + equal = optionality (keep Phase-0 doors open)", () => {
    expect(routeLean(3, 3)?.label).toBe("optionality");
    expect(routeLean(2, 2)?.label).toBe("optionality");
  });
  it("both weak + equal = unclear, not a false confident lean", () => {
    expect(routeLean(1, 1)?.label).toBe("unclear lean");
  });
  it("returns null only when neither axis is scored", () => {
    expect(routeLean(null, null)).toBeNull();
  });
});
