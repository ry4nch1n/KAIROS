// The KAIROS data contract — single source of truth for payload shapes + taxonomy.
//
// Producers read it at run start (GET /api/contract); publish paths validate against
// it; a contract test asserts the code matches it. When a payload shape or the taxonomy
// changes, bump the relevant `version` IN THE SAME COMMIT — that is how "a decision is
// made" becomes visible to every producer. Enums here are the taxonomy: adding a value
// (e.g. a new loop family) is a contract change, on purpose.

export const CONTRACT = {
  // v2: SteamComparable gained `reviewVelocity` (reviews/day, wishlist-velocity proxy — #11).
  // v3: SteamGenreEconomics gained `medianRevenuePerGame` + `meanRevenuePerGame` (#24).
  // v4: pitch v5 read-through — see pitch.version below (scope/hook/founder-fit fields +
  //     the `contentScopes` taxonomy). Also covers the Phase-B analytics payload extensions
  //     (genre supplyTrend, gap supplyRising, Overview/SteamOverview quadrant, economics
  //     conversion) — all additive, read defensively by the client.
  // v5: Overview gained a `settings` facet — a small controlled setting/theme vocabulary
  //     (fantasy, sci-fi, historical, …) derived from existing tags, orthogonal to genre
  //     (#25 first slice). See taxonomy.settings below; additive, read defensively.
  // v6: pitch v6 read-through — see pitch.version below (`validated` pitch status, the
  //     play-tested lead-candidate verdict the leaderboard ranks above `prototyping`).
  version: 6,
  pitch: {
    // v2: added visual-card fields — setting, artStyle, codeName, headerUrl, shotUrl.
    // v3: rating rework — scoreFields d1Fit/steamCeiling/buildCost → browserFit/steamFit/buildEase.
    //     Browser and Steam are co-equal platform-fit axes (a "route compass" that keeps the
    //     Phase-0 strategy routes open), not a single retention proxy. Added `provenance` tag
    //     (market-backed vs design-derived). buildEase is a rename of the old buildCost — same
    //     semantics (higher = cheaper/easier), the old name just contradicted its "Build ease" label.
    // v4: added the `synergy-builder` loop family (spin/deck synergy-engine roguelites, the
    //     Balatro / Luck-be-a-Landlord lineage) — a plan candidate loop the taxonomy didn't hold.
    // v5: read through BOTH lenses of the durable methodology, not just the commercial half.
    //     Scope block — `grayBoxDays` (days to a testable gray-box loop, the Aug kill-gate
    //     clock), `contentScope` (S/M/L vs genre expectation), `techRisk`. Hook — `hook`
    //     (the capsule promise / marketing beat) + `marketability` score (absorbs the residue
    //     of #26's "Grab": first-session pull, distinct from platform fit). Founder fit —
    //     `founderFit` score + `whyMe` (why this holds YOUR attention for months; a
    //     market-perfect concept with no personal pull dies in month four).
    // v6: added the `validated` status — a play-test verdict above `prototyping` (loop proved
    //     out, this is the lead candidate) but short of `shipped`. The leaderboard ranks it
    //     above prototyping; the prototype card already styles it (cyan chip). Additive.
    version: 6,
    loopFamilies: [
      "extraction-lite",
      "automation-under-pressure",
      "wave-defense-prep",
      "cozy-craft",
      "contained-systemic",
      "idle-tycoon",
      "route-planning",
      "synergy-builder",
    ],
    badges: ["recommended", "retention-safe", "cashflow", "cheapest-build"],
    statuses: ["proposed", "prototyping", "validated", "shelved", "shipped"],
    platformLadders: ["browser->steam", "browser-only", "steam-only"],
    provenances: ["market-backed", "design-derived"],
    contentScopes: ["small", "medium", "large"], // content bill vs. what the genre's buyers expect
    // The 1..3 score axes. browserFit/steamFit/buildEase = the platform-fit compass;
    // marketability = first-session hook / capsule pull; founderFit = personal pull + edge.
    scoreFields: ["browserFit", "steamFit", "buildEase", "marketability", "founderFit"],
    scoreMin: 1,
    scoreMax: 3,
    required: ["slug", "title", "pitchDate"],
  },
  briefPayload: {
    version: 1,
    // Fields the News Brief renderer relies on. Brief validation is ADVISORY (warnings,
    // non-blocking) so a format lag can never blank the live dashboard — the renderer
    // degrades defensively and the contract test catches real drift in CI.
    recommended: ["new_notable", "browser", "tooling", "market", "top_signals", "founder_take"],
  },
  taxonomy: {
    // v2: added `settings` — the setting/theme axis (#25). A small controlled vocabulary
    // kept SEPARATE from genre/mechanic (same discipline as the taxonomy split in #7): a
    // game's setting is orthogonal to what it plays like, and market white space often lives
    // at a genre × setting intersection a genre-only view is blind to. Derived server-side by
    // mapping setting-bearing tags into these buckets; the curated per-tag mapping + a full
    // genre × setting matrix are the residual design work (this is the tag-facet first slice).
    version: 2,
    settings: [
      "fantasy",
      "sci-fi",
      "space",
      "cyberpunk",
      "post-apocalyptic",
      "horror",
      "historical",
      "medieval",
      "modern",
      "western",
      "military",
    ],
  },
} as const;

export type Contract = typeof CONTRACT;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ContractValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Strict validation for pitch inputs (the autonomous gate leans on this). */
export function validatePitchInput(p: any): ContractValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!p || typeof p !== "object") return { ok: false, errors: ["pitch must be an object"], warnings };

  for (const f of CONTRACT.pitch.required) {
    if (p[f] === undefined || p[f] === null || p[f] === "") errors.push(`missing required field: ${f}`);
  }
  if (p.pitchDate != null && !DATE_RE.test(String(p.pitchDate))) errors.push("pitchDate must be YYYY-MM-DD");
  if (p.loopFamily != null && !CONTRACT.pitch.loopFamilies.includes(p.loopFamily))
    errors.push(`unknown loopFamily "${p.loopFamily}" — add it to the contract (bump pitch.version) first`);
  if (p.badge != null && !CONTRACT.pitch.badges.includes(p.badge)) errors.push(`unknown badge "${p.badge}"`);
  if (p.status != null && !CONTRACT.pitch.statuses.includes(p.status)) errors.push(`unknown status "${p.status}"`);
  if (p.platformLadder != null && !CONTRACT.pitch.platformLadders.includes(p.platformLadder))
    errors.push(`unknown platformLadder "${p.platformLadder}"`);
  if (p.provenance != null && !CONTRACT.pitch.provenances.includes(p.provenance))
    errors.push(`unknown provenance "${p.provenance}" — expected one of ${CONTRACT.pitch.provenances.join(", ")}`);
  if (p.contentScope != null && !CONTRACT.pitch.contentScopes.includes(p.contentScope))
    errors.push(`unknown contentScope "${p.contentScope}" — expected one of ${CONTRACT.pitch.contentScopes.join(", ")}`);
  if (p.grayBoxDays != null && (!Number.isInteger(p.grayBoxDays) || p.grayBoxDays < 1))
    errors.push("grayBoxDays must be a positive integer (days to a testable gray-box loop)");
  for (const s of CONTRACT.pitch.scoreFields) {
    const v = p[s];
    if (v != null && (!Number.isInteger(v) || v < CONTRACT.pitch.scoreMin || v > CONTRACT.pitch.scoreMax))
      errors.push(`${s} must be an integer ${CONTRACT.pitch.scoreMin}..${CONTRACT.pitch.scoreMax}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function assertPitchInput(p: any): void {
  const r = validatePitchInput(p);
  if (!r.ok) throw new Error(`pitch fails contract v${CONTRACT.pitch.version}: ${r.errors.join("; ")}`);
}

/** Advisory validation for brief payloads — never throws in production (protects the live brief). */
export function validateBriefPayload(payload: any): ContractValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!payload || typeof payload !== "object") return { ok: false, errors: ["brief payload must be an object"], warnings };
  for (const f of CONTRACT.briefPayload.recommended) {
    if (!(f in payload)) warnings.push(`brief payload missing recommended field: ${f} (brief contract v${CONTRACT.briefPayload.version})`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
