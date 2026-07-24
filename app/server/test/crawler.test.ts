import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crazygames } from "../src/crawler/crazygames.ts";
import { poki } from "../src/crawler/poki.ts";
import { crawlRotation, loadGames } from "../src/crawler/load.ts";
import { mergeDiscovery, politeFetch, rotatingWindow } from "../src/crawler/base.ts";
import { freshMemoryDb } from "../src/db/db.ts";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/crazygames_game.html", import.meta.url)),
  "utf8",
);
const newListing = readFileSync(
  fileURLToPath(new URL("./fixtures/crazygames_new.html", import.meta.url)),
  "utf8",
);

describe("A10b politeFetch timeout (#31)", () => {
  it("aborts a hung request and surfaces a timeout error", async () => {
    const orig = globalThis.fetch;
    // A fetch that never resolves on its own — only settles when the abort signal fires.
    globalThis.fetch = ((_url: any, opts: any) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      })) as any;
    try {
      await expect(politeFetch("http://example.test/hang", 20)).rejects.toThrow(
        /timeout after 20ms/,
      );
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("returns the body on a fast response without tripping the timeout", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, text: async () => "hello" })) as any;
    try {
      expect(await politeFetch("http://example.test/ok", 500)).toBe("hello");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("still throws the HTTP status error for a non-ok response (timeout is additive)", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 503, text: async () => "" })) as any;
    try {
      await expect(politeFetch("http://example.test/down", 500)).rejects.toThrow(/-> 503/);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("A11 crazygames parse", () => {
  it("maps __NEXT_DATA__ game to RawGame", () => {
    const g = crazygames.parseGame(fixture, "https://www.crazygames.com/game/final-drop");
    expect(g.title).toBe("Final Drop");
    expect(g.sourceGameId).toBe("final-drop");
    expect(g.rating).toBeCloseTo(4.6, 2); // 9.2/2
    expect(g.votes).toBe(5099); // 4702 + 397
    expect(g.genre).toBe("Action");
    expect(g.tags).toEqual(["3D", "Battle"]);
    expect(g.engine).toBe("Unity 2022");
    expect(g.orientation).toBe("landscape");
    expect(g.mobile).toBe(true);
  });
});

// #99 — the sitemap prefix must not be the whole working set. A synthetic sitemap of 1000
// entries (the live shape: no <lastmod>, no recency order) that never mentions the
// "brand-new-arrival" title only the /en/new listing knows about. No network: fetch is stubbed.
const sitemapXml = (u: string[]) => `<urlset>${u.map((x) => `<loc>${x}</loc>`).join("")}</urlset>`;
const cgSitemapUrls = Array.from(
  { length: 1000 },
  (_, i) => `https://www.crazygames.com/game/catalog-${String(i).padStart(4, "0")}`,
);

function stubPortal(seed: string | Error, sitemap = sitemapXml(cgSitemapUrls)) {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    if (!String(url).includes("/new")) return { ok: true, text: async () => sitemap };
    if (seed instanceof Error) throw seed;
    return { ok: true, text: async () => seed };
  }) as any;
  return () => {
    globalThis.fetch = orig;
  };
}

describe("A13 crawler URL selection (#99)", () => {
  it("rotatingWindow sweeps a new slice each run and wraps past the end", () => {
    const items = Array.from({ length: 10 }, (_, i) => `u${i}`);
    expect(rotatingWindow(items, 3, 0)).toEqual(["u0", "u1", "u2"]);
    expect(rotatingWindow(items, 3, 1)).toEqual(["u3", "u4", "u5"]);
    expect(rotatingWindow(items, 3, 3)).toEqual(["u9", "u0", "u1"]); // wraps
    expect(rotatingWindow(items, 25, 4)).toEqual(items); // limit >= catalog
    expect(rotatingWindow([], 5, 2)).toEqual([]);
  });

  it("mergeDiscovery puts the seed first, dedupes, and never exceeds the limit", () => {
    expect(mergeDiscovery(["a", "a", "b"], ["b", "c", "d", "e"], 4)).toEqual(["a", "b", "c", "d"]);
    // the seed can never starve the sweep that guarantees eventual coverage
    const starved = mergeDiscovery(["s1", "s2", "s3", "s4"], ["w1", "w2"], 4);
    expect(starved).toEqual(["s1", "s2", "w1", "w2"]);
  });

  it("a new game absent from the sitemap prefix still enters the crawl set", async () => {
    const restore = stubPortal(newListing);
    try {
      const urls = await crazygames.listGameUrls(20, { rotation: 0 });
      // the seeded title exists nowhere in the sitemap, let alone its first 20 entries
      expect(cgSitemapUrls).not.toContain("https://www.crazygames.com/game/brand-new-arrival");
      expect(urls).toContain("https://www.crazygames.com/game/brand-new-arrival");
      expect(urls).toContain("https://www.crazygames.com/game/third-newcomer");
      expect(urls).toContain("https://www.crazygames.com/game/fourth-from-json"); // SSR JSON path
      expect(urls.length).toBe(20); // selection change, not a volume change
      expect(new Set(urls).size).toBe(urls.length); // deduped
      expect(urls.some((u) => u.endsWith("/t/action") || u.endsWith("/c/puzzle"))).toBe(false);
    } finally {
      restore();
    }
  });

  it("successive rotations reach deep sitemap entries the old prefix never touched", async () => {
    const restore = stubPortal(newListing);
    try {
      const run0 = await crazygames.listGameUrls(20, { rotation: 0 });
      const run9 = await crazygames.listGameUrls(20, { rotation: 9 });
      const deep = "https://www.crazygames.com/game/catalog-0185";
      expect(run0).not.toContain(deep);
      expect(run9).toContain(deep);
    } finally {
      restore();
    }
  });

  // A broken/JS-rendered listing page must never break or empty a crawl.
  it.each([
    ["the seed fetch throws", new Error("fetch /en/new -> 404") as string | Error],
    ["the seed parses to zero urls", "<html><body>no games here</body></html>"],
  ])("degrades cleanly to the rotating sitemap window when %s", async (_label, seed) => {
    const restore = stubPortal(seed);
    try {
      const urls = await crazygames.listGameUrls(20, { rotation: 2 });
      expect(urls.length).toBe(20);
      expect(urls[0]).toBe("https://www.crazygames.com/game/catalog-0040");
    } finally {
      restore();
    }
  });

  it("poki gets the same treatment (seed ahead of a rotating window)", async () => {
    const pokiUrls = Array.from({ length: 100 }, (_, i) => `https://poki.com/en/g/cat-${i}`);
    const restore = stubPortal(
      `<a href="/en/g/fresh-poki-title">Fresh</a><a href="/en/g/second-fresh">Second</a>`,
      sitemapXml(pokiUrls),
    );
    try {
      const urls = await poki.listGameUrls(10, { rotation: 3 });
      expect(urls[0]).toBe("https://poki.com/en/g/fresh-poki-title");
      expect(urls).toContain("https://poki.com/en/g/cat-30"); // rotated window, not the prefix
      expect(urls.length).toBe(10);
    } finally {
      restore();
    }
  });

  it("crawlRotation counts this source's prior crawls and tolerates an empty db", async () => {
    const db = await freshMemoryDb();
    expect(await crawlRotation(db, "crazygames")).toBe(0);
    const g = crazygames.parseGame(fixture, "https://www.crazygames.com/game/final-drop");
    for (const date of ["2026-06-26T00:00:00.000Z", "2026-06-27T00:00:00.000Z"]) {
      await loadGames(db, "crazygames", "https://www.crazygames.com", [g], date);
    }
    expect(await crawlRotation(db, "crazygames")).toBe(2);
    expect(await crawlRotation(db, "poki")).toBe(0); // per-source, not global
  });
});

describe("A12 append-only load idempotency", () => {
  it("re-running the same crawl day inserts no duplicate snapshots", async () => {
    const db = await freshMemoryDb();
    const g = crazygames.parseGame(fixture, "https://www.crazygames.com/game/final-drop");
    const date = "2026-06-26T00:00:00.000Z";
    const r1 = await loadGames(db, "crazygames", "https://www.crazygames.com", [g], date);
    const c1 = await db.query("SELECT count(*)::int n FROM game_snapshots");
    const r2 = await loadGames(db, "crazygames", "https://www.crazygames.com", [g], date);
    const c2 = await db.query("SELECT count(*)::int n FROM game_snapshots");
    expect(r1.inserted).toBe(1);
    expect(r2.inserted).toBe(0);
    expect(Number(c1[0].n)).toBe(1);
    expect(Number(c2[0].n)).toBe(1);
  });
});
