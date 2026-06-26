// Local dev API server. Prod uses the same handlers via Netlify Functions.
import { createApp } from "./api/app.ts";
import { appDb, applySchema, usingNeon } from "./db/db.ts";

const PORT = Number(process.env.PORT || 8787);
const db = await appDb();
if (!usingNeon()) await applySchema(db); // ensure local file DB has schema
const app = createApp(db);
app.listen(PORT, () => console.log(`✔ KAIROS API on http://localhost:${PORT}`));
