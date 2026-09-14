# 2026-07-20 — Contract v6 → v10: every shape or taxonomy change is an additive, same-commit bump

**Decision.** `app/shared/src/contract.ts` gets a version bump in the same commit as any change
to a payload shape or to the taxonomy. The change is additive and the client reads it defensively,
so an older payload that lacks the new field still renders. The period covered here, 2026-07-13 to
2026-07-20, settled the practice through five consecutive bumps:

| Top-level | Landed | Change |
|---|---|---|
| v6 | 2026-07-13 | pitch v6: `validated` status, a play-test verdict ranked above `prototyping` |
| v7 | 2026-07-19 | pitch v7: `status` stops encoding two things at once. It adds `building` (the committed lead, pinned) and `parked` (deferred), and `shelved` now means rejected only |
| v8 | 2026-07-20 | pitch v8: `minimal-input-survivors` loop family, split out of `wave-defense-prep` (#94) |
| v9 | 2026-07-20 | `SteamOverview.tagEconomics`, the sub-genre lens (#90, PR #96) |
| v10 | 2026-07-20 | Steam economics gains a second revenue estimator exposed as a band, plus `estimatorRatio` / `estimatorsDisagree` (#53, PR #98) |

**Why.** The contract is how producers such as the pitch routine and the brief coordinate with the
app. They read `GET /api/contract` when a run starts. A bump is how a decision becomes visible to
all of them. Three of the five bumps above were taxonomy-only (enum values), and they are bumps
**on purpose**: adding a loop family or a status changes what a producer may send.

**Rule.** When a nested lens changes, its own version (`pitch.version`, `taxonomy.version`) moves
together with the top-level `version`. Pitch validation is strict and blocks publish.
Brief-payload validation is advisory, so a format lag cannot blank the live dashboard.

**Consequences.** For taxonomy and status changes, `app/server/test/contract.test.ts` pins the
bump and the new enum value (v6–v8 each have a case). Additive analytics fields such as v9 and v10
are covered by their query tests (`steam.test.ts`) rather than by a version assertion. Per-version notes stay as comments beside `CONTRACT` in `contract.ts`, and those
comments are their owner. The current version and field shapes are generated in
[`docs/reference/contract.md`](../reference/contract.md). They are not restated here.
