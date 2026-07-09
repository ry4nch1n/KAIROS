// Access gate for KAIROS. HTTP Basic Auth over everything except the brief
// publish endpoint (which has its own bearer-token auth so the routine can post).
// Configure SITE_PASSWORD (and optionally SITE_USER) in Netlify env vars.
// If SITE_PASSWORD is unset, the gate is OPEN (prevents accidental lockout).
import type { Config, Context } from "https://edge.netlify.com/";

export default async (req: Request, _context: Context) => {
  const password = Netlify.env.get("SITE_PASSWORD");
  if (!password) return; // not configured yet -> allow through

  // Method-aware bypasses (the config excludedPath below can't distinguish method):
  //  • GET /api/contract — non-sensitive taxonomy/versions, read by producers at run start.
  //  • POST /api/pitches — the weekly routine posts with its own bearer token (function-enforced),
  //    while GET /api/pitches (the private pitch data) stays behind the gate.
  //  • DELETE /api/pitches/:slug — pitch curation (kairos-pitch skill / routines), bearer-enforced
  //    in the function, same as POST; GET /api/pitches stays gated.
  //  • POST /api/library — the prototype routine posts cards with its own bearer token
  //    (function-enforced), while GET /api/library stays behind the gate.
  const { pathname } = new URL(req.url);
  if (pathname === "/api/contract") return;
  if (req.method === "POST" && pathname === "/api/pitches") return;
  if (req.method === "DELETE" && pathname.startsWith("/api/pitches/")) return;
  if (req.method === "POST" && pathname === "/api/library") return;

  const user = Netlify.env.get("SITE_USER") || "kairos";
  const expected = "Basic " + btoa(`${user}:${password}`);
  const got = req.headers.get("authorization") || "";

  if (got !== expected) {
    return new Response("KAIROS — authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="KAIROS Command Center", charset="UTF-8"' },
    });
  }
  // authorized -> continue to static assets / serverless functions
};

export const config: Config = {
  path: "/*",
  // bearer-token endpoints the routine posts to (their own auth) — excluded from the gate
  excludedPath: ["/api/brief/publish", "/api/brief/steering"],
};
