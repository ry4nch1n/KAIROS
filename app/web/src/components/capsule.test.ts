import { describe, it, expect } from "vitest";
import { plateInitial } from "./Capsule.tsx";

// The plate must always render something. A row whose title is missing or exotic
// still gets a plate rather than a crash, a blank box, or a literal "undefined".
describe("plateInitial", () => {
  it("uses the first character, uppercased", () => {
    expect(plateInitial("Deckbound Hollow")).toBe("D");
    expect(plateInitial("tidewright")).toBe("T");
  });

  it("ignores leading whitespace rather than rendering a blank glyph", () => {
    expect(plateInitial("   Pale Harbour")).toBe("P");
  });

  it("falls back to a neutral mark for an empty or whitespace-only title", () => {
    expect(plateInitial("")).toBe("·");
    expect(plateInitial("   ")).toBe("·");
  });

  it("does not split an astral-plane character in half", () => {
    // Naive title[0] would return a lone surrogate and render as a replacement box.
    expect(plateInitial("𝕂airos")).toBe("𝕂");
    expect(plateInitial("🎮 Jam Build")).toBe("🎮");
  });

  it("survives a nullish title without throwing", () => {
    expect(plateInitial(undefined as unknown as string)).toBe("·");
  });
});
