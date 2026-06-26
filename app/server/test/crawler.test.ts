import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crazygames } from "../src/crawler/crazygames.ts";
import { loadGames } from "../src/crawler/load.ts";
import { freshMemoryDb } from "../src/db/db.ts";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/crazygames_game.html", import.meta.url)),
  "utf8"
);

describe("A11 crazygames parse", () => {
  it("maps __NEXT_DATA__ game to RawGame", () => {
    const g = crazygames.parseGame(fixture, "https://www.crazygames.com/game/final-drop");
    expect(g.title).toBe("Final Drop");
    expect(g.sourceGameId).toBe("final-drop");
    expect(g.rating).toBeCloseTo(4.6, 2); // 9.2/2
    expect(g.votes).toBe(5099); // 4702 + 397
    expect(g.genre).toBe("Action");
    expect(g.tags).toEqual(["3D", "Battle"]);
    expect(g.engine).toBe("Unity 2022");
    expect(g.orientation).toBe("landscape");
    expect(g.mobile).toBe(true);
  });
});

describe("A12 append-only load idempotency", () => {
  it("re-running the same crawl day inserts no duplicate snapshots", async () => {
    const db = await freshMemoryDb();
    const g = crazygames.parseGame(fixture, "https://www.crazygames.com/game/final-drop");
    const date = "2026-06-26T00:00:00.000Z";
    const r1 = await loadGames(db, "crazygames", "https://www.crazygames.com", [g], date);
    const c1 = await db.query("SELECT count(*)::int n FROM game_snapshots");
    const r2 = await loadGames(db, "crazygames", "https://www.crazygames.com", [g], date);
    const c2 = await db.query("SELECT count(*)::int n FROM game_snapshots");
    expect(r1.inserted).toBe(1);
    expect(r2.inserted).toBe(0);
    expect(Number(c1[0].n)).toBe(1);
    expect(Number(c2[0].n)).toBe(1);
  });
});
