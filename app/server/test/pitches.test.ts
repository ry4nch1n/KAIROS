import { describe, it, expect } from "vitest";
import { freshMemoryDb } from "../src/db/db.ts";
import * as q from "../src/queries/index.ts";
import { createApp } from "../src/api/app.ts";
import type { PitchInput } from "shared";

const base: PitchInput = {
  slug: "salvage-line",
  title: "Salvage Line",
  pitchDate: "2026-07-06",
  rank: 1,
  loopFamily: "extraction-lite",
  status: "proposed",
  badge: "recommended",
  oneLiner: "Dig-and-defend meets route-planning.",
  browserFit: 2,
  steamFit: 3,
  buildEase: 2,
  provenance: "market-backed",
  batch: "2026-07-06",
  source: "kairos-review 2026-07-06",
};

describe("P1 pitches table + queries", () => {
  it("getPitches is empty on a fresh db", async () => {
    const db = await freshMemoryDb();
    expect(await q.getPitches(db)).toEqual([]);
  });

  it("publishPitch inserts and getPitches maps every field", async () => {
    const db = await freshMemoryDb();
    await q.publishPitch(db, base);
    const rows = await q.getPitches(db);
    expect(rows).toHaveLength(1);
    const p = rows[0];
    expect(p.slug).toBe("salvage-line");
    expect(p.title).toBe("Salvage Line");
    expect(p.loopFamily).toBe("extraction-lite");
    expect(p.platformLadder).toBe("browser->steam"); // defaulted
    expect(p.rank).toBe(1);
    expect(p.browserFit).toBe(2);
    expect(p.steamFit).toBe(3);
    expect(p.buildEase).toBe(2);
    expect(p.provenance).toBe("market-backed");
    expect(p.pitchDate).toBe("2026-07-06");
  });

  it("publishPitch round-trips the v2 visual-card fields", async () => {
    const db = await freshMemoryDb();
    await q.publishPitch(db, {
      ...base,
      setting: "derelict deep-space refinery",
      artStyle: "moody minimalist low-poly",
      codeName: "IRONVEIL",
      headerUrl: "https://kairos-pitch-art.netlify.app/salvage-line/header.png",
      shotUrl: "https://kairos-pitch-art.netlify.app/salvage-line/shot.png",
    });
    const p = (await q.getPitches(db))[0];
    expect(p.setting).toBe("derelict deep-space refinery");
    expect(p.artStyle).toBe("moody minimalist low-poly");
    expect(p.codeName).toBe("IRONVEIL");
    expect(p.headerUrl).toBe("https://kairos-pitch-art.netlify.app/salvage-line/header.png");
    expect(p.shotUrl).toBe("https://kairos-pitch-art.netlify.app/salvage-line/shot.png");
  });

  it("publishPitch upserts on slug (no duplicate rows)", async () => {
    const db = await freshMemoryDb();
    await q.publishPitch(db, base);
    await q.publishPitch(db, { ...base, status: "prototyping", oneLiner: "changed" });
    const rows = await q.getPitches(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("prototyping");
    expect(rows[0].oneLiner).toBe("changed");
  });

  it("orders by pitch_date desc then rank asc", async () => {
    const db = await freshMemoryDb();
    await q.publishPitch(db, { ...base, slug: "old", rank: 1, pitchDate: "2026-06-01" });
    await q.publishPitch(db, { ...base, slug: "new-2", rank: 2, pitchDate: "2026-07-06" });
    await q.publishPitch(db, { ...base, slug: "new-1", rank: 1, pitchDate: "2026-07-06" });
    const order = (await q.getPitches(db)).map((p) => p.slug);
    expect(order).toEqual(["new-1", "new-2", "old"]);
  });

  it("publishPitch rejects missing required fields", async () => {
    const db = await freshMemoryDb();
    // @ts-expect-error intentionally invalid
    await expect(q.publishPitch(db, { title: "x" })).rejects.toThrow();
  });

  it("deletePitch removes a row and reports whether it existed", async () => {
    const db = await freshMemoryDb();
    await q.publishPitch(db, base);
    expect(await q.deletePitch(db, "salvage-line")).toBe(true);
    expect(await q.getPitches(db)).toEqual([]);
    expect(await q.deletePitch(db, "salvage-line")).toBe(false); // already gone
  });
});

describe("P2 /api/pitches route", () => {
  it("GET serves pitches; POST is token-gated + accepts a batch array", async () => {
    process.env.PUBLISH_TOKEN = "test-token";
    const db = await freshMemoryDb();
    const app = createApp(db);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const url = `http://localhost:${port}/api/pitches`;
    try {
      // no token → 401
      const noAuth = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(base) });
      expect(noAuth.status).toBe(401);

      // valid token, array of two → 200
      const ok = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify([base, { ...base, slug: "checkpoint", rank: 2, title: "Checkpoint" }]),
      });
      expect(ok.status).toBe(200);
      expect((await ok.json()).count).toBe(2);

      const list = await (await fetch(url)).json();
      expect(list).toHaveLength(2);
      expect(list[0].slug).toBe("salvage-line"); // rank 1 first
    } finally {
      server.close();
    }
  });
});

describe("P3 DELETE /api/pitches/:slug", () => {
  it("is token-gated, deletes an existing pitch, 404s a missing one", async () => {
    process.env.PUBLISH_TOKEN = "test-token";
    const db = await freshMemoryDb();
    await q.publishPitch(db, base);
    const app = createApp(db);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const u = (slug: string) => `http://localhost:${port}/api/pitches/${slug}`;
    try {
      // no token → 401
      expect((await fetch(u("salvage-line"), { method: "DELETE" })).status).toBe(401);
      // valid token → 200, row gone
      const ok = await fetch(u("salvage-line"), { method: "DELETE", headers: { authorization: "Bearer test-token" } });
      expect(ok.status).toBe(200);
      expect((await q.getPitches(db)).length).toBe(0);
      // missing slug → 404
      const gone = await fetch(u("salvage-line"), { method: "DELETE", headers: { authorization: "Bearer test-token" } });
      expect(gone.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
