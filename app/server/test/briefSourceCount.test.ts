import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, applySchema, type Querier } from "../src/db/db.ts";
import {
  briefSourceCount,
  publishEdition,
  getBriefEdition,
  getBriefEditions,
  backfillBriefSourceCounts,
} from "../src/queries/library.ts";

const payload = {
  top_signals: [
    { text: "a", source: "https://www.Steamdb.info/app/1" },
    "plain signal citing https://gamesindustry.biz/story, trailing",
    "plain signal with no link",
  ],
  new_notable: [
    { name: "x", source: "https://store.steampowered.com/app/1" },
    { name: "y", source: "https://store.steampowered.com/app/2" }, // same host → once
    { name: "z", source: "not a url" },
    { name: "w" },
  ],
  browser: [{ name: "b", source: "https://www.crazygames.com/game/b" }],
  tooling: { items: [{ headline: "t", source: "https://godotengine.org/article" }] },
  market: [{ headline: "m", source: "https://steamdb.info/sales" }], // dup of top signal host
  reference_shelf: "See https://www.gdcvault.com/play/1 and Tiny Glade.",
};

describe("briefSourceCount (#181)", () => {
  it("counts distinct lowercased www-stripped hosts across every source-bearing field", () => {
    // steamdb.info, gamesindustry.biz, store.steampowered.com, crazygames.com, godotengine.org, gdcvault.com
    expect(briefSourceCount(payload)).toBe(6);
  });
  it("ignores invalid/missing URLs and returns 0 for empty payloads", () => {
    expect(briefSourceCount({})).toBe(0);
    expect(briefSourceCount(null)).toBe(0);
    expect(briefSourceCount({ market: [{ headline: "h", source: "ftp://x.org" }] })).toBe(0);
    expect(briefSourceCount({ new_notable: "nope", tooling: {} })).toBe(0);
  });
});

describe("brief source_count write/read paths (#181)", () => {
  let db: Querier;
  beforeAll(async () => {
    db = await freshMemoryDb();
    await applySchema(db);
  }, 60000);

  it("derives on publish when absent, and an explicit count overrides", async () => {
    await publishEdition(db, { editionDate: "2026-09-01", weekday: "tue", payload });
    await publishEdition(db, {
      editionDate: "2026-09-03",
      weekday: "thu",
      payload,
      sourceCount: 42,
    });
    const list = await getBriefEditions(db, new Date("2026-09-04T00:00:00Z"));
    const by = Object.fromEntries(list.map((e) => [e.editionDate, e.sourceCount]));
    expect(by["2026-09-01"]).toBe(6);
    expect(by["2026-09-03"]).toBe(42);
  });

  it("derives on single-edition read and backfills legacy null/0 rows idempotently", async () => {
    await db.query(
      `INSERT INTO brief_editions(edition_date, weekday, brief_type, payload, source_count) VALUES ($1,'mon','indie',$2,0)`,
      ["2026-08-31", JSON.stringify(payload)],
    );
    expect((await getBriefEdition(db, "2026-08-31"))!.sourceCount).toBe(6);
    expect(await backfillBriefSourceCounts(db)).toBe(1);
    expect(await backfillBriefSourceCounts(db)).toBe(0);
    const [row] = await db.query(
      `SELECT source_count FROM brief_editions WHERE edition_date = '2026-08-31'`,
    );
    expect(Number(row.source_count)).toBe(6);
  });
});
