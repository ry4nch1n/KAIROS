import { describe, expect, it } from "vitest";
import { addActivated, INITIAL_ACTIVATED } from "./activated.ts";

describe("addActivated — the shell's activate-once tab tracking", () => {
  it("radar is activated from the start (default tab)", () => {
    const start = new Set(INITIAL_ACTIVATED);
    expect(start.has("radar")).toBe(true);
    expect(start.size).toBe(1);
  });

  it("activating a tab adds it to the set", () => {
    const next = addActivated(new Set(INITIAL_ACTIVATED), "brief");
    expect(next.has("brief")).toBe(true);
    expect(next.has("radar")).toBe(true);
  });

  it("a tab stays activated after switching away (no unmount on switch)", () => {
    // Open brief, switch to library, switch back to radar — brief must remain.
    let s = new Set(INITIAL_ACTIVATED);
    s = addActivated(s, "brief");
    s = addActivated(s, "library");
    // returning to radar changes nothing but must not drop earlier activations
    s = addActivated(s, "radar");
    expect(s.has("brief")).toBe(true);
    expect(s.has("library")).toBe(true);
  });

  it("re-activating an already-active tab returns the same reference (render bail-out)", () => {
    const s = addActivated(new Set(INITIAL_ACTIVATED), "brief");
    expect(addActivated(s, "brief")).toBe(s);
    expect(addActivated(s, "radar")).toBe(s);
  });
});
