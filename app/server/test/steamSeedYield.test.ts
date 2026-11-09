import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedAppIds } from "../src/crawler/steam.ts";

// The body SteamSpy returned for both casings when measured on 2026-11-09 (#294).
const SPY_EMPTY = "{}";
// No populated response could be captured while the tag is dark; this is the documented shape.
const SPY_POPULATED = JSON.stringify({
  "901": { appid: 901, name: "Lesser", owners: "20,000 .. 50,000" },
  "902": { appid: 902, name: "Bigger", owners: "2,000,000 .. 5,000,000" },
});
const search = (id: number) =>
  JSON.stringify({ results_html: `<a data-ds-appid="${id}"><span>Game</span></a>` });

function stubUpstreams(over: {
  indie?: string;
  recent?: string;
  upcoming?: string;
  fail?: RegExp;
}) {
  vi.stubGlobal("fetch", async (url: string) => {
    if (over.fail?.test(url)) return new Response("nope", { status: 503 });
    let body = "{}";
    if (url.includes("request=tag&tag=indie")) body = over.indie ?? SPY_POPULATED;
    else if (url.includes("filter=topsellers")) body = over.recent ?? search(801);
    else if (url.includes("filter=popularcomingsoon")) body = over.upcoming ?? search(802);
    return new Response(body, { status: 200 });
  });
}

describe("seed-yield annotations (#294)", () => {
  let out: ReturnType<typeof vi.spyOn>;
  const annotations = () =>
    out.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("::warning"));

  beforeEach(() => {
    out = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("annotates an empty-object indie tag and still returns the other seeds", async () => {
    stubUpstreams({ indie: SPY_EMPTY });
    const ids = await seedAppIds(500);
    expect(annotations()).toEqual([expect.stringContaining("Seed tag=indie yielded 0 appids")]);
    expect(annotations()[0]).toMatch(/^::warning title=Steam seed dark::/);
    expect(ids).toEqual(expect.arrayContaining([801, 802]));
  });

  it("is silent on a populated indie tag and seeds its appids", async () => {
    stubUpstreams({});
    const ids = await seedAppIds(500);
    expect(annotations()).toEqual([]);
    expect(ids).toEqual(expect.arrayContaining([901, 902]));
  });

  it("annotates the recent and upcoming seeds when empty", async () => {
    stubUpstreams({ recent: "{}", upcoming: "{}" });
    await seedAppIds(500);
    expect(annotations()).toHaveLength(2);
    expect(annotations().join()).toContain("search topsellers Indie");
    expect(annotations().join()).toContain("search popularcomingsoon Indie");
  });

  it("annotates a watched seed whose request fails, and does not throw", async () => {
    stubUpstreams({ fail: /request=tag&tag=indie/ });
    await expect(seedAppIds(500)).resolves.toEqual(expect.arrayContaining([801]));
    expect(annotations()).toEqual([expect.stringContaining("tag=indie")]);
  });

  it("leaves the unwatched demand seeds to console.warn", async () => {
    stubUpstreams({}); // the top100in2weeks and featuredcategories stubs are empty here
    await seedAppIds(500);
    expect(annotations()).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("top100in2weeks"));
  });
});
