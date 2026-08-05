import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE,
  parseServiceHash,
  parseSectionHash,
  serviceHash,
  writeServiceHash,
} from "./hashRoute.ts";
import type { Service } from "../components/Rail.tsx";

const ALL: Service[] = ["radar", "brief", "library", "revenue"];

describe("parseServiceHash — URL fragment → fronted panel", () => {
  it("round-trips every service through its own hash", () => {
    for (const svc of ALL) expect(parseServiceHash(serviceHash(svc))).toBe(svc);
  });

  it("gives each service a distinct slug", () => {
    expect(new Set(ALL.map(serviceHash)).size).toBe(ALL.length);
  });

  // The boot-compatibility guarantee: a fresh visit to `/` must land on Radar
  // exactly as it did before URL state existed.
  it("falls back to the default panel for an empty, absent or junk fragment", () => {
    for (const hash of ["", "#", "##", undefined, null, "#nope", "#/radar/deep", "#42"]) {
      expect(parseServiceHash(hash)).toBe(DEFAULT_SERVICE);
    }
    expect(DEFAULT_SERVICE).toBe("radar");
  });

  it("tolerates casing, stray whitespace and percent-encoding", () => {
    expect(parseServiceHash("#REVENUE")).toBe("revenue");
    expect(parseServiceHash("#  library  ")).toBe("library");
    expect(parseServiceHash("#%62rief")).toBe("brief");
  });
});

describe("writeServiceHash — panel switch → URL fragment", () => {
  it("points the URL at the selected panel", () => {
    const loc = { hash: "" };
    writeServiceHash("library", null, loc);
    expect(loc.hash).toBe("#library");
    expect(parseServiceHash(loc.hash)).toBe("library");
  });

  it("skips a redundant write (no duplicate history entries)", () => {
    let writes = 0;
    const loc = {
      get hash() {
        return "#brief";
      },
      set hash(_v: string) {
        writes++;
      },
    };
    writeServiceHash("brief", null, loc);
    expect(writes).toBe(0);
    writeServiceHash("revenue", null, loc);
    expect(writes).toBe(1);
  });

  it("is a no-op without a location (non-browser render)", () => {
    expect(() => writeServiceHash("radar", null, undefined)).not.toThrow();
  });
});

describe("parseSectionHash — the section within a panel", () => {
  it("reads the section from a two-part fragment", () => {
    expect(parseSectionHash("#radar/comparables")).toBe("comparables");
    expect(parseSectionHash("#library/leaderboard")).toBe("leaderboard");
  });

  it("is null when the fragment names only a panel", () => {
    expect(parseSectionHash("#radar")).toBeNull();
    expect(parseSectionHash("#")).toBeNull();
    expect(parseSectionHash("")).toBeNull();
    expect(parseSectionHash(undefined)).toBeNull();
  });

  // A section slug is meaningless without a real panel in front of it — otherwise
  // "#nonsense/comparables" would push a section onto whatever panel defaulted in.
  it("is null when the panel segment is not a real service", () => {
    expect(parseSectionHash("#nope/comparables")).toBeNull();
    expect(parseSectionHash("#/radar/deep")).toBeNull();
  });

  it("tolerates casing, whitespace and percent-encoding like the service segment", () => {
    expect(parseSectionHash("#RADAR/Market%20Gaps")).toBe("market gaps");
    expect(parseSectionHash("#radar/  comparables  ")).toBe("comparables");
  });

  it("round-trips through serviceHash", () => {
    const h = serviceHash("radar", "comparables");
    expect(h).toBe("#radar/comparables");
    expect(parseServiceHash(h)).toBe("radar");
    expect(parseSectionHash(h)).toBe("comparables");
  });

  // The boot guarantee still holds: a deep fragment must not change which panel
  // a plain visit lands on, and must never throw.
  it("keeps the service resolution unchanged for deep fragments", () => {
    expect(parseServiceHash("#library/anything")).toBe("library");
    expect(parseServiceHash("#junk/anything")).toBe(DEFAULT_SERVICE);
  });
});
