import { describe, it, expect } from "vitest";
import type { Platform } from "shared";
import { DEFAULT_PLATFORM, PLATFORM_GROUPS } from "./Radar.tsx";

// Radar's platform selector is a product decision, not an implementation detail:
// Steam is the primary market the Radar is read for, so it opens on Steam and is
// the first option offered (#135). Pin both here — the default and the ordering
// are easy to flip back by accident when the groups are edited.

const flat = PLATFORM_GROUPS.flatMap((g) => g.items);
const ids = flat.map((p) => p.id);
const labelOf = (id: Platform) => flat.find((p) => p.id === id)?.label;

describe("Radar platform selector", () => {
  it("opens on Steam", () => {
    expect(DEFAULT_PLATFORM).toBe("steam");
  });

  it("renders the PC group before the Browser group", () => {
    expect(PLATFORM_GROUPS.map((g) => g.group)).toEqual(["PC", "Browser"]);
  });

  it("makes Steam the first selectable option overall", () => {
    expect(ids[0]).toBe("steam");
  });

  it("keeps the default reachable from the selector", () => {
    expect(ids).toContain(DEFAULT_PLATFORM);
  });

  it("lists CrazyGames before Poki", () => {
    expect(ids.indexOf("crazygames")).toBeLessThan(ids.indexOf("poki"));
  });

  it("offers every platform exactly once, each with a label", () => {
    const expected: Platform[] = ["steam", "all", "crazygames", "poki"];
    expect([...ids].sort()).toEqual([...expected].sort());
    for (const id of expected) expect(labelOf(id)).toBeTruthy();
  });
});
