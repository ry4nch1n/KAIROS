// Generated documentation reference (#102).
//
// WHY THIS EXISTS. The root docs drifted for weeks with nothing to catch it: on 2026-07-21
// DESIGN.md documented pitch contract v5 while the code was v8 (top-level v10), and two
// shipped surfaces (#90 tag economics, #32 shared auth gate) went unmentioned entirely. Every
// one of those is a MECHANICALLY DERIVABLE fact, so the fix is to stop hand-writing them:
// derive them from source here, and let docsDrift.test.ts fail the suite when the committed
// output no longer matches. That mirrors routeParity.test.ts — an executable invariant rather
// than a prose reminder.
//
// CONTRACT WITH THE TEST: `generateDocs()` is PURE — it reads source files and returns
// {relativePath: contents} without touching the filesystem's docs/ tree. The test calls it
// in-memory and diffs against disk; only the CLI branch at the bottom writes. Keep it pure,
// and keep every collection sorted or in file order, so output is byte-stable across runs.
//
// Regenerate with:  npx tsx app/server/src/scripts/gen-docs.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "../api/app.ts";
import type { Querier } from "../db/db.ts";
import { CONTRACT } from "../../../shared/src/contract.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..", ".."); // scripts → src → server → app → root
const SCHEMA_PATH = join(here, "..", "db", "schema.sql");

const BANNER = (source: string) =>
  `<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: ${source}
     Regenerate: npx tsx app/server/src/scripts/gen-docs.ts
     A drift check (app/server/test/docsDrift.test.ts) fails the suite if this is stale. -->\n`;

// ── API surface ───────────────────────────────────────────────────────────────
// Structural read of the live Express app with a stub Querier — the same trick
// routeParity.test.ts uses, so no DB is needed and the list cannot go stale.
function apiRoutes(): string[] {
  const stub: Querier = { query: async () => [], exec: async () => {} };
  const app = createApp(stub) as any;
  const stack = (app._router ?? app.router)?.stack ?? [];
  const out = new Set<string>();
  for (const layer of stack) {
    if (!layer.route) continue; // middleware, not a route
    const path = String(layer.route.path);
    for (const m of Object.keys(layer.route.methods)) {
      if (layer.route.methods[m]) out.add(`${m.toUpperCase()} ${path}`);
    }
  }
  return [...out].sort();
}

function renderApi(): string {
  const routes = apiRoutes();
  const rows = routes.map((r) => {
    const i = r.indexOf(" ");
    return `| \`${r.slice(0, i)}\` | \`${r.slice(i + 1)}\` |`;
  });
  return `${BANNER("app/server/src/api/app.ts (Express router, read structurally)")}
# API reference

${routes.length} route${routes.length === 1 ? "" : "s"} served by the Express app factory. The
Netlify Function mirrors this surface; \`routeParity.test.ts\` fails the suite if the two drift.

| Method | Path |
|--------|------|
${rows.join("\n")}
`;
}

// ── Data contract ─────────────────────────────────────────────────────────────
// CONTRACT is a pure literal, so it is imported (never regexed) and walked generically:
// a new enum shows up here automatically without editing this generator.
function renderContract(): string {
  const versions: string[] = [];
  const enums: string[] = [];

  const walk = (node: any, path: string[]) => {
    for (const [key, value] of Object.entries(node)) {
      const trail = [...path, key];
      if (key === "version" && typeof value === "number") {
        versions.push(`| \`${path.join(".") || "(top level)"}\` | **${value}** |`);
      } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        enums.push(
          `### \`${trail.join(".")}\`\n\n${value.length} value${value.length === 1 ? "" : "s"}: ` +
            `${value.map((v) => `\`${v}\``).join(" · ")}\n`,
        );
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        walk(value, trail);
      }
    }
  };
  walk(CONTRACT, []);

  return `${BANNER("app/shared/src/contract.ts (imported, not parsed)")}
# Data contract reference

The contract is the coordination mechanism: it is served at \`GET /api/contract\`, enforced on
write for pitches, and asserted by \`contract.test.ts\`. **Changing a shape or adding a taxonomy
value means bumping the relevant version in the same commit.**

## Versions

| Scope | Version |
|-------|---------|
${versions.join("\n")}

## Taxonomies

${enums.join("\n")}`;
}

// ── Database schema ───────────────────────────────────────────────────────────
interface Column {
  name: string;
  type: string;
  refs: string | null;
}
interface Table {
  name: string;
  columns: Column[];
}

const CONSTRAINT_START =
  /^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CONSTRAINT|CHECK|EXCLUDE|DEFERRABLE)\b/i;

function parseSchema(sql: string): { tables: Table[]; views: string[] } {
  const tables: Table[] = [];
  for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const [, name, body] = m;
    const columns: Column[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.replace(/--.*$/, "").trim().replace(/,$/, "");
      if (!line || CONSTRAINT_START.test(line)) continue;
      const col = line.match(/^(\w+)\s+([A-Za-z][\w ]*(?:\([^)]*\))?)/);
      if (!col) continue;
      const ref = line.match(/REFERENCES\s+(\w+)\s*\(/i);
      columns.push({ name: col[1], type: col[2].trim().toUpperCase(), refs: ref ? ref[1] : null });
    }
    tables.push({ name, columns });
  }
  const views = [...sql.matchAll(/CREATE(?: OR REPLACE)? VIEW\s+(\w+)/g)].map((m) => m[1]);
  return { tables, views };
}

// Mermaid renders natively on GitHub — no build step, no hosting, no Netlify credits. And
// because this diagram is DERIVED, it cannot drift the way the hand-drawn ASCII in DESIGN.md did.
function mermaidEr(tables: Table[]): string {
  const lines: string[] = ["erDiagram"];
  for (const t of tables) {
    for (const c of t.columns) {
      if (c.refs) lines.push(`  ${c.refs} ||--o{ ${t.name} : "${c.name}"`);
    }
  }
  for (const t of tables) {
    lines.push(`  ${t.name} {`);
    for (const c of t.columns) lines.push(`    ${c.type.split(" ")[0].toLowerCase()} ${c.name}`);
    lines.push("  }");
  }
  return lines.join("\n");
}

function renderSchema(): string {
  const { tables, views } = parseSchema(readFileSync(SCHEMA_PATH, "utf8"));
  const detail = tables
    .map((t) => {
      const rows = t.columns
        .map((c) => `| \`${c.name}\` | \`${c.type}\` | ${c.refs ? `→ \`${c.refs}\`` : ""} |`)
        .join("\n");
      return `### \`${t.name}\`\n\n| Column | Type | References |\n|--------|------|------------|\n${rows}\n`;
    })
    .join("\n");

  return `${BANNER("app/server/src/db/schema.sql")}
# Database schema reference

${tables.length} tables${views.length ? `, ${views.length} view (\`${views.join("`, `")}\`)` : ""}.
The same schema runs on PGlite locally and Neon in production. **Migrations are additive only** —
the implement loop's guard rejects any \`DROP\`, \`RENAME\`, or type narrowing.

## Entity relationships

\`\`\`mermaid
${mermaidEr(tables)}
\`\`\`

## Tables

${detail}`;
}

// ── Architecture overview ─────────────────────────────────────────────────────
// Derived from real counts so it can't quietly describe a system that no longer exists.
function renderArchitecture(): string {
  const { tables, views } = parseSchema(readFileSync(SCHEMA_PATH, "utf8"));
  const routes = apiRoutes();
  const groups = [...new Set(routes.map((r) => r.split(" ")[1].split("/")[2] ?? "(root)"))]
    .filter(Boolean)
    .sort();

  return `${BANNER("derived from schema.sql + the Express router")}
# Architecture reference

Crawlers append snapshots; analytics queries read them; one API serves both entry points; the
SPA renders four panels. ${tables.length} tables, ${views.length} view, ${routes.length} routes.

\`\`\`mermaid
flowchart LR
  subgraph Sources
    CG[CrazyGames]
    PK[Poki]
    ST[Steam]
  end
  CG --> CR[Crawler adapters]
  PK --> CR
  ST --> CR
  CR -->|append-only| DB[(Postgres<br/>PGlite or Neon)]
  DB --> Q[Analytics queries<br/>server/src/queries]
  Q --> EX[Express app<br/>local dev]
  Q --> NF[Netlify Function<br/>production]
  EX --> UI[React SPA]
  NF --> UI
  UI --> R[Radar]
  UI --> B[Brief]
  UI --> L[Library]
  UI --> V[Revenue]
\`\`\`

## Route groups

${groups.map((g) => `- \`/api/${g}\``).join("\n")}

## Invariants worth knowing

- **Snapshots are append-only** — trends are computed over time, never overwritten.
- **The API surface is defined twice** (Express + Netlify Function); \`routeParity.test.ts\` fails on drift.
- **The contract is versioned**; a shape or taxonomy change must bump its version in the same commit.
- **This file is generated** — edit the generator, not the output.
`;
}

// ── entry ─────────────────────────────────────────────────────────────────────
/** Pure: returns {relativePath: contents}. The drift test calls this and diffs against disk. */
export function generateDocs(): Record<string, string> {
  return {
    "docs/reference/api.md": renderApi(),
    "docs/reference/contract.md": renderContract(),
    "docs/reference/schema.md": renderSchema(),
    "docs/reference/architecture.md": renderArchitecture(),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const files = generateDocs();
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(REPO_ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf8");
    console.log(`✓ ${rel}`);
  }
  console.log(`\n${Object.keys(files).length} files written.`);
}
