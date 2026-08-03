import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICE, parseServiceHash, serviceHash, writeServiceHash } from "./hashRoute.ts";
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
    writeServiceHash("library", loc);
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
    writeServiceHash("brief", loc);
    expect(writes).toBe(0);
    writeServiceHash("revenue", loc);
    expect(writes).toBe(1);
  });

  it("is a no-op without a location (non-browser render)", () => {
    expect(() => writeServiceHash("radar", undefined)).not.toThrow();
  });
});
