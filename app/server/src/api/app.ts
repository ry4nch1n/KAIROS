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
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/brief/publish", async (req, res) => {
    const token = process.env.PUBLISH_TOKEN;
    const auth = req.headers.authorization || "";
    if (!token || auth !== `Bearer ${token}`) return res.status(401).json({ error: "unauthorized" });
    try {
      await q.publishEdition(db, req.body);
      res.json({ ok: true, editionDate: req.body?.editionDate });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

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
  app.get("/api/genres", async (req, res) => res.json(await q.getGenres(db, parsePlatform(req.query.platform))));
  app.get("/api/developers", async (req, res) => res.json(await q.getDevelopers(db, parsePlatform(req.query.platform))));
  app.get("/api/new-releases", async (req, res) => res.json(await q.getNewReleases(db, parsePlatform(req.query.platform))));

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
