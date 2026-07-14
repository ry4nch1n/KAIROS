import { describe, it, expect } from "vitest";
import { freshMemoryDb, type Querier } from "../src/db/db.ts";
import { getHiddenGems, bayesianGemScore } from "../src/queries/index.ts";

// issue #8 — sample-size gate on Hidden Gems.

describe("H1 bayesianGemScore shrinks thin-sample ratings toward the mean", () => {
  it("a 1-vote 5.0 scores below a well-supported 4.8", () => {
    expect(bayesianGemScore(5.0, 1)).toBeLessThan(bayesianGemScore(4.8, 1000));
  });
  it("with many votes it converges to the raw rating", () => {
    expect(bayesianGemScore(4.8, 100000)).toBeCloseTo(4.8, 2);
  });
  it("with zero votes it equals the prior mean", () => {
    expect(bayesianGemScore(5.0, 0)).toBeCloseTo(4.2, 6);
  });
});

async function seed(db: Querier) {
  const one = async (sql: string, p: unknown[]) => (await db.query(sql, p))[0];
  const sid = (
    await one(
      "INSERT INTO sources(name, base_url) VALUES ('poki','https://poki.com') RETURNING id",
      [],
    )
  ).id;
  const cid = (
    await one(
      "INSERT INTO crawls(source_id, started_at, finished_at, status, games_seen) VALUES ($1, now(), now(), 'ok', 0) RETURNING id",
      [sid],
    )
  ).id;
  const add = async (title: string, rating: number, votes: number) => {
    const gid = (
      await one(
        "INSERT INTO games(source_id, source_game_id, url, title) VALUES ($1,$2,$3,$4) RETURNING id",
        [sid, title, `https://poki.com/g/${title}`, title],
      )
    ).id;
    await db.query(
      "INSERT INTO game_snapshots(game_id, crawl_id, captured_at, rating, votes, genre) VALUES ($1,$2, now(), $3,$4,'Puzzle')",
      [gid, cid, rating, votes],
    );
  };
  // a "crowd" of well-supported, mid-rated games (neither top-rating nor bottom-votes)
  for (let i = 0; i < 12; i++) await add(`Crowd${i}`, 3.9 + (i % 5) * 0.1, 200 + i * 200);
  await add("Flukey", 5.0, 1); // perfect score, 1 vote — must be excluded by the floor
  await add("TrueGem", 4.9, 35); // high rating, low visibility, ABOVE the floor — a real gem
}

describe("H2 getHiddenGems gates on the minimum-vote floor", () => {
  it("excludes a 1-vote 5.0 fluke but keeps a real low-visibility gem", async () => {
    const db = await freshMemoryDb();
    await seed(db);
    const titles = (await getHiddenGems(db, "poki")).map((g) => g.title);
    expect(titles).not.toContain("Flukey");
    expect(titles).toContain("TrueGem");
  });
});
