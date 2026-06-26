// Apply schema to the configured database (Neon in prod via DATABASE_URL).
// Idempotent: schema uses CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE VIEW.
import { appDb, applySchema, usingNeon } from "./db.ts";

const db = await appDb();
await applySchema(db);
console.log(`✔ schema applied to ${usingNeon() ? "Neon (DATABASE_URL)" : "local PGlite"}`);
process.exit(0);
