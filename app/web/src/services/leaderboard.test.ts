import { describe, it, expect } from "vitest";
import type { Pitch } from "shared";
import { rankPitches } from "./Library.tsx";

// Minimal pitch factory — only the fields rankPitches reads (status, the score axes,
// pitchDate) matter; the rest are nulled.
function p(over: Partial<Pitch> & { slug: string; status: string }): Pitch {
  return {
    slug: over.slug,
    rank: null,
    title: over.slug,
    oneLiner: null,
    loopFamily: null,
    platformLadder: "browser->steam",
    status: over.status,
    badge: null,
    loopDetail: null,
    browserMvp: null,
    steamLadder: null,
    evidence: null,
    risk: null,
    browserFit: over.browserFit ?? 2,
    steamFit: over.steamFit ?? 2,
    buildEase: over.buildEase ?? 2,
    provenance: null,
    grayBoxDays: null,
    contentScope: null,
    techRisk: null,
    hook: null,
    marketability: over.marketability ?? 2,
    founderFit: over.founderFit ?? 2,
    whyMe: null,
    pitchDate: over.pitchDate ?? "2026-07-01",
    batch: null,
    source: null,
    setting: null,
    artStyle: null,
    codeName: null,
    headerUrl: null,
    shotUrl: null,
  } as Pitch;
}

describe("rankPitches — evidence-state order", () => {
  it("ranks validated above prototyping above proposed", () => {
    const ranked = rankPitches([
      p({ slug: "prop", status: "proposed" }),
      p({ slug: "proto", status: "prototyping" }),
      p({ slug: "valid", status: "validated" }),
    ]);
    expect(ranked.map((x) => x.slug)).toEqual(["valid", "proto", "prop"]);
  });

  it("drops shelved pitches off the board entirely", () => {
    const ranked = rankPitches([
      p({ slug: "keep", status: "prototyping" }),
      p({ slug: "gone", status: "shelved" }),
    ]);
    expect(ranked.map((x) => x.slug)).toEqual(["keep"]);
  });

  it("mirrors the four-prototype verdict outcome: validated leads, shelved gone", () => {
    const ranked = rankPitches([
      p({ slug: "ferrywick", status: "shelved" }),
      p({ slug: "overflow", status: "shelved" }),
      p({ slug: "solar-forge", status: "prototyping" }),
      p({ slug: "hearthspeak", status: "validated" }),
    ]);
    expect(ranked.map((x) => x.slug)).toEqual(["hearthspeak", "solar-forge"]);
  });
});
