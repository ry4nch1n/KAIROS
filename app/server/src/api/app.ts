// Express app factory. Same handlers reused by the dev server and (later) Netlify Functions.
import express from "express";
import cors from "cors";
import type { Querier } from "../db/db.ts";
import type { Platform } from "shared";
import { CONTRACT } from "../../../shared/src/contract.ts";
import * as q from "../queries/index.ts";
import { isAuthorized, UNAUTHORIZED_STATUS, unauthorizedBody } from "./auth.ts";

const PLATFORMS = ["all", "poki", "crazygames", "steam"];
function parsePlatform(v: unknown): Platform {
  return (typeof v === "string" && PLATFORMS.includes(v) ? v : "all") as Platform;
}

export function createApp(db: Querier) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/contract", (_req, res) => res.json(CONTRACT));

  // NOTE: this dev server has no edition-deletion route. Prod (netlify/functions/api.ts)
  // exposes `DELETE /api/brief/edition/:date` for live-data cleanup of a bad edition — a
  // deliberate prod-only divergence (dev just re-seeds), pinned in routeParity.test.ts's
  // KNOWN_PROD_ONLY allowlist. Publish itself is identical on both sides.
  app.post("/api/brief/publish", async (req, res) => {
    if (!isAuthorized(req.headers)) return res.status(UNAUTHORIZED_STATUS).json(unauthorizedBody());
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
  app.get("/api/steam", async (_req, res) => {
    try {
      res.json(await q.getSteamOverview(db));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get("/api/genres", async (req, res) =>
    res.json(await q.getGenres(db, parsePlatform(req.query.platform))),
  );
  app.get("/api/developers", async (req, res) =>
    res.json(await q.getDevelopers(db, parsePlatform(req.query.platform))),
  );
  app.get("/api/new-releases", async (req, res) =>
    res.json(await q.getNewReleases(db, parsePlatform(req.query.platform))),
  );

  app.get("/api/brief/editions", async (_req, res) => {
    res.json(await q.getBriefEditions(db));
  });

  app.get("/api/brief/steering", async (_req, res) => res.json(await q.getBriefSteering(db)));
  app.post("/api/brief/steering", async (req, res) => {
    if (!isAuthorized(req.headers)) return res.status(UNAUTHORIZED_STATUS).json(unauthorizedBody());
    try {
      await q.setBriefSteering(db, Array.isArray(req.body?.flags) ? req.body.flags : []);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get("/api/brief/edition/:date", async (req, res) => {
    const ed = await q.getBriefEdition(db, req.params.date);
    if (!ed) return res.status(404).json({ error: "not found" });
    res.json(ed);
  });

  app.get("/api/library", async (_req, res) => {
    res.json(await q.libraryItems(db));
  });
  app.post("/api/library", async (req, res) => {
    if (!isAuthorized(req.headers)) return res.status(UNAUTHORIZED_STATUS).json(unauthorizedBody());
    try {
      const items = Array.isArray(req.body) ? req.body : [req.body];
      for (const it of items) await q.publishLibraryItem(db, it);
      res.json({ ok: true, count: items.length });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  app.get("/api/pitches", async (_req, res) => {
    try {
      res.json(await q.getPitches(db));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
  app.post("/api/pitches", async (req, res) => {
    if (!isAuthorized(req.headers)) return res.status(UNAUTHORIZED_STATUS).json(unauthorizedBody());
    try {
      const items = Array.isArray(req.body) ? req.body : [req.body];
      for (const it of items) await q.publishPitch(db, it);
      res.json({ ok: true, count: items.length });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });
  app.delete("/api/pitches/:slug", async (req, res) => {
    if (!isAuthorized(req.headers)) return res.status(UNAUTHORIZED_STATUS).json(unauthorizedBody());
    try {
      const deleted = await q.deletePitch(db, req.params.slug);
      if (!deleted) return res.status(404).json({ error: "not found" });
      res.json({ ok: true, deleted: req.params.slug });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });

  return app;
}
