// Apply schema to the configured database (Neon in prod via DATABASE_URL).
// Idempotent: schema uses CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE VIEW.
import { appDb, applySchema, usingNeon } from "./db.ts";
import { ensureLibraryPrototypes } from "./library-seed.ts";

const db = await appDb();
await applySchema(db);
// Idempotent content seed: keeps the curated Prototypes collection present in Neon
// without a web deploy (GET /api/library + the UI are already live — only data is new).
await ensureLibraryPrototypes(db);
console.log(`✔ schema applied to ${usingNeon() ? "Neon (DATABASE_URL)" : "local PGlite"}`);
process.exit(0);
