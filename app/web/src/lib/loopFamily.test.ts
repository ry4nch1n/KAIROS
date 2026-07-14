import { describe, it, expect } from "vitest";
import { loopFamilyCoverage } from "./loopFamily.ts";
import type { Pitch } from "shared";

const p = (over: Partial<Pitch>): Pitch =>
  ({
    id: over.id ?? 1,
    slug: over.slug ?? "s",
    title: over.title ?? "T",
    loopFamily: over.loopFamily ?? null,
    status: over.status ?? "proposed",
    rank: null,
    oneLiner: null,
    platformLadder: null,
    badge: null,
    loopDetail: null,
    browserMvp: null,
    steamLadder: null,
    evidence: null,
    risk: null,
    browserFit: null,
    steamFit: null,
    buildEase: null,
    provenance: null,
    grayBoxDays: null,
    contentScope: null,
    techRisk: null,
    hook: null,
    marketability: null,
    founderFit: null,
    whyMe: null,
    pitchDate: "2026-07-13",
    batch: null,
    source: null,
    setting: null,
    artStyle: null,
    codeName: null,
    headerUrl: null,
    shotUrl: null,
  }) as Pitch;

const FAMILIES = ["extraction-lite", "cozy-craft", "idle-tycoon"];

describe("loopFamilyCoverage — the supply half of demand-by-family (#71)", () => {
  it("zero-coverage families still appear as a row (that's the opportunity signal)", () => {
    const rows = loopFamilyCoverage([], FAMILIES);
    expect(rows.map((r) => r.family).sort()).toEqual([...FAMILIES].sort());
    expect(rows.every((r) => r.total === 0 && r.active === 0)).toBe(true);
  });

  it("counts total + active (non-shelved) and breaks down by status", () => {
    const rows = loopFamilyCoverage(
      [
        p({ slug: "a", title: "Undertow", loopFamily: "extraction-lite", status: "proposed" }),
        p({ slug: "b", title: "Deepwell", loopFamily: "extraction-lite", status: "prototyping" }),
        p({ slug: "c", title: "Dead", loopFamily: "extraction-lite", status: "shelved" }),
      ],
      FAMILIES,
    );
    const ex = rows.find((r) => r.family === "extraction-lite")!;
    expect(ex.total).toBe(3);
    expect(ex.active).toBe(2); // shelved excluded from live coverage
    expect(ex.byStatus).toEqual({ proposed: 1, prototyping: 1, shelved: 1 });
  });

  it("example titles are live-first, capped at 3", () => {
    const rows = loopFamilyCoverage(
      [
        p({ slug: "z", title: "Shelved One", loopFamily: "cozy-craft", status: "shelved" }),
        p({ slug: "y", title: "Live One", loopFamily: "cozy-craft", status: "proposed" }),
      ],
      FAMILIES,
    );
    const cc = rows.find((r) => r.family === "cozy-craft")!;
    expect(cc.titles[0]).toBe("Live One"); // non-shelved surfaces first
    expect(cc.titles).toContain("Shelved One");
    expect(cc.titles.length).toBeLessThanOrEqual(3);
  });

  it("sorts by live coverage desc, and keeps a family present on a pitch but outside the seed list", () => {
    const rows = loopFamilyCoverage(
      [
        p({ slug: "a", loopFamily: "idle-tycoon", status: "proposed" }),
        p({ slug: "b", loopFamily: "extraction-lite", status: "proposed" }),
        p({ slug: "c", loopFamily: "extraction-lite", status: "proposed" }),
        p({ slug: "d", loopFamily: "synergy-builder", status: "proposed" }), // not in FAMILIES
      ],
      FAMILIES,
    );
    expect(rows[0].family).toBe("extraction-lite"); // 2 active > the rest
    expect(rows.find((r) => r.family === "synergy-builder")?.total).toBe(1); // still counted
    // untagged/enum families all represented
    expect(rows.some((r) => r.family === "cozy-craft" && r.total === 0)).toBe(true);
  });

  it("ignores untagged pitches (no loopFamily)", () => {
    const rows = loopFamilyCoverage([p({ slug: "x", loopFamily: null })], FAMILIES);
    expect(rows.reduce((a, r) => a + r.total, 0)).toBe(0);
  });
});
