// Apply schema to the configured database (Neon in prod via DATABASE_URL).
// Idempotent: schema uses CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE VIEW.
import { appDb, applySchema, usingNeon } from "./db.ts";
import { ensureLibraryPrototypes } from "./library-seed.ts";
import { backfillBriefSourceCounts } from "../queries/library.ts";

const db = await appDb();
await applySchema(db);
// Idempotent content seed: keeps the curated Prototypes collection present in Neon
// without a web deploy (GET /api/library + the UI are already live — only data is new).
await ensureLibraryPrototypes(db);
// Idempotent data backfill (#181): editions published before source counts were derived.
const backfilled = await backfillBriefSourceCounts(db);
if (backfilled) console.log(`✔ backfilled source_count on ${backfilled} brief edition(s)`);
console.log(`✔ schema applied to ${usingNeon() ? "Neon (DATABASE_URL)" : "local PGlite"}`);
process.exit(0);
