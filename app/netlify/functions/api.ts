// Netlify Function — serves /api/* in prod using the SAME query module as the
// local Express dev server (single source of truth). Reads Neon via DATABASE_URL.
import { appDb } from "../../server/src/db/db.ts";
import * as q from "../../server/src/queries/index.ts";
import type { Platform } from "shared";
import { CONTRACT } from "../../shared/src/contract.ts";
import { isAuthorized, UNAUTHORIZED_STATUS, unauthorizedBody } from "../../server/src/api/auth.ts";

const PLATFORMS = ["all", "poki", "crazygames", "steam"];
const pp = (v: string | null): Platform => (v && PLATFORMS.includes(v) ? v : "all") as Platform;
// ── cache policy ──────────────────────────────────────────────────────────────
// TWO headers, deliberately:
//   Cache-Control             → the BROWSER (short; a reload should get fresh data)
//   Netlify-CDN-Cache-Control → Netlify's edge (long; THIS is what stops Neon being woken)
//
// Why: the previous blanket `public, max-age=300` was browser-only, so it never populated the
// CDN. Every request after 5 min missed all caches AND landed on a Neon instance that had just
// scaled to zero (~5 min idle) — measured 2026-07-22 on prod: 6350 ms TTFB cold vs ~200 ms warm,
// i.e. cold start was ~95% of load time. An edge cache serves the response WITHOUT invoking the
// function or waking Neon, and `stale-while-revalidate` returns an expired entry immediately
// while refreshing in the background, so the cold path stops being user-visible.
//
// SAFETY — why caching behind the Basic-auth gate is sound: the gate
// (netlify/edge-functions/auth.ts) is MIDDLEWARE and does not opt into caching (`cache: "manual"`
// is absent), so Netlify invokes it on every single request and it rejects unauthenticated ones
// before any cached response is served. ⚠️ Do NOT add a `cache` property to that edge function's
// config — that would let a cached response bypass the gate entirely.
//
// Netlify voids s-maxage/max-age on every new deploy, so the daily deploy already acts as a
// cache purge aligned with the daily crawl — no manual invalidation needed.
//
// `durable` is load-bearing, not decoration: without it an edge-cache MISS on any node still
// invokes the function (and wakes Neon). The durable cache is shared across edge nodes, so a
// miss is served from it instead of paying another cold start — which is the exact failure
// mode measured here.
type CachePolicy = "daily" | "short" | "static" | "none";
const CACHE: Record<CachePolicy, Record<string, string>> = {
  // Crawl-derived analytics: the crawl runs once daily, so an hour at the edge is honest.
  daily: {
    "cache-control": "public, max-age=60",
    "netlify-cdn-cache-control": "public, durable, s-maxage=3600, stale-while-revalidate=86400",
  },
  // Routine-written reads (pitches/library/brief): a publish should appear within ~a minute.
  // A POST does not purge the GET cache, so keep the edge TTL short here.
  short: {
    "cache-control": "public, max-age=30",
    "netlify-cdn-cache-control": "public, durable, s-maxage=60, stale-while-revalidate=600",
  },
  // Taxonomy/versions: changes only WITH a deploy, and a deploy voids the cache.
  static: {
    "cache-control": "public, max-age=300",
    "netlify-cdn-cache-control": "public, durable, s-maxage=86400, stale-while-revalidate=604800",
  },
  // Mutations, auth failures, 404s, errors. The old blanket max-age=300 cached these too —
  // a cached 401 or error response is never what we want.
  none: { "cache-control": "no-store" },
};
// Default is "none": an endpoint added later is uncached until someone opts it in deliberately.
const json = (body: unknown, status = 200, policy: CachePolicy = "none") =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CACHE[policy] },
  });

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "");
  const platform = pp(url.searchParams.get("platform"));
  try {
    if (path === "/health") return json({ ok: true });
    if (path === "/contract") return json(CONTRACT, 200, "static");
    const db = await appDb();
    if (req.method === "POST" && path === "/brief/publish") {
      if (!isAuthorized(req.headers)) return json(unauthorizedBody(), UNAUTHORIZED_STATUS);
      const body = await req.json();
      await q.publishEdition(db, body);
      return json({ ok: true, editionDate: body.editionDate });
    }
    // Deletion is via the explicit DELETE route below (prod-only; see app.ts note).
    if (req.method === "DELETE" && path.startsWith("/brief/edition/")) {
      if (!isAuthorized(req.headers)) return json(unauthorizedBody(), UNAUTHORIZED_STATUS);
      const date = decodeURIComponent(path.replace("/brief/edition/", ""));
      await db.query("DELETE FROM brief_editions WHERE edition_date = $1", [date]);
      return json({ ok: true, deleted: date });
    }
    if (path === "/overview") return json(await q.getOverview(db, platform), 200, "daily");
    if (path === "/steam") return json(await q.getSteamOverview(db), 200, "daily");
    if (path === "/hidden-gems") return json(await q.getHiddenGems(db, platform), 200, "daily");
    if (path === "/genres") return json(await q.getGenres(db, platform), 200, "daily");
    if (path === "/developers") return json(await q.getDevelopers(db, platform), 200, "daily");
    if (path === "/new-releases") return json(await q.getNewReleases(db, platform), 200, "daily");
    if (req.method === "POST" && path === "/brief/steering") {
      if (!isAuthorized(req.headers)) return json(unauthorizedBody(), UNAUTHORIZED_STATUS);
      const body = await req.json();
      await q.setBriefSteering(db, Array.isArray(body?.flags) ? body.flags : []);
      return json({ ok: true });
    }
    if (path === "/brief/steering") return json(await q.getBriefSteering(db), 200, "short");
    if (path === "/brief/editions") return json(await q.getBriefEditions(db), 200, "short");
    const m = path.match(/^\/brief\/edition\/(.+)$/);
    if (m) {
      const ed = await q.getBriefEdition(db, decodeURIComponent(m[1]));
      return ed ? json(ed, 200, "short") : json({ error: "not found" }, 404);
    }
    if (req.method === "POST" && path === "/library") {
      if (!isAuthorized(req.headers)) return json(unauthorizedBody(), UNAUTHORIZED_STATUS);
      const body = await req.json();
      const items = Array.isArray(body) ? body : [body];
      for (const it of items) await q.publishLibraryItem(db, it);
      return json({ ok: true, count: items.length });
    }
    if (path === "/library") return json(await q.libraryItems(db), 200, "short");
    if (req.method === "POST" && path === "/pitches") {
      if (!isAuthorized(req.headers)) return json(unauthorizedBody(), UNAUTHORIZED_STATUS);
      const body = await req.json();
      const items = Array.isArray(body) ? body : [body];
      for (const it of items) await q.publishPitch(db, it);
      return json({ ok: true, count: items.length });
    }
    if (req.method === "DELETE" && path.startsWith("/pitches/")) {
      if (!isAuthorized(req.headers)) return json(unauthorizedBody(), UNAUTHORIZED_STATUS);
      const slug = decodeURIComponent(path.replace("/pitches/", ""));
      const deleted = await q.deletePitch(db, slug);
      return deleted ? json({ ok: true, deleted: slug }) : json({ error: "not found" }, 404);
    }
    if (path === "/pitches") return json(await q.getPitches(db), 200, "short");
    return json({ error: "not found", path }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

export const config = { path: "/api/*" };
