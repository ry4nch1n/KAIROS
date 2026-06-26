// Access gate for KAIROS. HTTP Basic Auth over everything except the brief
// publish endpoint (which has its own bearer-token auth so the routine can post).
// Configure SITE_PASSWORD (and optionally SITE_USER) in Netlify env vars.
// If SITE_PASSWORD is unset, the gate is OPEN (prevents accidental lockout).
import type { Config, Context } from "https://edge.netlify.com/";

export default async (req: Request, _context: Context) => {
  const password = Netlify.env.get("SITE_PASSWORD");
  if (!password) return; // not configured yet -> allow through

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
  excludedPath: "/api/brief/publish",
};
