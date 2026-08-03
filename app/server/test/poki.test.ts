import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { poki } from "../src/crawler/poki.ts";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/poki_game.html", import.meta.url)),
  "utf8",
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

  // #56 — promotion capture. Both signals ride in the SAME blob the parser already reads:
  // a getHomepage(...) query whose data.games is the ordered homepage grid, and the game's
  // own trending_rank. No extra request, so every Poki record carries them.
  it("captures homepage position + trending from the same INITIAL_STATE blob", () => {
    const g = poki.parseGame(fixture, "https://poki.com/en/g/subway-surfers");
    expect(g.featured).toBe(true);
    expect(g.homepagePosition).toBe(3); // 1-based rank in the ordered homepage array
    expect(g.trending).toBe(true); // trending_rank: 7
  });

  it("leaves a non-promoted game unfeatured, position null, not trending", () => {
    // Same captured page: its homepage array does not list this game, and its game object
    // has no trending_rank — Poki omits the field entirely when a game isn't trending.
    const g = poki.parseGame(fixture, "https://poki.com/en/g/quiet-title");
    expect(g.sourceGameId).toBe("quiet-title");
    expect(g.featured).toBe(false);
    expect(g.homepagePosition).toBe(null);
    expect(g.trending).toBe(false);
  });
});
