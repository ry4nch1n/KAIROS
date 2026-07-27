// Brief editions + steering, pitches, and Library CRUD. Split out of the former monolithic
// index.ts (issue #33, pure code movement).
import type { Querier } from "../db/db.ts";
import type {
  BriefEditionMeta,
  BriefEdition,
  BriefSteering,
  Pitch,
  PitchInput,
  LibraryItemInput,
} from "shared";
import { assertPitchInput, validateBriefPayload } from "../../../shared/src/contract.ts";
import { num } from "./shared.ts";

// ── Brief ──
export async function getBriefEditions(db: Querier): Promise<BriefEditionMeta[]> {
  const rows = await db.query(
    `SELECT id, edition_date, weekday, brief_type, source_count FROM brief_editions ORDER BY edition_date DESC`,
  );
  return rows.map((r) => ({
    id: num(r.id),
    editionDate:
      typeof r.edition_date === "string"
        ? r.edition_date.slice(0, 10)
        : new Date(r.edition_date).toISOString().slice(0, 10),
    weekday: r.weekday,
    briefType: r.brief_type,
    sourceCount: num(r.source_count),
  }));
}

export interface PublishInput {
  editionDate: string;
  weekday?: string;
  briefType?: string;
  payload: unknown;
  renderedHtml?: string | null;
  localPath?: string | null;
  sourceCount?: number | null;
}

export async function publishEdition(db: Querier, e: PublishInput): Promise<void> {
  if (!e?.editionDate || !e?.payload) throw new Error("editionDate and payload required");
  // Advisory only — warn on format drift but never reject, so a lagging brief can't blank the dashboard.
  const bv = validateBriefPayload(e.payload);
  if (bv.warnings.length)
    console.warn(`[contract] brief ${e.editionDate}: ${bv.warnings.join("; ")}`);
  await db.query(
    `INSERT INTO brief_editions(edition_date, weekday, brief_type, payload, rendered_html, local_path, source_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (edition_date, brief_type) DO UPDATE SET
       weekday = EXCLUDED.weekday, payload = EXCLUDED.payload, rendered_html = EXCLUDED.rendered_html,
       local_path = EXCLUDED.local_path, source_count = EXCLUDED.source_count, created_at = now()`,
    [
      e.editionDate,
      e.weekday ?? null,
      e.briefType ?? "indie",
      JSON.stringify(e.payload),
      e.renderedHtml ?? null,
      e.localPath ?? null,
      e.sourceCount ?? null,
    ],
  );
}

export async function getBriefSteering(db: Querier): Promise<BriefSteering> {
  try {
    const rows = await db.query(`SELECT flags, updated_at FROM brief_steering WHERE id = 1`);
    if (!rows.length) return { flags: [], updatedAt: null };
    const raw = typeof rows[0].flags === "string" ? JSON.parse(rows[0].flags) : rows[0].flags;
    return {
      flags: Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [],
      updatedAt: rows[0].updated_at ? new Date(rows[0].updated_at).toISOString() : null,
    };
  } catch {
    return { flags: [], updatedAt: null }; // table not migrated yet → behave as empty
  }
}

export async function setBriefSteering(db: Querier, flags: string[]): Promise<void> {
  const clean = (Array.isArray(flags) ? flags : [])
    .filter((x) => typeof x === "string")
    .slice(0, 50);
  await db.query(
    `INSERT INTO brief_steering(id, flags, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET flags = EXCLUDED.flags, updated_at = now()`,
    [JSON.stringify(clean)],
  );
}

export async function getBriefEdition(
  db: Querier,
  editionDate: string,
): Promise<BriefEdition | null> {
  const rows = await db.query(
    `SELECT id, edition_date, weekday, brief_type, source_count, payload FROM brief_editions WHERE edition_date = $1 ORDER BY brief_type LIMIT 1`,
    [editionDate],
  );
  if (!rows.length) return null;
  const r = rows[0];
  const payload = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
  return {
    id: num(r.id),
    editionDate:
      typeof r.edition_date === "string"
        ? r.edition_date.slice(0, 10)
        : new Date(r.edition_date).toISOString().slice(0, 10),
    weekday: r.weekday,
    briefType: r.brief_type,
    sourceCount: num(r.source_count),
    payload,
  };
}

// ---- pitches (Library "Pitches" collection) ----

function rowToPitch(r: any): Pitch {
  const d = r.pitch_date;
  return {
    id: num(r.id),
    slug: r.slug,
    rank: r.rank === null || r.rank === undefined ? null : num(r.rank),
    title: r.title,
    oneLiner: r.one_liner ?? null,
    loopFamily: r.loop_family ?? null,
    platformLadder: r.platform_ladder ?? null,
    status: r.status ?? "proposed",
    badge: r.badge ?? null,
    loopDetail: r.loop_detail ?? null,
    browserMvp: r.browser_mvp ?? null,
    steamLadder: r.steam_ladder ?? null,
    evidence: r.evidence ?? null,
    risk: r.risk ?? null,
    browserFit: r.browser_fit === null || r.browser_fit === undefined ? null : num(r.browser_fit),
    steamFit: r.steam_fit === null || r.steam_fit === undefined ? null : num(r.steam_fit),
    buildEase: r.build_ease === null || r.build_ease === undefined ? null : num(r.build_ease),
    provenance: r.provenance ?? null,
    grayBoxDays:
      r.gray_box_days === null || r.gray_box_days === undefined ? null : num(r.gray_box_days),
    contentScope: r.content_scope ?? null,
    techRisk: r.tech_risk ?? null,
    hook: r.hook ?? null,
    marketability:
      r.marketability === null || r.marketability === undefined ? null : num(r.marketability),
    founderFit: r.founder_fit === null || r.founder_fit === undefined ? null : num(r.founder_fit),
    whyMe: r.why_me ?? null,
    pitchDate: typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10),
    batch: r.batch ?? null,
    source: r.source ?? null,
    setting: r.setting ?? null,
    artStyle: r.art_style ?? null,
    codeName: r.code_name ?? null,
    headerUrl: r.header_url ?? null,
    shotUrl: r.shot_url ?? null,
  };
}

export async function getPitches(db: Querier): Promise<Pitch[]> {
  try {
    const rows = await db.query(
      `SELECT id, slug, rank, title, one_liner, loop_family, platform_ladder, status, badge,
              loop_detail, browser_mvp, steam_ladder, evidence, risk, browser_fit, steam_fit,
              build_ease, provenance, gray_box_days, content_scope, tech_risk, hook, marketability,
              founder_fit, why_me, pitch_date, batch, source, setting, art_style, code_name, header_url, shot_url
       FROM pitches
       ORDER BY pitch_date DESC, COALESCE(rank, 999) ASC, id ASC`,
    );
    return rows.map(rowToPitch);
  } catch {
    return []; // table not migrated yet → behave as empty
  }
}

export async function publishPitch(db: Querier, p: PitchInput): Promise<void> {
  assertPitchInput(p); // strict: validates required fields + taxonomy enums + score ranges against the contract
  await db.query(
    `INSERT INTO pitches
       (slug, rank, title, one_liner, loop_family, platform_ladder, status, badge,
        loop_detail, browser_mvp, steam_ladder, evidence, risk, browser_fit, steam_fit,
        build_ease, provenance, pitch_date, batch, source, setting, art_style, code_name, header_url, shot_url,
        gray_box_days, content_scope, tech_risk, hook, marketability, founder_fit, why_me, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32, now())
     ON CONFLICT (slug) DO UPDATE SET
       rank = EXCLUDED.rank, title = EXCLUDED.title, one_liner = EXCLUDED.one_liner,
       loop_family = EXCLUDED.loop_family, platform_ladder = EXCLUDED.platform_ladder,
       status = EXCLUDED.status, badge = EXCLUDED.badge, loop_detail = EXCLUDED.loop_detail,
       browser_mvp = EXCLUDED.browser_mvp, steam_ladder = EXCLUDED.steam_ladder,
       evidence = EXCLUDED.evidence, risk = EXCLUDED.risk, browser_fit = EXCLUDED.browser_fit,
       steam_fit = EXCLUDED.steam_fit, build_ease = EXCLUDED.build_ease, provenance = EXCLUDED.provenance,
       pitch_date = EXCLUDED.pitch_date, batch = EXCLUDED.batch, source = EXCLUDED.source,
       setting = EXCLUDED.setting, art_style = EXCLUDED.art_style, code_name = EXCLUDED.code_name,
       header_url = EXCLUDED.header_url, shot_url = EXCLUDED.shot_url,
       gray_box_days = EXCLUDED.gray_box_days, content_scope = EXCLUDED.content_scope,
       tech_risk = EXCLUDED.tech_risk, hook = EXCLUDED.hook, marketability = EXCLUDED.marketability,
       founder_fit = EXCLUDED.founder_fit, why_me = EXCLUDED.why_me,
       updated_at = now()`,
    [
      p.slug,
      p.rank ?? null,
      p.title,
      p.oneLiner ?? null,
      p.loopFamily ?? null,
      p.platformLadder ?? "browser->steam",
      p.status ?? "proposed",
      p.badge ?? null,
      p.loopDetail ?? null,
      p.browserMvp ?? null,
      p.steamLadder ?? null,
      p.evidence ?? null,
      p.risk ?? null,
      p.browserFit ?? null,
      p.steamFit ?? null,
      p.buildEase ?? null,
      p.provenance ?? null,
      p.pitchDate,
      p.batch ?? null,
      p.source ?? null,
      p.setting ?? null,
      p.artStyle ?? null,
      p.codeName ?? null,
      p.headerUrl ?? null,
      p.shotUrl ?? null,
      p.grayBoxDays ?? null,
      p.contentScope ?? null,
      p.techRisk ?? null,
      p.hook ?? null,
      p.marketability ?? null,
      p.founderFit ?? null,
      p.whyMe ?? null,
    ],
  );
}

// Read the Library collections. A card linked to a pitch (`pitch_slug`) DERIVES its status
// from that pitch, so a prototype card and the leaderboard can never disagree — they read the
// same field. Unlinked cards keep their own stored status (other collections own theirs).
//
// This lives here rather than inline in the two API entry points on purpose: the SQL used to
// be duplicated verbatim in app.ts and the Netlify function, and routeParity only diffs route
// SURFACES, not query bodies — so a join added to one and not the other would drift silently.
export async function libraryItems(db: Querier): Promise<Record<string, any>[]> {
  return db.query(
    `SELECT li.id, li.kind, li.title, li.summary, li.tags,
            COALESCE(p.status, li.status) AS status,
            li.pitch_slug AS "pitchSlug",
            li.media_url  AS "mediaUrl",
            li.image_url  AS "imageUrl",
            to_char(li.created_at, 'YYYY-MM-DD') AS date
       FROM library_items li
       LEFT JOIN pitches p ON p.slug = li.pitch_slug
      ORDER BY li.created_at DESC`,
  );
}

// Publish/upsert a library item (e.g. a hosted prototype card). Keyed on media_url —
// the same natural key the curated seed uses — so posting is idempotent: a re-post of
// the same hosted URL refreshes the card in place. No unique index exists on media_url,
// so this uses the seed's guarded INSERT + UPDATE pattern instead of ON CONFLICT.
export async function publishLibraryItem(db: Querier, it: LibraryItemInput): Promise<void> {
  const errors: string[] = [];
  for (const f of ["kind", "title", "mediaUrl"] as const) {
    if (!it?.[f] || typeof it[f] !== "string") errors.push(`missing required field: ${f}`);
  }
  if (it?.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(it.date)))
    errors.push("date must be YYYY-MM-DD");
  if (it?.tags != null && !Array.isArray(it.tags)) errors.push("tags must be an array of strings");
  if (errors.length) throw new Error(`library item invalid: ${errors.join("; ")}`);

  await db.query(
    `INSERT INTO library_items (kind, title, summary, media_url, image_url, tags, status, pitch_slug, created_at)
     SELECT $1, $2, $3, $4, $5, $6::text[], $7, $9, COALESCE($8::timestamptz, now())
     WHERE NOT EXISTS (SELECT 1 FROM library_items WHERE media_url = $4)`,
    [
      it.kind,
      it.title,
      it.summary ?? null,
      it.mediaUrl,
      it.imageUrl ?? null,
      it.tags ?? [],
      it.status ?? "draft",
      it.date ?? null,
      it.pitchSlug ?? null,
    ],
  );
  // pitch_slug uses COALESCE so a poster that omits it keeps the existing link rather than
  // unlinking the card (which would silently drop it back to its own stale stored status).
  await db.query(
    `UPDATE library_items SET
       kind = $2, title = $3, summary = $4, image_url = $5, tags = $6::text[], status = $7,
       pitch_slug = COALESCE($9, pitch_slug),
       created_at = COALESCE($8::timestamptz, created_at)
     WHERE media_url = $1`,
    [
      it.mediaUrl,
      it.kind,
      it.title,
      it.summary ?? null,
      it.imageUrl ?? null,
      it.tags ?? [],
      it.status ?? "draft",
      it.date ?? null,
      it.pitchSlug ?? null,
    ],
  );
}

// Curation: remove a pitch by slug. Returns true if a row existed. Token-gated at the route.
export async function deletePitch(db: Querier, slug: string): Promise<boolean> {
  const rows = await db.query("DELETE FROM pitches WHERE slug = $1 RETURNING slug", [slug]);
  return rows.length > 0;
}
