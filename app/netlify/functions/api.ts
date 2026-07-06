// Netlify Function — serves /api/* in prod using the SAME query module as the
// local Express dev server (single source of truth). Reads Neon via DATABASE_URL.
import { appDb } from "../../server/src/db/db.ts";
import * as q from "../../server/src/queries/index.ts";
import type { Platform } from "shared";
import { CONTRACT } from "../../shared/src/contract.ts";

const PLATFORMS = ["all", "poki", "crazygames", "steam"];
const pp = (v: string | null): Platform => (v && PLATFORMS.includes(v) ? v : "all") as Platform;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "");
  const platform = pp(url.searchParams.get("platform"));
  try {
    if (path === "/health") return json({ ok: true });
    if (path === "/contract") return json(CONTRACT);
    const db = await appDb();
    if (req.method === "POST" && path === "/brief/publish") {
      const token = process.env.PUBLISH_TOKEN;
      const auth = req.headers.get("authorization") || "";
      if (!token || auth !== `Bearer ${token}`) return json({ error: "unauthorized" }, 401);
      const body = await req.json();
      if (body.delete && body.editionDate) {
        await db.query("DELETE FROM brief_editions WHERE edition_date = $1", [body.editionDate]);
        return json({ ok: true, deleted: body.editionDate });
      }
      await q.publishEdition(db, body);
      return json({ ok: true, editionDate: body.editionDate });
    }
    if (req.method === "DELETE" && path.startsWith("/brief/edition/")) {
      const token = process.env.PUBLISH_TOKEN;
      const auth = req.headers.get("authorization") || "";
      if (!token || auth !== `Bearer ${token}`) return json({ error: "unauthorized" }, 401);
      const date = decodeURIComponent(path.replace("/brief/edition/", ""));
      await db.query("DELETE FROM brief_editions WHERE edition_date = $1", [date]);
      return json({ ok: true, deleted: date });
    }
    if (path === "/overview") return json(await q.getOverview(db, platform));
    if (path === "/steam") return json(await q.getSteamOverview(db));
    if (path === "/hidden-gems") return json(await q.getHiddenGems(db, platform));
    if (path === "/genres") return json(await q.getGenres(db, platform));
    if (path === "/developers") return json(await q.getDevelopers(db, platform));
    if (path === "/new-releases") return json(await q.getNewReleases(db, platform));
    if (req.method === "POST" && path === "/brief/steering") {
      const token = process.env.PUBLISH_TOKEN;
      const auth = req.headers.get("authorization") || "";
      if (!token || auth !== `Bearer ${token}`) return json({ error: "unauthorized" }, 401);
      const body = await req.json();
      await q.setBriefSteering(db, Array.isArray(body?.flags) ? body.flags : []);
      return json({ ok: true });
    }
    if (path === "/brief/steering") return json(await q.getBriefSteering(db));
    if (path === "/brief/editions") return json(await q.getBriefEditions(db));
    const m = path.match(/^\/brief\/edition\/(.+)$/);
    if (m) {
      const ed = await q.getBriefEdition(db, decodeURIComponent(m[1]));
      return ed ? json(ed) : json({ error: "not found" }, 404);
    }
    if (path === "/library")
      return json(await db.query("SELECT id, kind, title, summary, tags, status FROM library_items ORDER BY created_at DESC"));
    if (req.method === "POST" && path === "/pitches") {
      const token = process.env.PUBLISH_TOKEN;
      const auth = req.headers.get("authorization") || "";
      if (!token || auth !== `Bearer ${token}`) return json({ error: "unauthorized" }, 401);
      const body = await req.json();
      const items = Array.isArray(body) ? body : [body];
      for (const it of items) await q.publishPitch(db, it);
      return json({ ok: true, count: items.length });
    }
    if (path === "/pitches") return json(await q.getPitches(db));
    return json({ error: "not found", path }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

export const config = { path: "/api/*" };
