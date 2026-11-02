// #286: three reads tolerate a not-yet-migrated table and read it as empty — but ONLY that.
// Any other DB failure (timeout, cold start, auth) must propagate to the handler's 500/no-store
// path instead of coming back as a healthy, cacheable empty 200.
import { describe, expect, it } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { isUndefinedTable } from "../src/queries/shared.ts";
import * as q from "../src/queries/index.ts";
import { createApp } from "../src/api/app.ts";

// Wrap a real db so any query touching `table` throws a non-42P01 error (XX000 = internal_error).
const failing = (db: Querier, table: string): Querier => ({
  exec: (sql) => db.exec(sql),
  query: async (text, params) => {
    if (text.includes(table)) {
      throw Object.assign(new Error(`connection terminated reading ${table}`), { code: "XX000" });
    }
    return db.query(text, params);
  },
});

describe("isUndefinedTable", () => {
  it("matches only SQLSTATE 42P01", () => {
    expect(isUndefinedTable({ code: "42P01" })).toBe(true);
    expect(isUndefinedTable({ code: "XX000" })).toBe(false);
    expect(isUndefinedTable(new Error("boom"))).toBe(false);
    expect(isUndefinedTable(null)).toBe(false);
    expect(isUndefinedTable(undefined)).toBe(false);
  });
});

describe("non-42P01 DB errors propagate (#286)", () => {
  it("getBriefSteering rethrows", async () => {
    const db = failing(await freshMemoryDb(), "brief_steering");
    await expect(q.getBriefSteering(db)).rejects.toThrow(/brief_steering/);
  });

  it("getPitches rethrows", async () => {
    const db = failing(await freshMemoryDb(), "pitches");
    await expect(q.getPitches(db)).rejects.toThrow(/pitches/);
  });

  it("the tag-census read rethrows through getSteamTagEconomics", async () => {
    const db = failing(await freshMemoryDb(), "tag_census");
    await expect(q.getSteamTagEconomics(db)).rejects.toThrow(/tag_census/);
  });

  it("the Express handlers answer 500, not an empty 200", async () => {
    const db = failing(failing(await freshMemoryDb(), "pitches"), "brief_steering");
    const server = createApp(db).listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      for (const path of ["/api/pitches", "/api/brief/steering"]) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        expect(res.status, path).toBe(500);
      }
    } finally {
      server.close();
    }
  });
});

describe("a missing table still reads as empty (real 42P01)", () => {
  it("getBriefSteering → no flags", async () => {
    const db = await freshMemoryDb();
    await db.exec("DROP TABLE brief_steering");
    expect(await q.getBriefSteering(db)).toEqual({ flags: [], updatedAt: null });
  });

  it("getPitches → []", async () => {
    const db = await freshMemoryDb();
    await db.exec("DROP TABLE pitches");
    expect(await q.getPitches(db)).toEqual([]);
  });

  it("getSteamTagEconomics → no census, no throw", async () => {
    const db = await freshMemoryDb();
    await db.exec("DROP TABLE tag_census");
    expect(await q.getSteamTagEconomics(db)).toEqual([]);
  });
});
