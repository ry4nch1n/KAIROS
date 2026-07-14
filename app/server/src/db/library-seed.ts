// Curated, real entries for the Library → Prototypes collection.
// `created_at` = the prototype's Netlify publish date (decoded from its deploy).
// `media_url` doubles as the natural key so the inserter is idempotent — safe to run
// on every Neon migrate (and after the local seed truncate) without duplicating rows.
//
// This list is the SOURCE OF TRUTH for the KAIROS prototype cards: `ensureLibraryPrototypes`
// heals every field (title/summary/tags/status/image) against it on each migrate, so a
// routine post that lands with a bad encoding or a stale title converges back to the clean,
// standardized card within a day. Naming is standardized to `<Name> — <Verb-noun> Toy`
// (no code-name echo). Cards not in this list (newer routine prototypes) are left untouched.
import type { Querier } from "./db.ts";

const ART = "https://kairos-pitch-art.netlify.app";
const PROTO = "https://kairos-prototypes.netlify.app";
export const LIBRARY_PROTOTYPES = [
  {
    kind: "prototype",
    title: "Hearthspeak — Loop Toy",
    summary:
      "The pitch's kill-gate toy: 10 magic words, one glyph-lit room. Compose sentences (Element + Shape + Behaviour + Modifier), bind them to spellbook pages, cast at props — every pairwise combo hand-authored. Tests whether combining two known words produces a grin, and whether prepare-then-cast feels thoughtful. Browser-playable.",
    mediaUrl: `${PROTO}/hearthspeak-20260711/`,
    imageUrl: `${ART}/hearthspeak-20260711/header.png`,
    tags: ["Hearthspeak", "extraction-lite", "browser"],
    status: "validated",
    date: "2026-07-12",
  },
  {
    kind: "prototype",
    title: "Ferrywick — Loop Toy",
    summary:
      'v2.1 rework — visible shoals and deep channels (lines flood by the water they cross, so route choice is real), amber flood countdowns, a low-tide causeway gift, and a five-lines-for-six-villages budget so someone is always cut off: constant triage, no set-and-forget network. Loop feel-test for the "ferrywick-20260711" pitch. Browser-playable. Verdict 2026-07-14: shelved — with the loop finally forced, it plays as frantic link management: many actions, little satisfaction, and readability still strains under pressure. The tide-triage core is disproven, not just the presentation.',
    mediaUrl: `${PROTO}/ferrywick-20260711/`,
    imageUrl: `${ART}/ferrywick-20260711/header.png`,
    tags: ["Ferrywick", "route-planning", "browser"],
    status: "shelved",
    date: "2026-07-14",
  },
  {
    kind: "prototype",
    title: "Overflow — Loop Toy",
    summary:
      'v2 rework — now the pitched game: machines work by themselves; your only verb is bolting each delivered machine into a permanent floor slot along the belt. The belt is a timeline (op chains meet stations in order), so early sprawl compounds as mid-shift contracts drift to new work types. Tests whether sticky placement gives calm, compounding pressure — not reflex panic. Loop feel-test for the "overflow-20260710" pitch. Browser-playable.',
    mediaUrl: `${PROTO}/overflow-20260710/`,
    imageUrl: `${ART}/overflow-20260710/header.png`,
    tags: ["Overflow", "automation-under-pressure", "browser"],
    status: "shipped",
    date: "2026-07-14",
  },
  {
    kind: "prototype",
    title: "Solar Forge — Globe Toy",
    summary:
      "Draw-a-connection logistics toy on a day/night planet — wire generators through forges to colonies to deliver energy cells before the terminator or your link budget runs out. Browser-playable.",
    mediaUrl: "https://solar-forge-globe-toy.netlify.app",
    imageUrl: `${ART}/solar-forge-20260706/header.png`,
    tags: ["Solar Forge", "logistics", "browser"],
    status: "prototyping",
    date: "2026-07-08",
  },
] as const;

// Legacy prototype cards to remove from the collection (non-KAIROS test builds that predate
// the pitch pipeline). Keyed on media_url; deletion is idempotent — a no-op once they're gone.
export const RETIRED_PROTOTYPE_URLS = [
  "https://peregrine-glider-prototype.netlify.app",
  "https://silver-palace-deduction-proto.netlify.app",
] as const;

// Converge the Prototypes collection to the curated set. Idempotent, so both the local seed
// and the prod migrate can call it freely:
//   1. delete retired cards,
//   2. insert any curated card not already present (keyed on media_url),
//   3. heal ALL fields of the curated cards so a corrupted/stale routine post is corrected.
export async function ensureLibraryPrototypes(db: Querier): Promise<void> {
  for (const url of RETIRED_PROTOTYPE_URLS) {
    await db.query(`DELETE FROM library_items WHERE media_url = $1`, [url]);
  }
  for (const p of LIBRARY_PROTOTYPES) {
    await db.query(
      `INSERT INTO library_items (kind, title, summary, media_url, image_url, tags, status, created_at)
       SELECT $1, $2, $3, $4, $5, $6::text[], $7, $8::timestamptz
       WHERE NOT EXISTS (SELECT 1 FROM library_items WHERE media_url = $4)`,
      [p.kind, p.title, p.summary, p.mediaUrl, p.imageUrl, [...p.tags], p.status, p.date],
    );
    await db.query(
      `UPDATE library_items SET
         kind = $2, title = $3, summary = $4, image_url = $5, tags = $6::text[], status = $7,
         created_at = $8::timestamptz
       WHERE media_url = $1`,
      [p.mediaUrl, p.kind, p.title, p.summary, p.imageUrl, [...p.tags], p.status, p.date],
    );
  }
}
