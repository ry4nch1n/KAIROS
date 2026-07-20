// Single source of truth for the bearer-token gate on the write endpoints
// (brief publish/steering, library POST, pitch POST/DELETE, edition DELETE).
//
// Both API surfaces — the Express dev app (server/src/api/app.ts) and the prod
// Netlify Function (netlify/functions/api.ts) — call `isAuthorized` so the auth
// logic can never drift between them (routeParity.test.ts only catches route
// drift, not logic drift). Keep this module plain and dependency-free: the
// Netlify function is bundled by esbuild and imports it by relative path.
//
// Semantics (unchanged from the hand-written checks it replaces):
//   - PUBLISH_TOKEN unset/empty  → everything is rejected (fail CLOSED).
//   - Header must be exactly `Bearer <token>` (case-sensitive, single space).
//   - Rejection is 401 with body { error: "unauthorized" }.

export const UNAUTHORIZED_STATUS = 401;

/** Fresh object per call so a handler can never mutate a shared literal. */
export const unauthorizedBody = () => ({ error: "unauthorized" });

/** Header bag from either surface: Node/Express plain object or Fetch `Headers`. */
type HeaderSource =
  | string
  | null
  | undefined
  | { get(name: string): string | null }
  | { authorization?: string | string[] };

function readAuthHeader(src: HeaderSource): string {
  if (src == null) return "";
  if (typeof src === "string") return src;
  if (typeof (src as { get?: unknown }).get === "function") {
    return (src as { get(name: string): string | null }).get("authorization") || "";
  }
  const v = (src as { authorization?: string | string[] }).authorization;
  return (Array.isArray(v) ? v[0] : v) || "";
}

/**
 * True only when PUBLISH_TOKEN is set and the request carries exactly
 * `Bearer <PUBLISH_TOKEN>`. Accepts the raw header string, an Express
 * `req.headers`, or a Fetch `Headers`.
 */
export function isAuthorized(
  headersOrAuth: HeaderSource,
  token: string | undefined = process.env.PUBLISH_TOKEN,
): boolean {
  if (!token) return false;
  return readAuthHeader(headersOrAuth) === `Bearer ${token}`;
}
