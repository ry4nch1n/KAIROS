// Netlify Function — serves /api/* in prod using the SAME query module as the
// local Express dev server (single source of truth). Reads Neon via DATABASE_URL.
import { appDb } from "../../server/src/db/db.ts";
import * as q from "../../server/src/queries/index.ts";
import type { Platform } from "shared";

const PLATFORMS = ["all", "poki", "crazygames"];
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
    const db = await appDb();
    if (path === "/overview") return json(await q.getOverview(db, platform));
    if (path === "/hidden-gems") return json(await q.getHiddenGems(db, platform));
    if (path === "/brief/editions") return json(await q.getBriefEditions(db));
    const m = path.match(/^\/brief\/edition\/(.+)$/);
    if (m) {
      const ed = await q.getBriefEdition(db, decodeURIComponent(m[1]));
      return ed ? json(ed) : json({ error: "not found" }, 404);
    }
    if (path === "/library")
      return json(await db.query("SELECT id, kind, title, summary, tags, status FROM library_items ORDER BY created_at DESC"));
    return json({ error: "not found", path }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

export const config = { path: "/api/*" };
