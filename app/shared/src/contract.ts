// The KAIROS data contract — single source of truth for payload shapes + taxonomy.
//
// Producers read it at run start (GET /api/contract); publish paths validate against
// it; a contract test asserts the code matches it. When a payload shape or the taxonomy
// changes, bump the relevant `version` IN THE SAME COMMIT — that is how "a decision is
// made" becomes visible to every producer. Enums here are the taxonomy: adding a value
// (e.g. a new loop family) is a contract change, on purpose.

export const CONTRACT = {
  version: 1,
  pitch: {
    version: 1,
    loopFamilies: [
      "extraction-lite",
      "automation-under-pressure",
      "wave-defense-prep",
      "cozy-craft",
      "contained-systemic",
      "idle-tycoon",
      "route-planning",
    ],
    badges: ["recommended", "retention-safe", "cashflow", "cheapest-build"],
    statuses: ["proposed", "prototyping", "shelved", "shipped"],
    platformLadders: ["browser->steam", "browser-only", "steam-only"],
    scoreFields: ["d1Fit", "steamCeiling", "buildCost"],
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
  taxonomy: { version: 1 },
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
