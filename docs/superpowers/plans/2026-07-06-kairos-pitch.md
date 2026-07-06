# kairos-pitch Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `kairos-pitch` — an invocable skill that turns a seed (a whimsical idea, or Radar/Brief data) into a complete, contract-conforming KAIROS pitch, previews it, posts it to Library → Pitches, and can list/delete pitches for cleanup.

**Architecture:** A **skill brain** (`SKILL.md`, the authoring playbook Claude follows) plus a **thin Node CLI** (`kairos-pitch.js`) that does deterministic work: fetch the live contract, validate, render an HTML preview card, POST, list, and DELETE. Generation is Claude's judgment; the CLI never makes creative choices and never prompts (the draft→confirm gate lives in the skill). A small backend addition to the KAIROS app adds a token-gated `DELETE /api/pitches/:slug`. The skill and script live in synced OneDrive config; the backend change lives in the KAIROS git repo.

**Tech Stack:** Node ≥18 (CommonJS, global `fetch`, built-in `node:test`) for the skill; TypeScript + Vitest + Express + PGlite/Neon for the KAIROS app.

## Global Constraints

- **Contract at runtime, never hardcode enums.** The CLI reads `GET {KAIROS_API_URL}/api/contract` and validates against the returned `pitch` taxonomy. Copied from the routine's rule: "never hardcode the enums, read them."
- **Reuse the existing secret — no new token.** Config resolves first-hit-wins: `./kairos.config.json` → `../../tools/indie-brief/kairos.config.json` → env (`KAIROS_API_URL`, `PUBLISH_TOKEN`). Same chain `kairos-iterate` uses.
- **Skill lives in synced config:** source of truth `%OneDrive%\Claude-Config\skills\kairos-pitch\`; discovered via a directory junction `~/.claude/skills/kairos-pitch` (created by `Setup-This-Machine.bat`, no admin). Restart Claude Code to load a new skill.
- **Regenerable output is local, not synced:** staging JSON + preview HTML go to `%USERPROFILE%\Documents\KAIROS\Output\KairosPitch\` (override `KAIROS_PITCH_OUT_DIR`).
- **CLI is non-interactive.** No `Read-Host`/prompts — the confirm gate is the skill's job (Claude previews, asks the user, then calls `post`). `--dry-run` validates + previews without POSTing.
- **Validation must mirror the server gate.** The CLI's `validateAgainstContract` reproduces `shared/src/contract.ts` `validatePitchInput` semantics exactly (required fields, enum membership, `pitchDate` `YYYY-MM-DD`, score fields integer in `[scoreMin..scoreMax]`).
- **KAIROS repo changes go via a branch + CI.** `.github/workflows/ci.yml` is the required merge gate (branch protection). Route parity (`server/test/routeParity.test.ts`) must stay green. Never deploy to prod or write to the live Library without the user's explicit go-ahead.
- **Verify against LOCAL dev by default.** Build/verify point `KAIROS_API_URL` at `http://localhost:8787` (Express + PGlite). Prod posting and the Netlify deploy of the DELETE endpoint are user-gated final steps.

## File Structure

Skill (synced OneDrive — not the git repo):
- `%OneDrive%\Claude-Config\skills\kairos-pitch\kairos-pitch.js` — CLI + exported pure functions.
- `%OneDrive%\Claude-Config\skills\kairos-pitch\kairos-pitch.test.js` — `node:test` unit tests (CJS).
- `%OneDrive%\Claude-Config\skills\kairos-pitch\SKILL.md` — the authoring playbook.

Routine (synced OneDrive — Phase 4 edits):
- `%OneDrive%\Claude-Config\tools\kairos-iterate\kairos-iterate.js` — `post-pitches` delegates to the skill's `postItems`.
- `%OneDrive%\Claude-Config\tools\kairos-iterate\ROUTINE.md` — Step 1 invokes `/kairos-pitch`.

KAIROS repo (git — Phase 5 backend, on a branch):
- `app/server/src/queries/index.ts` — add `deletePitch`.
- `app/server/src/api/app.ts` — add `DELETE /api/pitches/:slug`.
- `app/netlify/functions/api.ts` — add the mirrored DELETE branch.
- `app/server/test/pitches.test.ts` — add delete tests.

All CLI commands are run from the skill dir; all `npm` commands from `KAIROS/app/`.

---

## Phase 1 — The hands (CLI, pure + unit-tested)

No network and no server in this phase: build and unit-test the pure functions and CLI wiring with `node --test`.

### Task 1.1: Scaffold the module — `loadConfig` + `slugify`

**Files:**
- Create: `%OneDrive%\Claude-Config\skills\kairos-pitch\kairos-pitch.js`
- Test: `%OneDrive%\Claude-Config\skills\kairos-pitch\kairos-pitch.test.js`

**Interfaces:**
- Produces: `slugify(title: string, dateYYYYMMDD: string, n?: number|null): string`; `loadConfig(): {KAIROS_API_URL, PUBLISH_TOKEN}`; module exports object.

- [ ] **Step 1: Write the failing test**

`kairos-pitch.test.js`:
```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const k = require("./kairos-pitch.js");

test("slugify makes a stable kebab id with compact date", () => {
  assert.equal(k.slugify("Haunted House Co-op!", "2026-07-06"), "haunted-house-co-op-20260706");
});
test("slugify appends an index when given one", () => {
  assert.equal(k.slugify("Salvage Line", "2026-07-06", 2), "salvage-line-20260706-2");
});
test("slugify collapses whitespace and strips punctuation", () => {
  assert.equal(k.slugify("  Tidy   Up:  the Manor  ", "2026-01-02"), "tidy-up-the-manor-20260102");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from the skill dir): `node --test`
Expected: FAIL — `Cannot find module './kairos-pitch.js'`.

- [ ] **Step 3: Write minimal implementation**

`kairos-pitch.js`:
```js
#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const OUT =
  process.env.KAIROS_PITCH_OUT_DIR ||
  path.join(process.env.USERPROFILE || process.env.HOME || ".", "Documents", "KAIROS", "Output", "KairosPitch");

function loadConfig() {
  const cfg = { KAIROS_API_URL: "", PUBLISH_TOKEN: "" };
  for (const p of [
    path.join(DIR, "kairos.config.json"),
    path.join(DIR, "..", "..", "tools", "indie-brief", "kairos.config.json"),
    path.join(DIR, "..", "..", "tools", "kairos-iterate", "kairos.config.json"),
  ]) {
    try { Object.assign(cfg, JSON.parse(fs.readFileSync(p, "utf8"))); break; } catch { /* next */ }
  }
  cfg.KAIROS_API_URL = process.env.KAIROS_API_URL || cfg.KAIROS_API_URL;
  cfg.PUBLISH_TOKEN = process.env.PUBLISH_TOKEN || cfg.PUBLISH_TOKEN;
  return cfg;
}

function slugify(title, dateYYYYMMDD, n) {
  const kebab = String(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/, "");
  const d = String(dateYYYYMMDD).replace(/-/g, "");
  return n ? `${kebab}-${d}-${n}` : `${kebab}-${d}`;
}

module.exports = { loadConfig, slugify, OUT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit** — the skill dir is on OneDrive (not a git repo); "commit" = confirm files saved. If OneDrive is a git repo on this machine, `git add` + `git commit -m "feat(kairos-pitch): scaffold module + slugify"`.

---

### Task 1.2: `validateAgainstContract` (mirrors the server gate)

**Files:**
- Modify: `kairos-pitch.js`
- Test: `kairos-pitch.test.js`

**Interfaces:**
- Consumes: a `contract` object shaped like `GET /api/contract` (`{ pitch: { loopFamilies, badges, statuses, platformLadders, scoreFields, scoreMin, scoreMax, required } }`).
- Produces: `validateAgainstContract(p: object, contract: object): { ok: boolean, errors: string[] }`.

- [ ] **Step 1: Write the failing test**

Append to `kairos-pitch.test.js`:
```js
const CONTRACT = {
  pitch: {
    loopFamilies: ["extraction-lite", "cozy-craft"],
    badges: ["recommended"],
    statuses: ["proposed", "prototyping", "shelved", "shipped"],
    platformLadders: ["browser->steam", "browser-only", "steam-only"],
    scoreFields: ["d1Fit", "steamCeiling", "buildCost"],
    scoreMin: 1, scoreMax: 3,
    required: ["slug", "title", "pitchDate"],
  },
};

test("validateAgainstContract accepts a good pitch", () => {
  const r = k.validateAgainstContract(
    { slug: "x", title: "X", pitchDate: "2026-07-06", loopFamily: "cozy-craft", d1Fit: 2 },
    CONTRACT
  );
  assert.deepEqual(r, { ok: true, errors: [] });
});
test("validateAgainstContract flags missing required + bad enum + bad score + bad date", () => {
  const r = k.validateAgainstContract(
    { title: "X", pitchDate: "07-2026", loopFamily: "nope", d1Fit: 5 },
    CONTRACT
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("missing required field: slug")));
  assert.ok(r.errors.some((e) => e.includes("pitchDate must be YYYY-MM-DD")));
  assert.ok(r.errors.some((e) => e.includes('unknown loopFamily "nope"')));
  assert.ok(r.errors.some((e) => e.includes("d1Fit must be an integer 1..3")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `k.validateAgainstContract is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `kairos-pitch.js` (before `module.exports`, and add the name to the exports):
```js
function validateAgainstContract(p, contract) {
  const c = contract && contract.pitch;
  if (!p || typeof p !== "object") return { ok: false, errors: ["pitch must be an object"] };
  if (!c) return { ok: false, errors: ["contract unavailable — cannot validate"] };
  const errors = [];
  for (const f of c.required) {
    if (p[f] === undefined || p[f] === null || p[f] === "") errors.push(`missing required field: ${f}`);
  }
  if (p.pitchDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.pitchDate)))
    errors.push("pitchDate must be YYYY-MM-DD");
  if (p.loopFamily != null && !c.loopFamilies.includes(p.loopFamily))
    errors.push(`unknown loopFamily "${p.loopFamily}" — add it to the contract (bump pitch.version) first`);
  if (p.badge != null && !c.badges.includes(p.badge)) errors.push(`unknown badge "${p.badge}"`);
  if (p.status != null && !c.statuses.includes(p.status)) errors.push(`unknown status "${p.status}"`);
  if (p.platformLadder != null && !c.platformLadders.includes(p.platformLadder))
    errors.push(`unknown platformLadder "${p.platformLadder}"`);
  for (const s of c.scoreFields) {
    const v = p[s];
    if (v != null && (!Number.isInteger(v) || v < c.scoreMin || v > c.scoreMax))
      errors.push(`${s} must be an integer ${c.scoreMin}..${c.scoreMax}`);
  }
  return { ok: errors.length === 0, errors };
}
```
Update exports: `module.exports = { loadConfig, slugify, validateAgainstContract, OUT };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** — `feat(kairos-pitch): contract-mirroring validation`.

---

### Task 1.3: `parseArgs` (CLI arg parsing)

**Files:** Modify `kairos-pitch.js`; Test `kairos-pitch.test.js`.

**Interfaces:**
- Produces: `parseArgs(argv: string[]): { cmd: string, rest: string[], flags: { dryRun: boolean, auto: boolean } }`.

- [ ] **Step 1: Write the failing test**

Append:
```js
test("parseArgs pulls command, positional rest, and flags", () => {
  const a = k.parseArgs(["node", "kairos-pitch.js", "post", "batch.json", "--dry-run"]);
  assert.equal(a.cmd, "post");
  assert.deepEqual(a.rest, ["batch.json"]);
  assert.equal(a.flags.dryRun, true);
  assert.equal(a.flags.auto, false);
});
test("parseArgs defaults command to help", () => {
  assert.equal(k.parseArgs(["node", "kairos-pitch.js"]).cmd, "help");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `k.parseArgs is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add and export `parseArgs`:
```js
function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { dryRun: false, auto: false };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--auto") flags.auto = true;
    else positional.push(a);
  }
  return { cmd: positional[0] || "help", rest: positional.slice(1), flags };
}
```

- [ ] **Step 4: Run test to verify it passes** — `node --test` → PASS (7 tests).

- [ ] **Step 5: Commit** — `feat(kairos-pitch): CLI arg parsing`.

---

### Task 1.4: `buildPreviewHtml` (the confirm surface)

**Files:** Modify `kairos-pitch.js`; Test `kairos-pitch.test.js`.

**Interfaces:**
- Produces: `buildPreviewHtml(pitch: object): string` — a self-contained light-mode HTML page mirroring the Library `PitchCard`.

- [ ] **Step 1: Write the failing test**

Append:
```js
test("buildPreviewHtml embeds the pitch and escapes HTML", () => {
  const html = k.buildPreviewHtml({
    slug: "s", title: "Tidy <Manor>", pitchDate: "2026-07-06",
    loopFamily: "cozy-craft", status: "proposed", oneLiner: "Clean & flee.",
    d1Fit: 2, steamCeiling: 1, buildCost: 3,
  });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Tidy &lt;Manor&gt;"));   // escaped
  assert.ok(html.includes("Clean &amp; flee."));    // escaped
  assert.ok(html.includes("cozy-craft"));
});
```

- [ ] **Step 2: Run test to verify it fails** — `node --test` → FAIL (`buildPreviewHtml is not a function`).

- [ ] **Step 3: Write minimal implementation**

Add and export `buildPreviewHtml`:
```js
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function dots(n) {
  if (n == null) return "";
  return Array.from({ length: 3 }, (_, i) => (i < n ? "●" : "○")).join(" ");
}
function row(label, val) {
  return val ? `<div class="f"><span class="l">${esc(label)}</span>${esc(val)}</div>` : "";
}
function buildPreviewHtml(p) {
  const ladder = (p.platformLadder || "browser->steam").replace("->", " → ");
  const scores =
    p.d1Fit != null || p.steamCeiling != null || p.buildCost != null
      ? `<div class="sc"><span>D1 fit ${dots(p.d1Fit)}</span><span>Steam ceiling ${dots(p.steamCeiling)}</span><span>Build ease ${dots(p.buildCost)}</span></div>`
      : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pitch preview — ${esc(p.title)}</title>
<style>
  body{margin:0;background:#FAFAFA;color:#09090B;font-family:'IBM Plex Sans',system-ui,Segoe UI,sans-serif;padding:40px}
  .card{max-width:640px;margin:0 auto;background:#fff;border:1px solid #E4E4E7;border-radius:14px;padding:24px 26px}
  .tags{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
  .tag{font-family:'JetBrains Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:3px 9px;border-radius:6px;background:#F1F3F5;color:#3F3F46}
  .tag.lf{background:#EAF0FE;color:#1D4ED8}.tag.badge{background:#FEF3E2;color:#7C4A08}
  h1{font-size:1.5rem;margin:.1em 0}
  .meta{font-family:'JetBrains Mono',monospace;font-size:12px;color:#6b7280;margin-bottom:14px}
  .one{font-size:1.05rem;color:#18181B;margin:0 0 16px}
  .f{margin:10px 0;font-size:14.5px;line-height:1.55}.f .l{display:block;font-family:'JetBrains Mono',monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;margin-bottom:2px}
  .risk{color:#7f1d1d}
  .sc{display:flex;gap:20px;flex-wrap:wrap;margin-top:18px;padding-top:14px;border-top:1px solid #E4E4E7;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:#3F3F46}
  .slug{font-family:'JetBrains Mono',monospace;font-size:11px;color:#9ca3af;margin-top:20px}
</style></head><body><div class="card">
  <div class="tags">
    ${p.badge ? `<span class="tag badge">${esc(p.badge)}</span>` : ""}
    ${p.loopFamily ? `<span class="tag lf">${esc(p.loopFamily)}</span>` : ""}
    <span class="tag">${esc(p.status || "proposed")}</span>
  </div>
  <h1>${esc(p.title)}</h1>
  <div class="meta">${esc(ladder)} · ${esc(p.pitchDate)}${p.batch ? " · batch " + esc(p.batch) : ""}</div>
  ${p.oneLiner ? `<p class="one">${esc(p.oneLiner)}</p>` : ""}
  ${row("Loop", p.loopDetail)}
  ${row("Browser MVP", p.browserMvp)}
  ${row("Steam ladder", p.steamLadder)}
  ${row("Evidence", p.evidence)}
  ${p.risk ? `<div class="f risk"><span class="l">Risk</span>${esc(p.risk)}</div>` : ""}
  ${scores}
  <div class="slug">slug: ${esc(p.slug)}${p.source ? " · " + esc(p.source) : ""}</div>
</div></body></html>`;
}
```
Update exports to include `buildPreviewHtml`.

- [ ] **Step 4: Run test to verify it passes** — `node --test` → PASS (8 tests).

- [ ] **Step 5: Commit** — `feat(kairos-pitch): HTML preview card`.

---

### Task 1.5: CLI dispatch (`main`) — commands wired to the functions

**Files:** Modify `kairos-pitch.js`.

**Interfaces:**
- Consumes: all pure functions above; `global.fetch`.
- Produces: `postItems(cfg, items, opts): Promise<{ ok: boolean, count: number, status?: number, body?: any }>`; `fetchContract(cfg): Promise<object>`; a `main()` that runs on `require.main === module`. Commands: `contract`, `validate <file>`, `preview <file>`, `post <file> [--dry-run]`, `list`, `delete <slug>`, `help`.

- [ ] **Step 1: Write the implementation** (this task is CLI plumbing verified by running it, not a unit test — its pieces are already unit-tested)

Add to `kairos-pitch.js`, then the `require.main` guard at the very end:
```js
async function fetchContract(cfg) {
  const base = String(cfg.KAIROS_API_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("KAIROS_API_URL not set");
  const r = await fetch(`${base}/api/contract`);
  if (!r.ok) throw new Error(`GET /api/contract → HTTP ${r.status}`);
  return r.json();
}

async function postItems(cfg, items, opts = {}) {
  const base = String(cfg.KAIROS_API_URL || "").replace(/\/+$/, "");
  const contract = await fetchContract(cfg);
  for (const it of items) {
    const v = validateAgainstContract(it, contract);
    if (!v.ok) throw new Error(`pitch "${it.slug || it.title || "?"}" fails contract: ${v.errors.join("; ")}`);
  }
  if (opts.dryRun) return { ok: true, count: items.length, dryRun: true };
  if (!cfg.PUBLISH_TOKEN) throw new Error("PUBLISH_TOKEN not set");
  const r = await fetch(`${base}/api/pitches`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.PUBLISH_TOKEN}` },
    body: JSON.stringify(items),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, count: body.count ?? items.length, body };
}

function readJson(file) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function main() {
  const { cmd, rest, flags } = parseArgs(process.argv);
  const cfg = loadConfig();
  const base = String(cfg.KAIROS_API_URL || "").replace(/\/+$/, "");
  if (cmd === "help" || !cmd) {
    console.log("kairos-pitch <contract|validate|preview|post|list|delete> [file|slug] [--dry-run]");
    return;
  }
  if (cmd === "contract") {
    console.log(JSON.stringify((await fetchContract(cfg)).pitch, null, 2));
    return;
  }
  if (cmd === "validate") {
    const items = readJson(rest[0]);
    const contract = await fetchContract(cfg);
    let bad = 0;
    for (const it of items) {
      const v = validateAgainstContract(it, contract);
      console.log(v.ok ? `✓ ${it.slug || it.title}` : `✗ ${it.slug || it.title}: ${v.errors.join("; ")}`);
      if (!v.ok) bad++;
    }
    if (bad) process.exitCode = 1;
    return;
  }
  if (cmd === "preview") {
    fs.mkdirSync(OUT, { recursive: true });
    for (const it of readJson(rest[0])) {
      const fp = path.join(OUT, `${it.slug || "pitch"}.preview.html`);
      fs.writeFileSync(fp, buildPreviewHtml(it), "utf8");
      console.log(`✓ preview → ${fp}`);
    }
    return;
  }
  if (cmd === "post") {
    const res = await postItems(cfg, readJson(rest[0]), { dryRun: flags.dryRun });
    console.log(
      res.dryRun ? `✓ dry-run: ${res.count} pitch(es) valid, not posted`
      : res.ok ? `✓ posted ${res.count} pitch(es)`
      : `✗ HTTP ${res.status} ${JSON.stringify(res.body)}`
    );
    if (!res.ok && !res.dryRun) process.exitCode = 1;
    return;
  }
  if (cmd === "list") {
    const r = await fetch(`${base}/api/pitches`);
    const rows = await r.json();
    for (const p of rows) console.log(`${p.pitchDate}  ${(p.status || "").padEnd(11)}  ${p.slug}  —  ${p.title}`);
    console.log(`(${rows.length} pitch(es))`);
    return;
  }
  if (cmd === "delete") {
    const slug = rest[0];
    if (!slug) { console.error("delete needs a slug"); process.exitCode = 1; return; }
    if (!cfg.PUBLISH_TOKEN) throw new Error("PUBLISH_TOKEN not set");
    const r = await fetch(`${base}/api/pitches/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${cfg.PUBLISH_TOKEN}` },
    });
    const body = await r.json().catch(() => ({}));
    console.log(r.ok ? `✓ deleted ${slug}` : `✗ HTTP ${r.status} ${JSON.stringify(body)}`);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  console.error(`unknown command: ${cmd}`);
  process.exitCode = 1;
}

module.exports = { loadConfig, slugify, validateAgainstContract, parseArgs, buildPreviewHtml, postItems, fetchContract, OUT };

if (require.main === module) {
  main().catch((e) => { console.error("✗ " + (e && e.message ? e.message : String(e))); process.exitCode = 1; });
}
```
(Delete the earlier `module.exports = …` line from Task 1.4 — there must be exactly one exports assignment, the one above.)

- [ ] **Step 2: Verify the suite still passes and the CLI loads**

Run: `node --test` → Expected: PASS (8 tests, unchanged).
Run: `node kairos-pitch.js help` → Expected: prints the usage line.
Run: `node kairos-pitch.js` → Expected: prints the usage line (default `help`).

- [ ] **Step 3: Commit** — `feat(kairos-pitch): CLI dispatch (contract/validate/preview/post/list/delete)`.

---

## Phase 2 — Prove the pipe against a LOCAL dev server

Wire the CLI to a running KAIROS and confirm a pitch travels seed → validate → preview → POST → Library. **Local only** — no prod writes.

### Task 2.1: Stand up local KAIROS and confirm `contract`

**Files:** none (operational).

- [ ] **Step 1: Install + seed + run the dev stack** (from `KAIROS/app/`)

```bash
npm install
npm run db:seed
npm run dev
```
Leave it running (Express `:8787`, Vite `:5173`).

- [ ] **Step 2: Point the CLI at local and fetch the contract** (from the skill dir, new shell)

PowerShell:
```powershell
$env:KAIROS_API_URL="http://localhost:8787"; $env:PUBLISH_TOKEN="local-dev-token"
node kairos-pitch.js contract
```
Expected: JSON of the `pitch` taxonomy (loopFamilies, badges, statuses, platformLadders, scoreFields, scoreMin/Max, required).

> The dev server treats any non-empty `PUBLISH_TOKEN` env as valid because the POST handler compares against `process.env.PUBLISH_TOKEN`. Start `npm run dev` in a shell where `PUBLISH_TOKEN=local-dev-token` so the server and CLI share the same value. If they differ, POST returns 401.

- [ ] **Step 3: Commit** — none (operational verification).

### Task 2.2: Author a fixture pitch → validate → preview

**Files:** Create `%USERPROFILE%\Documents\KAIROS\Output\KairosPitch\fixture.json` (scratch, local, gitignored).

- [ ] **Step 1: Write a valid fixture pitch**

`fixture.json`:
```json
{
  "slug": "haunted-manor-tidy-20260706",
  "title": "Haunted Manor Tidy-Up",
  "pitchDate": "2026-07-06",
  "rank": 1,
  "oneLiner": "A cozy co-op about tidying haunted houses before dawn.",
  "loopFamily": "cozy-craft",
  "platformLadder": "browser->steam",
  "status": "proposed",
  "loopDetail": "Sweep a room, banish a minor haunt, sort loot into the right chest; ~30s minute-loop.",
  "browserMvp": "Canvas grid; click to sweep/sort; one haunt type.",
  "evidence": "Speculative — no radar backing yet; cozy-craft loops over-index on session length in the brief.",
  "risk": "Cozy + spooky tonal blend is easy to get wrong; scope of haunt variety.",
  "d1Fit": 2,
  "steamCeiling": 2,
  "buildCost": 3,
  "batch": "2026-07-06",
  "source": "kairos-pitch (ad-hoc) 2026-07-06"
}
```

- [ ] **Step 2: Validate + preview**

```powershell
node kairos-pitch.js validate "$env:USERPROFILE\Documents\KAIROS\Output\KairosPitch\fixture.json"
node kairos-pitch.js preview "$env:USERPROFILE\Documents\KAIROS\Output\KairosPitch\fixture.json"
```
Expected: `✓ haunted-manor-tidy-20260706` from validate; `✓ preview → …fixture-slug.preview.html` from preview. Open the HTML — a light-mode card showing tags, title, one-liner, fields, and dot-scores.

- [ ] **Step 3: Commit** — none (scratch fixture).

### Task 2.3: `post --dry-run`, then real local POST + upsert

**Files:** none.

- [ ] **Step 1: Dry-run**

```powershell
node kairos-pitch.js post "$env:USERPROFILE\Documents\KAIROS\Output\KairosPitch\fixture.json" --dry-run
```
Expected: `✓ dry-run: 1 pitch(es) valid, not posted`.

- [ ] **Step 2: Real POST to local, then list**

```powershell
node kairos-pitch.js post "$env:USERPROFILE\Documents\KAIROS\Output\KairosPitch\fixture.json"
node kairos-pitch.js list
```
Expected: `✓ posted 1 pitch(es)`; `list` shows the row.

- [ ] **Step 3: Confirm in the running web app** — open `http://localhost:5173`, go to Library → Pitches. Use the preview tooling to confirm the card renders (snapshot for the title `Haunted Manor Tidy-Up`).

- [ ] **Step 4: Verify upsert (edit-in-place)** — change `"status"` to `"prototyping"` in `fixture.json`, re-run `post`, then `list`. Expected: still one row for that slug, now `prototyping` (no duplicate).

- [ ] **Step 5: Commit** — none (operational). **Do not post to prod** — that is a user-gated go-live.

---

## Phase 3 — The brain (`SKILL.md`) + registration

### Task 3.1: Write `SKILL.md`

**Files:** Create `%OneDrive%\Claude-Config\skills\kairos-pitch\SKILL.md`.

- [ ] **Step 1: Write the skill playbook**

```markdown
---
name: kairos-pitch
description: Turn a seed — a whimsical idea, or Radar/Brief data — into a complete, contract-conforming KAIROS game pitch and post it to Library → Pitches. Also lists and deletes pitches for cleanup. Use when the user wants to create/add/publish a game pitch, brainstorm an idea into a pitch, or curate (list/remove) existing pitches.
---

# kairos-pitch

Create a KAIROS game pitch from a seed and post it to the live Library → Pitches collection. The CLI (`kairos-pitch.js`) does the deterministic work; you do the authoring judgment.

## Setup (once per invocation)
- The CLI reads config from `../../tools/indie-brief/kairos.config.json` (`KAIROS_API_URL`, `PUBLISH_TOKEN`) — no token handling needed from you. Env vars override.
- Always run `node kairos-pitch.js contract` FIRST and author only against the enums it prints. Never hardcode taxonomy.

## Creating a pitch (ad-hoc — the default)
1. **Read the seed.** A one-line idea, or pasted Radar/Brief/Plan data. Ask nothing if the seed is workable; the pitch is a proposal, not a commitment.
2. **Ground on the contract** — `node kairos-pitch.js contract`.
3. **Author the full pitch** as a JSON object (fields below). Required: `slug`, `title`, `pitchDate`.
   - `slug`: stable kebab, `<kebab-title>-<YYYYMMDD>[-n]`. Reuse the same slug to edit an existing pitch (upsert).
   - `loopFamily`, `badge`, `status`, `platformLadder`: values from the contract only.
   - `loopDetail`, `browserMvp`, `steamLadder`, `evidence`, `risk`: short paragraphs.
   - `evidence`: cite the data fed in. **For a whimsical seed with no data, say so honestly** (e.g. "Speculative — no radar backing yet") — never fabricate citations.
   - `d1Fit`, `steamCeiling`, `buildCost`: integers 1–3; score conservatively when evidence is thin.
   - `pitchDate` = today; `batch` = today; `source` = `"kairos-pitch (ad-hoc) <date>"`.
   - Keep it plan-aligned: browser-first, single-player, small, mouse-friendly, solo-scoped.
4. **Write it** to `%USERPROFILE%\Documents\KAIROS\Output\KairosPitch\<slug>.json`.
5. **Validate + preview** — `node kairos-pitch.js validate <file>` then `preview <file>`. Show the user the preview HTML path and a short summary.
6. **Confirm gate.** Ask the user to approve or tweak. Apply edits, re-preview if needed.
7. **Post** — `node kairos-pitch.js post <file>`. Report the result and that it's live in Library → Pitches.

## Routine / batch use (`--auto`)
When invoked by a routine (e.g. kairos-iterate) with data already gathered: author each pitch as above, **skip the interactive confirm**, and post directly — `node kairos-pitch.js post <file>` (validation still runs and rejects off-contract pitches). Use one `pitchDate`/`batch` for the cohort and `source` = `"kairos-iterate <date>"`.

## Cleanup / curation
- **List:** `node kairos-pitch.js list` — every pitch (date, status, slug, title).
- **Delete:** show the user the target (list row or re-preview by re-authoring the slug), confirm, then `node kairos-pitch.js delete <slug>`. Deletion is permanent (upsert-by-slug means re-posting recreates it).

## Guardrails
- Target is production. Before posting an ad-hoc pitch, the confirm gate is mandatory unless the user said `--auto`/"just post it".
- If `contract` or `post` fails (unreachable API, 401), report it and stop — do not guess enums or retry blindly.
```

- [ ] **Step 2: Verify** — read the file back; confirm the frontmatter `name: kairos-pitch` and a description that names create/add/publish/list/delete triggers.

- [ ] **Step 3: Commit** — `feat(kairos-pitch): SKILL.md authoring playbook`.

### Task 3.2: Register the skill (junction) + load

**Files:** none (filesystem link).

- [ ] **Step 1: Create the directory junction** (no admin needed)

PowerShell:
```powershell
$src = Join-Path $env:OneDrive 'Claude-Config\skills\kairos-pitch'
$dst = Join-Path $env:USERPROFILE '.claude\skills\kairos-pitch'
if (-not (Test-Path $dst)) { New-Item -ItemType Junction -Path $dst -Target $src | Out-Null }
Get-Item $dst | Select-Object LinkType, Target
```
Expected: `LinkType = Junction`, `Target = …\OneDrive\Claude-Config\skills\kairos-pitch`. (Equivalently, re-run `Setup-This-Machine.bat`, which links every skill dir.)

- [ ] **Step 2: Reload** — restart Claude Code so the new skill is discovered (per the setup script's closing note).

- [ ] **Step 3: Verify discoverability** — in a fresh session, confirm `kairos-pitch` appears in the available skills list / `/kairos-pitch` resolves.

- [ ] **Step 4: Commit** — none (machine-local link; source already committed in 3.1).

### Task 3.3: End-to-end skill run (whimsical seed)

- [ ] **Step 1:** With local KAIROS running and env pointed at `:8787`, invoke `/kairos-pitch` with a one-line seed (e.g. "a game about running a late-night noodle stand for tired ghosts").
- [ ] **Step 2:** Confirm the skill: prints the contract, authors a pitch, writes JSON, previews HTML, asks for confirmation, and on yes posts — appearing in the local Library → Pitches.
- [ ] **Step 3:** Commit — none (operational).

---

## Phase 4 — Converge kairos-iterate onto the skill

### Task 4.1: `post-pitches` delegates to the skill's `postItems`

**Files:** Modify `%OneDrive%\Claude-Config\tools\kairos-iterate\kairos-iterate.js`.

**Interfaces:**
- Consumes: `postItems(cfg, items, opts)` exported from `../../skills/kairos-pitch/kairos-pitch.js`.

- [ ] **Step 1: Replace the inline POST with a delegated call**

In `kairos-iterate.js`, replace the body of the per-file loop inside `postPitches` (the `try { const r = await fetch(... /api/pitches ...) ... }` block) with:
```js
    try {
      const kp = require(path.join(DIR, "..", "..", "skills", "kairos-pitch", "kairos-pitch.js"));
      const res = await kp.postItems(cfg, items, {});
      console.log(res.ok ? `✓ posted ${f}: ${res.count} pitch(es) upserted` : `✗ ${f}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
      if (!res.ok) process.exitCode = 1;
    } catch (e) {
      console.error(`✗ ${f}: ${e.message}`);
      process.exitCode = 1;
    }
```
(The `require` sits inside the loop's try so a missing skill fails that file gracefully rather than crashing the whole run. `postItems` fetches the contract and validates before posting — the routine now gets fail-fast validation it didn't have before.)

- [ ] **Step 2: Verify the routine still posts existing batches** (local server running, env pointed at `:8787`)

```bash
node "%OneDrive%\Claude-Config\tools\kairos-iterate\kairos-iterate.js" post-pitches
```
Expected: `✓ posted 2026-07-06.json: N pitch(es) upserted` — same behavior as before, now routed through the skill. Confirm via `node kairos-pitch.js list`.

- [ ] **Step 3: Commit** — `refactor(kairos-iterate): delegate pitch posting to kairos-pitch skill`.

### Task 4.2: Update `ROUTINE.md` Step 1 to invoke the skill

**Files:** Modify `%OneDrive%\Claude-Config\tools\kairos-iterate\ROUTINE.md`.

- [ ] **Step 1: Rewrite Step 1 item 2–3** so authoring goes through the skill

Replace the "To author one" / "Post" bullets in **Step 1 — PITCHES INTO KAIROS** with:
```markdown
2. **To author a batch:** for each candidate loop, invoke the `kairos-pitch` skill with the gathered Radar/Brief/Plan context and `--auto` (batch mode: it validates and posts without an interactive confirm). Use one shared `pitchDate`/`batch` = `<date>` and `source` = `"kairos-iterate <date>"`. The skill reads the live contract, so taxonomy stays current. (Legacy `pitches\*.json` batches still post via `post-pitches`, which now routes through the same skill.)
3. **Post:** `node "<DIR>\kairos-iterate.js" post-pitches` still upserts every `pitches\*.json` (now via the skill's validated poster). Prefer authoring new pitches through `/kairos-pitch` directly.
```

- [ ] **Step 2: Verify** — read back; confirm Step 1 references `/kairos-pitch` and the `post-pitches` note is consistent with Task 4.1.

- [ ] **Step 3: Commit** — `docs(kairos-iterate): route Friday pitch step through kairos-pitch skill`.

---

## Phase 5 — Delete / curate (KAIROS backend + skill CLI)

Backend changes go on a git branch in the KAIROS repo and merge via CI. The skill's `delete`/`list` commands already exist (Task 1.5); this phase gives them a real endpoint and verifies end-to-end.

### Task 5.1: `deletePitch` query (TDD)

**Files:**
- Modify: `app/server/src/queries/index.ts` (after `publishPitch`, ~line 1005)
- Test: `app/server/test/pitches.test.ts`

**Interfaces:**
- Produces: `deletePitch(db: Querier, slug: string): Promise<boolean>` — true if a row was removed.

- [ ] **Step 1: Write the failing test** — add to `pitches.test.ts` inside the "P1" describe:

```ts
  it("deletePitch removes a row and reports whether it existed", async () => {
    const db = await freshMemoryDb();
    await q.publishPitch(db, base);
    expect(await q.deletePitch(db, "salvage-line")).toBe(true);
    expect(await q.getPitches(db)).toEqual([]);
    expect(await q.deletePitch(db, "salvage-line")).toBe(false); // already gone
  });
```

- [ ] **Step 2: Run test to verify it fails** — `npm -w server run test -- pitches.test.ts`
Expected: FAIL — `q.deletePitch is not a function`.

- [ ] **Step 3: Write minimal implementation** — append to `queries/index.ts`:

```ts
export async function deletePitch(db: Querier, slug: string): Promise<boolean> {
  const rows = await db.query("DELETE FROM pitches WHERE slug = $1 RETURNING slug", [slug]);
  return rows.length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npm -w server run test -- pitches.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(pitches): deletePitch query"` (on branch `feat/pitches-delete`; create it first with `git switch -c feat/pitches-delete`).

### Task 5.2: `DELETE /api/pitches/:slug` on the Express app (TDD)

**Files:**
- Modify: `app/server/src/api/app.ts` (after the `app.post("/api/pitches" …)` block, ~line 109)
- Test: `app/server/test/pitches.test.ts`

**Interfaces:**
- Consumes: `q.deletePitch`.

- [ ] **Step 1: Write the failing test** — add a new describe to `pitches.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails** — `npm -w server run test -- pitches.test.ts`
Expected: FAIL — the DELETE returns 404 with token before the route exists (or 401→ then 404 mismatch); the 200 assertion fails.

- [ ] **Step 3: Write minimal implementation** — add to `app.ts` after the pitches POST handler:

```ts
  app.delete("/api/pitches/:slug", async (req, res) => {
    const token = process.env.PUBLISH_TOKEN;
    const auth = req.headers.authorization || "";
    if (!token || auth !== `Bearer ${token}`) return res.status(401).json({ error: "unauthorized" });
    try {
      const deleted = await q.deletePitch(db, req.params.slug);
      if (!deleted) return res.status(404).json({ error: "not found" });
      res.json({ ok: true, deleted: req.params.slug });
    } catch (e) {
      res.status(400).json({ error: String(e) });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes** — `npm -w server run test -- pitches.test.ts` → PASS.

- [ ] **Step 5: Commit** — `feat(pitches): DELETE /api/pitches/:slug on Express app`.

### Task 5.3: Mirror DELETE in the Netlify Function + keep route parity green

**Files:**
- Modify: `app/netlify/functions/api.ts` (add a DELETE branch before `if (path === "/pitches")`, ~line 64)

**Interfaces:**
- Consumes: `q.deletePitch`.

- [ ] **Step 1: Add the mirrored branch** — in `api.ts`, immediately before `if (req.method === "POST" && path === "/pitches") {`:

```ts
    if (req.method === "DELETE" && path.startsWith("/pitches/")) {
      const token = process.env.PUBLISH_TOKEN;
      const auth = req.headers.get("authorization") || "";
      if (!token || auth !== `Bearer ${token}`) return json({ error: "unauthorized" }, 401);
      const slug = decodeURIComponent(path.replace("/pitches/", ""));
      const deleted = await q.deletePitch(db, slug);
      return deleted ? json({ ok: true, deleted: slug }) : json({ error: "not found" }, 404);
    }
```
(Canonicalizes to `DELETE /pitches/:p` in both the Express stack scan and the Function source scan, so parity holds with no `KNOWN_PROD_ONLY` entry.)

- [ ] **Step 2: Run the route-parity test** — `npm -w server run test -- routeParity.test.ts`
Expected: PASS — "every dev route is served in prod" and "prod exposes no route absent from dev" both green.

- [ ] **Step 3: Run the full server suite + build gate**

```bash
npm -w server run test
npm run build
```
Expected: all pass (server vitest + web typecheck/bundle).

- [ ] **Step 4: Commit + push branch + open PR**

```bash
git add -A
git commit -m "feat(pitches): mirror DELETE in Netlify Function (route parity)"
git push -u origin feat/pitches-delete
gh pr create --fill --title "feat(pitches): token-gated DELETE /api/pitches/:slug"
```

- [ ] **Step 5: STOP for the user.** CI must go green and the user merges + deploys (prod deploy is user-gated per project ops). Do not merge or deploy autonomously.

### Task 5.4: Verify `list`/`delete` end-to-end against local server

**Files:** none.

- [ ] **Step 1:** With the branch checked out and local dev running (`npm run dev`, `PUBLISH_TOKEN=local-dev-token`), post the Phase-2 fixture again if needed, then:

```powershell
$env:KAIROS_API_URL="http://localhost:8787"; $env:PUBLISH_TOKEN="local-dev-token"
node kairos-pitch.js list
node kairos-pitch.js delete haunted-manor-tidy-20260706
node kairos-pitch.js list
```
Expected: first `list` shows the pitch; `delete` prints `✓ deleted …`; second `list` no longer shows it (and the local Library → Pitches no longer renders it).

- [ ] **Step 2:** Delete a non-existent slug → expected `✗ HTTP 404 …` and non-zero exit.

- [ ] **Step 3: Commit** — none (operational; SKILL.md cleanup section already covers this in Task 3.1).

### Task 5.5: Final review pass

- [ ] **Step 1:** Re-read `SKILL.md`; confirm the cleanup section matches the shipped `list`/`delete` behavior and the "deletion is permanent" note is present.
- [ ] **Step 2:** Confirm the plan's Global Constraints all hold in the built artifacts (no hardcoded enums, config chain reused, junction created, output local).
- [ ] **Step 3: Done** — summarize what shipped and what remains user-gated (prod POST of real pitches; merge+deploy of the DELETE PR).

---

## Self-Review Notes

- **Spec coverage:** skill brain (P3) ✓, CLI hands with contract/validate/preview/post (P1) ✓, prove-the-pipe (P2) ✓, HTML preview card per house style (P1.4/P2) ✓, seed-only + honest evidence (SKILL.md) ✓, draft→confirm + `--auto` (SKILL.md) ✓, prod + runtime contract (Global Constraints) ✓, kairos-iterate refactor (P4) ✓, delete/curate backend + CLI (P5) ✓, route parity preserved (P5.3) ✓, skill registration mechanism resolved as a junction (P3.2) ✓.
- **Type consistency:** `postItems`, `fetchContract`, `validateAgainstContract`, `slugify`, `parseArgs`, `buildPreviewHtml`, `deletePitch` names are used identically across tasks. The CLI's validation mirrors `validatePitchInput` in `shared/src/contract.ts`.
- **Open at build time:** confirm the local `PUBLISH_TOKEN` used to start `npm run dev` matches the CLI env (Task 2.1 note); confirm OneDrive is/ isn't a git repo on this machine for the "commit" steps in Phases 1/3/4 (fall back to "files saved" if not).
