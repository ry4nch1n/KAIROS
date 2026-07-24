import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guards the prod API cache policy. Caching was added because a cold Neon start dominated load
// time (measured 2026-07-22: 6350 ms TTFB cold vs ~200 ms warm — ~95% of the wait). The risks
// that came with it are invisible at runtime, so they are pinned here.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const AUTH = "../../netlify/edge-functions/auth.ts";
const API = "../../netlify/functions/api.ts";

describe("prod API cache policy", () => {
  it("SAFETY: the Basic-auth edge function must never opt into response caching", () => {
    // Netlify serves a cached edge-function response *without invoking the function* ("bypasses
    // the edge function invocation altogether" — docs). The auth gate is pure middleware, which
    // is exactly why it is safe to cache the serverless responses behind it: the gate runs on
    // every request and rejects unauthenticated ones first. Adding `cache: "manual"` to its
    // config would let a cached response bypass the gate and silently open the whole site.
    const cfg = read(AUTH).split("export const config")[1] ?? "";
    expect(cfg, "auth.ts config must not contain a `cache` property").not.toMatch(/\bcache\s*:/);
  });

  it("never caches mutations, auth failures, or errors", () => {
    // The pre-2026-07-22 helper applied `public, max-age=300` to EVERY response, including POST
    // results and 401s. Those must be no-store.
    expect(read(API)).toMatch(/none:\s*\{\s*"cache-control":\s*"no-store"\s*\}/);
  });

  it("defaults to the uncached policy so a new endpoint is never cached by accident", () => {
    expect(read(API)).toMatch(/policy:\s*CachePolicy\s*=\s*"none"/);
  });

  it("caches crawl-derived reads at the CDN, which is what avoids waking Neon", () => {
    const src = read(API);
    // Browser-only `max-age` was the original bug — it never populated the edge cache.
    // `durable` is required, not optional: without it an edge-cache MISS still invokes the
    // function and wakes Neon, which is the cold start this whole change exists to avoid.
    expect(src).toMatch(/"netlify-cdn-cache-control":\s*"public,\s*durable,\s*s-maxage=\d+/);
    // stale-while-revalidate is the part that makes an expired entry return instantly.
    expect(src).toMatch(/stale-while-revalidate=\d+/);
    for (const p of ["/overview", "/steam", "/genres"]) {
      expect(src, `${p} should use the "daily" policy`).toMatch(
        new RegExp(`path === "${p}"[^\\n]*"daily"`),
      );
    }
  });
});
