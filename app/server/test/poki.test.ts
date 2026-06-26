import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { poki } from "../src/crawler/poki.ts";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/poki_game.html", import.meta.url)),
  "utf8"
);

describe("Poki adapter parse", () => {
  it("extracts the game from window.INITIAL_STATE getGame query", () => {
    const g = poki.parseGame(fixture, "https://poki.com/en/g/subway-surfers");
    expect(g.title).toBe("Subway Surfers");
    expect(g.sourceGameId).toBe("subway-surfers");
    expect(g.rating).toBe(4.4); // Poki is already 0-5, no normalization
    expect(g.votes).toBe(1000000); // up_count + down_count
    expect(g.developer).toBe("SYBO"); // Poki exposes developer name
    expect(g.genre).toBe("Action");
    expect(g.tags).toEqual(["Action", "Runner"]); // category titles
    expect(g.orientation).toBe("portrait");
    expect(g.mobile).toBe(true);
    expect(g.engine).toBe("unity");
  });
});
