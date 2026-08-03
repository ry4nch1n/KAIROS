import { describe, it, expect, beforeAll } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import {
  libraryItems,
  publishLibraryItem,
  publishPitch,
  getPitches,
} from "../src/queries/index.ts"; // prettier-ignore
import type { LibraryItemInput } from "shared";

// Kill-gate verdict loop (#55). The two tables are DIFFERENT — the build lives in
// `library_items`, the disposition the leaderboard ranks lives in `pitches.status` — so a
// verdict only counts if it reaches the pitch. These pin that path.
const CARD = "https://kairos-prototypes.netlify.app/vigil-20260803/";
const base: LibraryItemInput = { kind: "prototype", title: "Vigil — loop toy", mediaUrl: CARD };

describe("prototype kill-gate verdict", () => {
  let db: Querier;
  const post = (extra: Partial<LibraryItemInput> = {}) =>
    publishLibraryItem(db, { ...base, ...extra });
  const card = async () => (await libraryItems(db))[0];

  beforeAll(async () => {
    db = await freshMemoryDb();
    await publishPitch(db, {
      slug: "vigil",
      title: "Vigil",
      pitchDate: "2026-08-01",
      status: "prototyping",
    });
    await post({ pitchSlug: "vigil" });
  });

  it("a posted card with no verdict reads as NOT TESTED, not as a failed test", async () => {
    expect((await card()).verdict).toBeNull();
    expect((await card()).pitchSlug).toBe("vigil");
  });

  it("records the three kill-gate answers with provenance", async () => {
    await post({
      verdict: {
        goalGrasped: true,
        secondRun: false, // tested and failed — a recorded FALSE, not an absence
        moment: "the last-second wall placement",
        recordedAt: "2026-08-03T02:00:00.000Z",
        source: "human play-test · 3 first-timers",
      },
    });
    expect((await card()).verdict).toEqual({
      goalGrasped: true,
      secondRun: false,
      moment: "the last-second wall placement",
      recordedAt: "2026-08-03T02:00:00.000Z",
      source: "human play-test · 3 first-timers",
    });
  });

  it("re-posting card metadata without a verdict preserves the recorded evidence", async () => {
    await post({ title: "Vigil — loop toy v2" });
    expect((await card()).title).toBe("Vigil — loop toy v2");
    expect((await card()).verdict.goalGrasped).toBe(true);
  });

  it("does NOT flip the pitch status as a side effect of recording a verdict", async () => {
    expect((await getPitches(db))[0].status).toBe("prototyping");
  });

  it("propagates an EXPLICIT status flip to the linked pitch, reversibly", async () => {
    await post({ pitchStatus: "validated" });
    expect((await getPitches(db))[0].status).toBe("validated");
    expect((await card()).status).toBe("validated"); // card derives status from the pitch
    await post({ pitchStatus: "prototyping" });
    expect((await getPitches(db))[0].status).toBe("prototyping");
  });

  it("rejects an off-contract status and an empty or malformed verdict", async () => {
    await expect(post({ pitchStatus: "vibes-good" })).rejects.toThrow(/unknown pitchStatus/);
    await expect(post({ verdict: {} })).rejects.toThrow(/at least one kill-gate question/);
    await expect(post({ verdict: { goalGrasped: "yes" as any } })).rejects.toThrow(/boolean/);
    expect((await card()).verdict.goalGrasped).toBe(true); // nothing half-landed
  });

  it("refuses a status flip from a card that is not linked to a pitch", async () => {
    const orphan = { kind: "prototype", title: "Orphan", mediaUrl: "https://example.com/orphan/" };
    await publishLibraryItem(db, orphan);
    await expect(publishLibraryItem(db, { ...orphan, pitchStatus: "validated" })).rejects.toThrow(
      /linked to a pitch/,
    );
  });
});
