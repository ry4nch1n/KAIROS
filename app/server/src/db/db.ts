// DB layer. Local dev = PGlite (in-process Postgres). Prod = Neon/Postgres via `pg`.
// Selected by presence of DATABASE_URL. Same SQL either way.
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Querier {
  query(text: string, params?: unknown[]): Promise<Record<string, any>[]>;
  exec(sql: string): Promise<void>;
}

// Lazy: only read the .sql when applySchema is actually called (migrate/seed/local).
// Keeping this out of module scope is essential — the bundled serverless function
// imports this file for appDb() and must not touch the filesystem at load time.
export async function applySchema(db: Querier): Promise<void> {
  const schema = readFileSync(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");
  await db.exec(schema);
}

// ── PGlite (local) ──
export async function makePglite(dataDir?: string): Promise<Querier> {
  // Variable specifier keeps this dynamic so prod bundlers (Netlify esbuild) don't
  // pull PGlite's wasm into serverless functions — prod uses Neon and never calls this.
  const pkg = "@electric-sql/pglite";
  const { PGlite } = await import(/* @vite-ignore */ pkg);
  if (dataDir) mkdirSync(dataDir, { recursive: true }); // PGlite won't create parent dirs
  const pg = dataDir ? new PGlite(dataDir) : new PGlite(); // no dir = in-memory
  await pg.waitReady;
  return {
    async query(text, params = []) {
      const res = await pg.query(text, params as any[]);
      return res.rows as Record<string, any>[];
    },
    async exec(sql) {
      await pg.exec(sql);
    },
  };
}

// ── Postgres / Neon (prod) ──
export async function makePg(connectionString: string): Promise<Querier> {
  const pg = (await import("pg")).default;
  const ssl = /localhost|127\.0\.0\.1/.test(connectionString)
    ? false
    : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString, ssl });
  return {
    async query(text, params = []) {
      const res = await pool.query(text, params as any[]);
      return res.rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
  };
}

// In-memory DB with schema applied — for tests.
export async function freshMemoryDb(): Promise<Querier> {
  const db = await makePglite();
  await applySchema(db);
  return db;
}

// App singleton (persistent local file, or Neon).
let _app: Promise<Querier> | null = null;
export function appDb(): Promise<Querier> {
  if (_app) return _app;
  const url = process.env.DATABASE_URL;
  _app = url ? makePg(url) : makePglite(process.env.PGLITE_DIR || ".data/kairos");
  return _app;
}

export function usingNeon(): boolean {
  return !!process.env.DATABASE_URL;
}
