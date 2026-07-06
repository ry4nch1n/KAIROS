import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/api/app.ts";
import type { Querier } from "../src/db/db.ts";

// Route-parity guard. The API surface is defined TWICE — the Express app factory
// (src/api/app.ts, local dev) and the Netlify Function (netlify/functions/api.ts, prod) —
// and both must stay in lockstep or an endpoint works in dev and 404s in prod (or vice
// versa). This test freezes today's surface and fails on NEW drift, so a route added to
// one entry point but not the other cannot merge green. It replaces the prose "remember to
// edit both files" warning with an executable check. If you intentionally diverge, add the
// route to KNOWN_PROD_ONLY below with a comment — that keeps the divergence visible and reviewed.

// Routes that exist in the prod Function but deliberately NOT in the Express dev server.
// Each entry needs a reason. (Destructive admin ops the operator only runs against prod.)
const KNOWN_PROD_ONLY = new Set<string>([
  "DELETE /brief/edition/:p", // prod-only: delete a bad brief edition; dev just re-seeds
]);

// Canonicalize any route to `METHOD /seg/seg/:p`: drop the /api prefix, collapse every
// dynamic segment (:param / regex group / startsWith remainder) to `:p`, uppercase method.
const collapse = (path: string): string =>
  path
    .replace(/^\/api/, "")
    .split("/")
    .map((seg) => (seg.startsWith(":") || seg === "" ? seg : seg))
    .join("/");

/** Structural read of the live Express app — authoritative, no DB access needed. */
function expressRoutes(): Set<string> {
  const stub: Querier = { query: async () => [], exec: async () => {} };
  const app = createApp(stub) as any;
  const stack = (app._router ?? app.router)?.stack ?? [];
  const out = new Set<string>();
  for (const layer of stack) {
    if (!layer.route) continue; // skip middleware (cors, json, …)
    const path = collapse(String(layer.route.path).replace(/:[A-Za-z0-9_]+/g, ":p"));
    for (const m of Object.keys(layer.route.methods)) {
      if (layer.route.methods[m]) out.add(`${m.toUpperCase()} ${path}`);
    }
  }
  return out;
}

/** Static scan of the Netlify Function source for its route surface. */
function functionRoutes(): Set<string> {
  const src = readFileSync(
    fileURLToPath(new URL("../../netlify/functions/api.ts", import.meta.url)),
    "utf8"
  );
  const out = new Set<string>();
  const methodOf = (line: string): string => {
    const m = line.match(/req\.method === "(GET|POST|PUT|PATCH|DELETE)"/);
    return m ? m[1] : "GET"; // no explicit method check on the line ⇒ GET
  };
  for (const line of src.split("\n")) {
    // path === "/x"
    for (const m of line.matchAll(/path === "([^"]+)"/g))
      out.add(`${methodOf(line)} ${collapse(m[1])}`);
    // path.startsWith("/x/") ⇒ dynamic remainder
    for (const m of line.matchAll(/path\.startsWith\("([^"]+)"\)/g))
      out.add(`${methodOf(line)} ${collapse(m[1].replace(/\/$/, "") + "/:p")}`);
    // path.match(/^\/x\/(.+)$/) ⇒ collapse the group to :p
    for (const m of line.matchAll(/path\.match\(\/([^/]+(?:\/[^/]+)*)\//g)) {
      const norm = "/" + m[1].replace(/\^|\$/g, "").replace(/\\\//g, "/").replace(/^\/+/, "").replace(/\([^)]*\)/g, ":p");
      out.add(`GET ${collapse(norm)}`);
    }
  }
  return out;
}

describe("API route parity (Express dev ↔ Netlify Function prod)", () => {
  const dev = expressRoutes();
  const prod = functionRoutes();

  it("sanity: both surfaces were extracted non-empty", () => {
    expect(dev.size).toBeGreaterThan(5);
    expect(prod.size).toBeGreaterThan(5);
  });

  it("every dev route is served in prod", () => {
    const missing = [...dev].filter((r) => !prod.has(r));
    expect(missing, `routes in Express but not the Netlify Function: ${missing.join(", ")}`).toEqual([]);
  });

  it("prod exposes no route absent from dev (except documented prod-only)", () => {
    const extra = [...prod].filter((r) => !dev.has(r) && !KNOWN_PROD_ONLY.has(r));
    expect(extra, `routes in the Netlify Function but not Express — add to KNOWN_PROD_ONLY if intentional: ${extra.join(", ")}`).toEqual([]);
  });

  it("KNOWN_PROD_ONLY entries still exist (allowlist can't rot)", () => {
    const stale = [...KNOWN_PROD_ONLY].filter((r) => !prod.has(r));
    expect(stale, `KNOWN_PROD_ONLY lists routes the Function no longer has: ${stale.join(", ")}`).toEqual([]);
  });
});
