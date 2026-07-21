import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateDocs } from "../src/scripts/gen-docs.ts";

// Docs-drift guard (#102). The root docs are hand-written and drifted for weeks with nothing
// to catch it: on 2026-07-21 DESIGN.md claimed pitch contract v5 while the code was v8
// (top-level v10), and two shipped surfaces (#90, #32) were undocumented entirely. All of
// those are mechanically derivable, so gen-docs.ts derives them and this test makes a stale
// copy UNMERGEABLE rather than merely discouraged.
//
// Deliberately a test rather than a step in ci.yml: the existing `test` job already runs the
// suite (same reason routeParity.test.ts lives here), so no CI config change is needed — and
// adding a docs:check step to ci.yml before this generator existed would have called a missing
// script, reddened the required check, and blocked every merge including its own fix.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."); // test → server → app → root

describe("generated docs are in sync with source", () => {
  const generated = generateDocs();

  it("generates a non-empty set of reference files", () => {
    expect(Object.keys(generated).length).toBeGreaterThan(0);
    for (const [rel, body] of Object.entries(generated)) {
      expect(body.length, `${rel} generated empty`).toBeGreaterThan(100);
    }
  });

  it.each(Object.keys(generateDocs()))("%s matches its committed copy", (rel) => {
    const abs = join(REPO_ROOT, rel);
    expect(
      existsSync(abs),
      `${rel} is missing.\n\nRun:  npx tsx app/server/src/scripts/gen-docs.ts`,
    ).toBe(true);

    const onDisk = readFileSync(abs, "utf8");
    // Normalize EOL only: the repo is LF via .gitattributes, but a Windows checkout can
    // materialize CRLF. Content drift must still fail loudly.
    const norm = (s: string) => s.replace(/\r\n/g, "\n");
    expect(
      norm(onDisk),
      `${rel} is out of date — source changed but the generated docs were not refreshed.\n\n` +
        `Run:  npx tsx app/server/src/scripts/gen-docs.ts\n` +
        `then commit the result alongside your change.`,
    ).toBe(norm(generated[rel]));
  });

  it("keeps generation deterministic (same input ⇒ byte-identical output)", () => {
    // A drift gate is only meaningful if regeneration is stable; an unsorted collection here
    // would make the test flap and train everyone to ignore it.
    expect(generateDocs()).toEqual(generated);
  });
});
