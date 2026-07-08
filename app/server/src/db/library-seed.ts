// Curated, real entries for the Library → Prototypes collection.
// `created_at` = the prototype's Netlify publish date (decoded from its deploy).
// `media_url` doubles as the natural key so the inserter is idempotent — safe to run
// on every Neon migrate (and after the local seed truncate) without duplicating rows.
import type { Querier } from "./db.ts";

export const LIBRARY_PROTOTYPES = [
  {
    kind: "prototype",
    title: "Peregrine — FPS Prototype",
    summary:
      "First-person shooter test build — WASD movement, mouse aim, unlimited ammo against targets. Browser-playable.",
    mediaUrl: "https://peregrine-glider-prototype.netlify.app",
    tags: ["Peregrine", "FPS", "browser"],
    status: "shipped",
    date: "2026-03-26",
  },
  {
    kind: "prototype",
    title: "Silver Palace — Case of Grimm's Death",
    summary:
      "Interactive deduction prototype — examine evidence cards and link clues in a 'Mind Palace' to solve a murder. Browser-playable.",
    mediaUrl: "https://silver-palace-deduction-proto.netlify.app",
    tags: ["Silver Palace", "deduction", "browser"],
    status: "shipped",
    date: "2026-03-17",
  },
  {
    kind: "prototype",
    title: "Solar Forge — Globe Toy (Phase 0)",
    summary:
      "Draw-a-connection logistics toy on a day/night planet — wire generators through forges to colonies to deliver energy cells before the terminator or your link budget runs out. Browser-playable.",
    mediaUrl: "https://solar-forge-globe-toy.netlify.app",
    tags: ["Solar Forge", "logistics", "browser"],
    status: "shipped",
    date: "2026-07-08",
  },
] as const;

// Insert any prototype not already present (keyed on media_url). Idempotent: running
// it repeatedly is a no-op, so both the local seed and the prod migrate can call it.
export async function ensureLibraryPrototypes(db: Querier): Promise<void> {
  for (const p of LIBRARY_PROTOTYPES) {
    await db.query(
      `INSERT INTO library_items (kind, title, summary, media_url, tags, status, created_at)
       SELECT $1, $2, $3, $4, $5::text[], $6, $7::timestamptz
       WHERE NOT EXISTS (SELECT 1 FROM library_items WHERE media_url = $4)`,
      [p.kind, p.title, p.summary, p.mediaUrl, [...p.tags], p.status, p.date]
    );
  }
}
