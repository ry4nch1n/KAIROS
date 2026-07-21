<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: app/shared/src/contract.ts (imported, not parsed)
     Regenerate: npx tsx app/server/src/scripts/gen-docs.ts
     A drift check (app/server/test/docsDrift.test.ts) fails the suite if this is stale. -->

# Data contract reference

The contract is the coordination mechanism: it is served at `GET /api/contract`, enforced on
write for pitches, and asserted by `contract.test.ts`. **Changing a shape or adding a taxonomy
value means bumping the relevant version in the same commit.**

## Versions

| Scope | Version |
|-------|---------|
| `(top level)` | **10** |
| `pitch` | **8** |
| `briefPayload` | **1** |
| `taxonomy` | **2** |

## Taxonomies

### `pitch.loopFamilies`

9 values: `extraction-lite` · `automation-under-pressure` · `wave-defense-prep` · `minimal-input-survivors` · `cozy-craft` · `contained-systemic` · `idle-tycoon` · `route-planning` · `synergy-builder`

### `pitch.badges`

4 values: `recommended` · `retention-safe` · `cashflow` · `cheapest-build`

### `pitch.statuses`

7 values: `proposed` · `prototyping` · `validated` · `building` · `shipped` · `parked` · `shelved`

### `pitch.platformLadders`

3 values: `browser->steam` · `browser-only` · `steam-only`

### `pitch.provenances`

2 values: `market-backed` · `design-derived`

### `pitch.contentScopes`

3 values: `small` · `medium` · `large`

### `pitch.scoreFields`

5 values: `browserFit` · `steamFit` · `buildEase` · `marketability` · `founderFit`

### `pitch.required`

3 values: `slug` · `title` · `pitchDate`

### `briefPayload.recommended`

6 values: `new_notable` · `browser` · `tooling` · `market` · `top_signals` · `founder_take`

### `taxonomy.settings`

11 values: `fantasy` · `sci-fi` · `space` · `cyberpunk` · `post-apocalyptic` · `horror` · `historical` · `medieval` · `modern` · `western` · `military`
