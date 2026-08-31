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
  // v7: pitch v7 read-through — see pitch.version below. `status` stops trying to say two
  //     things at once. It gains `building` (the committed lead, in production — pinned atop
  //     the leaderboard) and `parked` (promising but deliberately deferred — split cleanly
  //     from `shelved`, which now means "rejected" only). Additive to the enum.
  // v8: pitch v8 read-through — see pitch.version below (`minimal-input-survivors` loop
  //     family, split out of `wave-defense-prep`). Additive to the taxonomy.
  // v9: SteamOverview gained `tagEconomics` — a sub-genre (tag-keyed) economics lens over the
  //     existing tags/game_tags data, so markets that store genres hide (Deckbuilding,
  //     Roguelike Deckbuilder…) are readable on their own. Additive; demand is median reviews.
  // v10: SteamGenreEconomics (and the tag lens that extends it) gained a second, independent
  //      revenue estimator — Boxleiter-style reviews × multiplier × price — exposed as a BAND
  //      (`revenueBandLowPerGame` / `revenueBandHighPerGame`) plus `estimatorRatio` and
  //      `estimatorsDisagree`, so a single shaky owners bucket can no longer pass as precision.
  //      Additive; read defensively (older payloads simply lack the band).
  // v11: SteamTagEconomics (the sub-genre lens) gained the two momentum signals the store-genre
  //      quadrant already exposes — `supplyTrend`/`supplyRising` (new-entrant flow from
  //      release_date, the "door is closing" crowding flag) and `demandTrajectory` (median-reviews
  //      momentum across snapshot windows, "new" until history deepens) — so a sub-genre reads
  //      "growing or saturating?" like a store genre (#114). Additive; read defensively.
  // v12: MarketGap and SteamGap (the opportunity-ranked lists) gained `components` — the three
  //      signed z-score contributions (demand / quality / supply) that already sum to the
  //      composite `score`, surfaced so the ranking stops being a black box (#87). No formula
  //      change: the components ARE the score's existing intermediates. Additive; read defensively.
  // v13: taxonomy grew to hold two standing steering flags it couldn't express (#88). Added the
  //      `fairytale` world to taxonomy.settings, and a new `moods` axis (melancholy, whimsical,
  //      cozy, …) so TONE becomes a matchable dimension separate from the setting/world axis —
  //      "fairy-tale" is a world, "melancholy" is a mood, and collapsing both into settings was
  //      the gap. Taxonomy-only; founderFit scoring wiring is a deliberate follow-up. See
  //      taxonomy.version below (bumped to 3). Additive; read defensively.
  // v14: SteamOverview stops showing only survivors (#109). `SteamNewRelease` gained traction —
  //      `votes`, `daysSinceRelease`, `reviewsPerDay`, and `belowScoreThreshold` (votes < 10 →
  //      Steam shows no overall score yet, a quiet launch). The SteamOverview KPI block gained a
  //      quiet-launch baseline — `quietLaunchPct` / `quietLaunchSample` (share of last-90-day
  //      non-AAA releases still below that threshold), the failure floor the Comparables owners
  //      floor deliberately hides. Comparables stay survivors on purpose. Additive; read defensively.
  // v15: AI-content disclosure capture (#110). Steam's "AI Generated Content Disclosure" block is
  //      store-page-only (absent from the 3 JSON endpoints), so it's fetched separately and gated
  //      to the recent non-AAA cohort (released < 120d, tier != aaa) for crawl-budget politeness.
  //      `SteamComparable` gained `aiDisclosure` (tri-state: true=discloses / false=checked & absent /
  //      null=not checked or fetch failed). The SteamOverview KPI block gained `aiDisclosurePct` /
  //      `aiDisclosureSample` — of checked last-90-day non-AAA releases, the share disclosing AI
  //      content, over the count actually checked. Additive; read defensively.
  // v16: the standing steering flags stop being a caption and re-score the Steam opportunity
  //      ranking (#12b). `ScoreComponents` gained an optional `steering` term (+weight per
  //      matching flag, ONLY on a matched row); `SteamGap` gained `steering` ({flags, delta});
  //      `SteamOverview` gained `steering` (SteeringLens: flags in play, which applied, which
  //      matched NOTHING, rows lifted, weight). No flags set → the ranking is identical to v15.
  //      Browser `Overview.gaps` is NOT steered yet (same helper, follow-up). Additive.
  // v17: `SteamComparable` and `SteamNewRelease` gained `capsuleUrl` — the game's Steam header
  //      capsule, already crawled into games.thumbnail_url (the appdetails `header_image`) but
  //      never exposed. A market-intelligence tool for GAMES could not show you the game: the
  //      only surface carrying cover art was the Library pitch card, so Radar read as a generic
  //      spreadsheet. Rendering the capsule in the Game column also makes a row identifiable by
  //      recognition instead of by reading a title string. Nullable — a game with no crawled
  //      thumbnail renders the bare plate. Additive; read defensively.
  // v18: `SteamOverview` gained `upcoming` — the unreleased ("coming soon") cohort, the read half
  //      of #54's capture (#164). Each `SteamUpcoming` row carries `followers` (an unshipped
  //      title's only demand number, and the accepted public proxy for wishlists) plus
  //      `followerVelocity` / `followerWindowDays`, a followers-per-day rate off the last two
  //      snapshots that carry a reading — `SteamNewRelease.reviewsPerDay`'s idiom, so null (never
  //      0) below two measured days. Released cohorts are untouched. Additive; read defensively.
  // v19: the steering lens stops being computed over the DISPLAYED cut and is read over the full
  //      ranked candidate set (#167). `steerRow` lifts every candidate before the sort, so a
  //      market could match a standing flag, take its lift, and still land below the top-8 cut —
  //      handed only the cut, the lens called that flag `unmatched` and reported `steered: 0`,
  //      which reads as a market verdict ("nothing in your lane") when the truth was "your lane
  //      matched, none of it cleared the cut". `SteeringLens.applied`/`steered`/`unmatched` now
  //      describe the whole ranking; two additive fields carry the narrower reading —
  //      `steeredShown` (lifted markets inside the displayed cut) and `unlisted` (the
  //      matched-but-below-the-cut markets, each with its rank, capped at 5). Matching itself is
  //      untouched — `steerRow`'s no-force-fit contract is unchanged. Additive; read defensively
  //      (an older payload simply lacks the two new fields).
  // v20: `HiddenGem` gained a discovery axis — `daysTracked`, `votesPerDay`, `trajectory` (#176).
  //      High rating × low votes ranked by a Bayesian-shrunk rating is a ONE-axis read, and that
  //      one axis cannot separate "quality the audience hasn't found yet" from "shipped, nobody
  //      found it, stalled years ago" — the two have identical rating/vote signatures and
  //      opposite meanings. The added fields are the second axis: age since KAIROS first saw the
  //      title (crawl discovery, NEVER a release date — the browser portals don't date releases)
  //      and the same age-adjusted momentum `NewRelease` already carries. Ranking is unchanged;
  //      this annotates rather than silently re-sorts. Scope is the BROWSER panel only — no
  //      revenue axis exists there, so the honest reading is "quality discovery missed", not any
  //      claim about an underserved market. Additive; read defensively.
  // v21: `SteamGenreEconomics` (and the tag lens extending it) gained an absolute OUTCOME ladder
  //      beside v10's uncertainty band (#177). `successBand` tiers the headline median on lifetime
  //      realised gross — sub-scale <$50k · modest $50k–250k · sustainable $250k–1M · hit $1M–5M ·
  //      breakout $5M+ — because "$380k median" is not decision-ready until you know whether that
  //      is a typical result or an upper-quartile one. Each floor also carries a review-count
  //      equivalent DERIVED from BOXLEITER_MULTIPLIER at one stated reference price, so the two
  //      lenses cannot drift. `revenuePercentiles` ({p25, p75, p90}, same owners-based estimator)
  //      adds the tail shape, and is null below a 30-title cohort floor rather than reporting a
  //      quantile that one game could move. The ladder is calibrated on the cohort KAIROS already
  //      medians — released, non-AAA, free titles at $0 — and a paid-only cohort runs ~4× higher,
  //      so every surface showing a band states its cohort. Additive; read defensively.
  //      Same commit: ESTIMATOR_DISAGREE_RATIO 3 → 2 (observed splits sit at 2.1–2.6× and never
  //      flagged), so more rows now carry `estimatorsDisagree` — a threshold change, not a shape one.
  // v22: the market-level Route Lens gained a fourth lean state, `steam-unmapped`, and each row
  //      now carries `steamGenres` (#179). A family whose Steam side is empty was emitting
  //      `routeLean: "browser"` whether Steam held no such market or the curated genre→family map
  //      simply had no key for it — an absent MEASUREMENT read identically to a measured absence,
  //      and 2 of the 3 live rows were the former. `steam-unmapped` says so explicitly, so the
  //      panel can no longer claim a lean it never measured; `steamGenres` (the Steam genres that
  //      fed the row, the mirror of `genres` on the browser side) makes a wrong lean debuggable
  //      from the payload. Same commit widened the map's key coverage. Additive: an existing
  //      reader that does not know the new value renders no chip rather than a wrong one.
  // v23: GET /api/brief/editions now also emits DERIVED gap rows — a cadence slot that never
  //      published, marked `missing: true` with id 0, empty briefType and sourceCount 0 (#180).
  //      A list of the editions that exist cannot show the edition that does not, so two
  //      skipped Thursdays read exactly like a quiet fortnight. The cadence is INFERRED from
  //      the trailing six complete weeks rather than hardcoded, so a deliberate schedule change
  //      stops raising gaps instead of alarming forever; too short a history claims no cadence
  //      and emits no gaps, and a slot is reported only once past due — never today or later,
  //      never before the first edition ever published. Additive: a reader that does not know
  //      the flag renders one extra row, and brief validation stays advisory either way.
  // v24: the steering lens now also reshapes the BROWSER read (#142). `Overview.gaps` is steered
  //      by the standing flags before its sort and top-6 cut, each lifted row carries `steering`,
  //      and `Overview.steering` is the same `SteeringLens` the Steam side already emits — read
  //      over the full ranked set with the cut passed in, so a match below the list is named with
  //      its rank rather than reported as no match. Until now the flags reshaped Steam and merely
  //      captioned the browser, so one setting produced two different verdicts about the same
  //      interests. STEERING_WEIGHT is deliberately unchanged (0.5) — tuning it is the next
  //      observation, now that both surfaces are steered and comparable. Additive, and inert with
  //      no flags set: the browser ranking is then byte-identical to the unsteered one.
  version: 24,
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
    // v7: `status` was quietly encoding two orthogonal things — evidence (how proven the loop
    //     is) and disposition (what you decided to do with it). Two new values split them out:
    //     `building` = the committed lead in active production (a DECISION that can precede
    //     `validated`; the leaderboard pins it as "Current focus"), and `parked` = promising
    //     but deliberately deferred, revisit later — distinct from `shelved`, which is now
    //     "rejected, won't revisit" only. Off-ladder states (parked/shelved) leave the ranked
    //     board but stay visible in their own shelves. Additive to the enum.
    // v8: `wave-defense-prep` was holding two different loops. It now means prep-then-defend
    //     only — you build/place/position between waves and the defending is the payoff
    //     (tower/base defense, Vigil). The new `minimal-input-survivors` family is the
    //     movement-only auto-attack lineage (Vampire Survivors / Brotato, Sporelight): the
    //     player only steers, all attacking is automatic, and the decisions are level-up
    //     picks mid-run. Different loop, different market — the merged value made the
    //     family coverage view read as supply that wasn't there. Additive to the enum.
    version: 8,
    loopFamilies: [
      "extraction-lite",
      "automation-under-pressure",
      "wave-defense-prep",
      "minimal-input-survivors",
      "cozy-craft",
      "contained-systemic",
      "idle-tycoon",
      "route-planning",
      "synergy-builder",
    ],
    badges: ["recommended", "retention-safe", "cashflow", "cheapest-build"],
    // On-ladder (a live bet, ranked on the leaderboard): proposed → prototyping → validated
    // → building → shipped. Off-ladder dispositions (leave the ranked board, kept not deleted):
    // parked (deferred, revisit) and shelved (rejected).
    statuses: ["proposed", "prototyping", "validated", "building", "shipped", "parked", "shelved"],
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
    // v3: two additions for the standing steering flags the enum couldn't express (#88).
    // Added `fairytale` to `settings` (a WORLD — fairy-tale / storybook). Added `moods` — a
    // lightweight TONE axis, orthogonal to the world axis, so a mood like melancholy becomes
    // matchable on its own (a setting says WHERE, a mood says how it FEELS). Note: `cozy` here
    // is a mood and is a DIFFERENT axis from the `cozy-craft` loop family (a mechanic tag) — the
    // collision is intentional, they live on separate axes. Taxonomy-only; scoring wiring is a
    // deliberate follow-up.
    version: 3,
    settings: [
      "fantasy",
      "fairytale",
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
    // Tone/mood axis — orthogonal to `settings` (the world). Kept lightweight; generic tone
    // words, not personal data. A matchable dimension the setting/world list can't express.
    moods: ["melancholy", "whimsical", "cozy", "tense", "triumphant", "mysterious"],
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
  if (!p || typeof p !== "object")
    return { ok: false, errors: ["pitch must be an object"], warnings };

  for (const f of CONTRACT.pitch.required) {
    if (p[f] === undefined || p[f] === null || p[f] === "")
      errors.push(`missing required field: ${f}`);
  }
  if (p.pitchDate != null && !DATE_RE.test(String(p.pitchDate)))
    errors.push("pitchDate must be YYYY-MM-DD");
  if (p.loopFamily != null && !CONTRACT.pitch.loopFamilies.includes(p.loopFamily))
    errors.push(
      `unknown loopFamily "${p.loopFamily}" — add it to the contract (bump pitch.version) first`,
    );
  if (p.badge != null && !CONTRACT.pitch.badges.includes(p.badge))
    errors.push(`unknown badge "${p.badge}"`);
  if (p.status != null && !CONTRACT.pitch.statuses.includes(p.status))
    errors.push(`unknown status "${p.status}"`);
  if (p.platformLadder != null && !CONTRACT.pitch.platformLadders.includes(p.platformLadder))
    errors.push(`unknown platformLadder "${p.platformLadder}"`);
  if (p.provenance != null && !CONTRACT.pitch.provenances.includes(p.provenance))
    errors.push(
      `unknown provenance "${p.provenance}" — expected one of ${CONTRACT.pitch.provenances.join(", ")}`,
    );
  if (p.contentScope != null && !CONTRACT.pitch.contentScopes.includes(p.contentScope))
    errors.push(
      `unknown contentScope "${p.contentScope}" — expected one of ${CONTRACT.pitch.contentScopes.join(", ")}`,
    );
  if (p.grayBoxDays != null && (!Number.isInteger(p.grayBoxDays) || p.grayBoxDays < 1))
    errors.push("grayBoxDays must be a positive integer (days to a testable gray-box loop)");
  for (const s of CONTRACT.pitch.scoreFields) {
    const v = p[s];
    if (
      v != null &&
      (!Number.isInteger(v) || v < CONTRACT.pitch.scoreMin || v > CONTRACT.pitch.scoreMax)
    )
      errors.push(`${s} must be an integer ${CONTRACT.pitch.scoreMin}..${CONTRACT.pitch.scoreMax}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function assertPitchInput(p: any): void {
  const r = validatePitchInput(p);
  if (!r.ok)
    throw new Error(`pitch fails contract v${CONTRACT.pitch.version}: ${r.errors.join("; ")}`);
}

/** Advisory validation for brief payloads — never throws in production (protects the live brief). */
export function validateBriefPayload(payload: any): ContractValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!payload || typeof payload !== "object")
    return { ok: false, errors: ["brief payload must be an object"], warnings };
  for (const f of CONTRACT.briefPayload.recommended) {
    if (!(f in payload))
      warnings.push(
        `brief payload missing recommended field: ${f} (brief contract v${CONTRACT.briefPayload.version})`,
      );
  }
  return { ok: errors.length === 0, errors, warnings };
}
