import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/api/app.ts";
import { freshMemoryDb } from "../src/db/db.ts";
import { seed } from "../src/db/seed.ts";

let server: Server;
let base: string;

beforeAll(async () => {
  const db = await freshMemoryDb();
  await seed(db);
  const app = createApp(db);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://localhost:${port}`;
}, 60000);

afterAll(() => {
  server?.close();
});

describe("A13 API routes", () => {
  it("GET /api/overview?platform=poki -> 200 + KPI", async () => {
    const r = await fetch(`${base}/api/overview?platform=poki`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.kpi.gamesTracked).toBeGreaterThan(0);
    expect(j.momentum.series.length).toBeGreaterThan(0);
    expect(j.platform).toBe("poki");
  });

  it("GET /api/brief/editions -> 200 + list", async () => {
    const r = await fetch(`${base}/api/brief/editions`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/brief/edition/:date -> 200 + payload", async () => {
    const r = await fetch(`${base}/api/brief/edition/2026-06-26`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j.payload.top_signals)).toBe(true);
  });

  it("GET /api/library -> 200 + array", async () => {
    const r = await fetch(`${base}/api/library`);
    expect(r.status).toBe(200);
    expect(Array.isArray(await r.json())).toBe(true);
  });

  it("GET /api/library exposes prototype card image_url", async () => {
    const rows = await (await fetch(`${base}/api/library`)).json();
    const proto = rows.find((it: any) => it.kind === "prototype");
    expect(proto).toBeTruthy();
    // seed wires each prototype to a hosted card image — proves the column + query path
    expect(typeof proto.imageUrl).toBe("string");
    expect(proto.imageUrl).toContain("kairos-pitch-art");
  });
});

describe("brief publish (token-gated)", () => {
  it("rejects POST without a valid token", async () => {
    const r = await fetch(`${base}/api/brief/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editionDate: "2026-07-01", payload: { top_signals: ["x"] } }),
    });
    expect(r.status).toBe(401);
  });

  it("brief steering: empty → 401 without token → upsert with token → reflected", async () => {
    const empty = await (await fetch(`${base}/api/brief/steering`)).json();
    expect(empty.flags).toEqual([]);
    const bad = await fetch(`${base}/api/brief/steering`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ flags: ["x"] }),
    });
    expect(bad.status).toBe(401);
    process.env.PUBLISH_TOKEN = "test-token-123";
    const ok = await fetch(`${base}/api/brief/steering`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-token-123" },
      body: JSON.stringify({ flags: ["browser-first", "extraction-lite"] }),
    });
    expect(ok.status).toBe(200);
    const got = await (await fetch(`${base}/api/brief/steering`)).json();
    expect(got.flags).toEqual(["browser-first", "extraction-lite"]);
    expect(got.updatedAt).toBeTruthy();
  });

  it("publishes with token and the edition becomes fetchable", async () => {
    process.env.PUBLISH_TOKEN = "test-token-123";
    const r = await fetch(`${base}/api/brief/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-token-123" },
      body: JSON.stringify({
        editionDate: "2026-07-01",
        weekday: "mon",
        briefType: "indie",
        payload: { weekday: "Monday", top_signals: ["hello"], new_notable: [] },
      }),
    });
    expect(r.status).toBe(200);
    const ed = await (await fetch(`${base}/api/brief/edition/2026-07-01`)).json();
    expect(ed.payload.top_signals[0]).toBe("hello");
  });
});
