# 2026-07-20 — One bearer-token gate for both API surfaces

**Decision.** `PUBLISH_TOKEN` validation for the write endpoints (brief publish/steering, library
POST, pitch POST/DELETE, edition DELETE) lives in one helper, `isAuthorized` in
`app/server/src/api/auth.ts` (#32, PR #97). The Express dev app (`app/server/src/api/app.ts`) and
the prod Netlify Function (`app/netlify/functions/api.ts`) both call it. Before this, each file
had its own copy of the check: 5 in the Express app and 6 in the Netlify Function.

**Why.** `routeParity.test.ts` catches *route* drift between the two surfaces but not *logic*
drift. A bug fixed in one file's auth check would silently stay unfixed in the other, and every new
token-gated endpoint added another copy. Duplicated routing is the accepted cost of the two-surface
design (see `CLAUDE.md`). Duplicated security logic is not.

**Semantics (kept byte-identical in the extraction).** An unset or empty `PUBLISH_TOKEN` rejects
everything, so the gate fails **closed**. The header must be exactly `Bearer <token>`
(case-sensitive). A rejection returns 401 with `{ error: "unauthorized" }`. The token is read when
the check runs, not when the module loads.

**Consequences.** A new write endpoint calls `isAuthorized` on both surfaces. It does not hand-roll
a check. The module stays plain and dependency-free because esbuild bundles the Netlify function,
which imports it by relative path. `app/server/test/auth.test.ts` covers the helper and asserts
that every gated Express route rejects missing, wrong or unset tokens. This gate is separate from
the HTTP Basic edge gate (`netlify/edge-functions/auth.ts`), which fails **open** when its password
is unset and which the write endpoints are excluded from.
