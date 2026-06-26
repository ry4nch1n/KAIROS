// Express app factory. Same handlers reused by the dev server and (later) Netlify Functions.
import express from "express";
import cors from "cors";
import type { Querier } from "../db/db.ts";
import type { Platform } from "shared";
import * as q from "../queries/index.ts";

const PLATFORMS = ["all", "poki", "crazygames"];
function parsePlatform(v: unknown): Platform {
  return (typeof v === "string" && PLATFORMS.includes(v) ? v : "all") as Platform;
}

export function createApp(db: Querier) {
  const app = express();
  app.use(cors());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/overview", async (req, res) => {
    try {
      res.json(await q.getOverview(db, parsePlatform(req.query.platform)));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get("/api/hidden-gems", async (req, res) => {
    res.json(await q.getHiddenGems(db, parsePlatform(req.query.platform)));
  });

  app.get("/api/brief/editions", async (_req, res) => {
    res.json(await q.getBriefEditions(db));
  });

  app.get("/api/brief/edition/:date", async (req, res) => {
    const ed = await q.getBriefEdition(db, req.params.date);
    if (!ed) return res.status(404).json({ error: "not found" });
    res.json(ed);
  });

  app.get("/api/library", async (_req, res) => {
    const rows = await db.query(
      "SELECT id, kind, title, summary, tags, status FROM library_items ORDER BY created_at DESC"
    );
    res.json(rows);
  });

  return app;
}
