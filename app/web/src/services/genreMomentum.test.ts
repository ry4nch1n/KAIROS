// #204 S3 — genre momentum renders in each portal's own unit. Poki's cells must read exactly as they
// did before (signed whole votes/day); CrazyGames' read signed %/wk of recent engagement.
import { describe, expect, it } from "vitest";
import type { GenrePortalMomentum, RisingGenre } from "shared";
import { genreRateCls, genreRateText, risingDelta } from "./Radar.tsx";

const poki = (
  votesPerDay: number,
  over: Partial<GenrePortalMomentum> = {},
): GenrePortalMomentum => ({
  source: "poki",
  voteBasis: "cumulative",
  votesPerDay,
  engagementPctPerWeek: null,
  trajectory: "rising",
  captures: 4,
  ...over,
});
const cg = (pct: number | null): GenrePortalMomentum => ({
  source: "crazygames",
  voteBasis: "window",
  votesPerDay: null,
  engagementPctPerWeek: pct,
  trajectory: "plateau",
  captures: 4,
});

describe("genreRateText / genreRateCls", () => {
  it("running-total cells are unchanged: signed, grouped whole votes/day", () => {
    expect(genreRateText(poki(7081))).toBe("+7,081");
    expect(genreRateText(poki(-13))).toBe("-13");
    expect(genreRateText(poki(0))).toBe("0");
    expect(genreRateCls(poki(7081))).toBe("delta-up");
    expect(genreRateCls(poki(2))).toBe("delta-fl");
  });
  it("recent-window cells read signed %/wk with a true minus, never votes/day", () => {
    expect(genreRateText(cg(60.9))).toBe("+60.9%/wk");
    expect(genreRateText(cg(-37.8))).toBe("−37.8%/wk");
    expect(genreRateText(cg(null))).toBe("no data");
    expect(genreRateCls(cg(-37.8))).toBe("delta-dn");
    expect(genreRateCls(cg(4.9))).toBe("delta-fl"); // inside the weekly band
    expect(genreRateCls(cg(5))).toBe("delta-up");
  });
});

describe("risingDelta (Rising genre KPI)", () => {
  const rising = (m: GenrePortalMomentum): RisingGenre => ({ genre: "Word", ...m });
  it("Poki keeps its votes/day line", () => {
    expect(risingDelta(rising(poki(375)))).toEqual({ text: "▲ +375 votes/day", cls: "up" });
  });
  it("CrazyGames names engagement and follows the sign", () => {
    expect(risingDelta(rising(cg(60.9)))).toEqual({ text: "▲ +60.9%/wk engagement", cls: "up" });
    expect(risingDelta(rising(cg(-3.1)))).toEqual({ text: "▼ −3.1%/wk engagement", cls: "down" });
    expect(risingDelta(rising(cg(null))).cls).toBe("flat");
  });
});
