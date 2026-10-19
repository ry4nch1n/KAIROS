import { describe, it, expect } from "vitest";
import { provenanceNote, resolveProvenance, type Provenance } from "./provenance.ts";
import { STEAM_DEFAULTS, STEAM_HINTS } from "./steamRevenue.ts";
import { BROWSER_AD_DEFAULTS, HINTS } from "./browserAds.ts";

describe("provenance notes", () => {
  it("renders each state", () => {
    expect(provenanceNote({ kind: "assumed", basis: "Steam 30%" })).toBe("assumed · Steam 30%");
    expect(provenanceNote({ kind: "seeded", from: "Balatro" })).toBe("from Balatro");
    expect(provenanceNote({ kind: "edited" })).toBe("edited");
    expect(provenanceNote({ kind: "measured", basis: "store page" })).toBe("measured · store page");
  });

  it("an edit overrides any origin; otherwise the origin stands", () => {
    const seeded: Provenance = { kind: "seeded", from: "Balatro" };
    expect(resolveProvenance(seeded, true)).toEqual({ kind: "edited" });
    expect(resolveProvenance(seeded, false)).toBe(seeded);
  });
});

describe("every Revenue input has a published basis", () => {
  it("Steam: one non-empty hint per default", () => {
    expect(Object.keys(STEAM_HINTS).sort()).toEqual(Object.keys(STEAM_DEFAULTS).sort());
    for (const v of Object.values(STEAM_HINTS)) expect(v.trim()).not.toBe("");
  });

  it("Browser: one non-empty hint per default", () => {
    for (const k of Object.keys(BROWSER_AD_DEFAULTS)) expect(HINTS[k]?.trim()).toBeTruthy();
  });

  it("hints stay user-agnostic", () => {
    const all = [...Object.values(STEAM_HINTS), ...Object.values(HINTS)].join(" ");
    expect(all).not.toMatch(/notion|p&l|studio|routine|jester/i);
  });
});
