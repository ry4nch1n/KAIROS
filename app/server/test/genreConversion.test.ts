import { describe, it, expect } from "vitest";
import { conversionFor, CONVERSION_BASELINE } from "../src/data/genreConversion.ts";

describe("genreConversion — cited, directional wishlist→sale signal (R4.1)", () => {
  it("returns a strong signal for genres Steam's audience seeks out", () => {
    const sim = conversionFor("Simulation");
    expect(sim?.signal).toBe("strong");
    expect(sim?.source).toMatch(/gamediscover/);
    expect(sim?.asOf).toMatch(/^\d{4}-\d{2}$/);
    expect(conversionFor("Horror")?.signal).toBe("strong");
    expect(conversionFor("Idle")?.signal).toBe("strong");
  });

  it("flags high-deliberation genres (price-sensitive, lower median)", () => {
    expect(conversionFor("RPG")?.signal).toBe("deliberation");
  });

  it("is case-insensitive on the canonical genre name", () => {
    expect(conversionFor("simulation")?.signal).toBe("strong");
    expect(conversionFor("SIMULATION")?.signal).toBe("strong");
  });

  it("makes NO claim for genres without a clear signal (null, no chip)", () => {
    expect(conversionFor("Puzzle")).toBeNull();
    expect(conversionFor("")).toBeNull();
    expect(conversionFor(null)).toBeNull();
  });

  it("the baseline states the spread, not a single forecast number", () => {
    expect(CONVERSION_BASELINE).toMatch(/0\.17/);
    expect(CONVERSION_BASELINE).toMatch(/10–20×|spread/);
  });
});
