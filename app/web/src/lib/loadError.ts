// Turns a thrown value from a fetch into something a person can act on.
//
// The panel used to render `Failed to load: ${String(e)}`, which produces
// "Failed to load: TypeError: Failed to fetch" — it names the JS class, not the
// problem, and suggests nothing. An error message should say what went wrong and
// what to do next; the raw text is still worth keeping for diagnosis, so it goes
// in `detail` rather than being the headline.

export interface LoadError {
  /** Plain-language statement of the problem. No error classes, no stack. */
  title: string;
  /** What the reader can do about it. */
  hint: string;
  /** The original text, for when the hint is not enough. */
  detail: string;
}

/** HTTP status → the distinct situations worth telling apart. */
function forStatus(status: number): { title: string; hint: string } | null {
  if (status === 401 || status === 403)
    return {
      title: "Not authorised to read this data",
      hint: "The site's access gate rejected the request. Signing in again usually clears it.",
    };
  if (status === 404)
    return {
      title: "That endpoint is not available",
      hint: "The API route is missing — most likely the running server is older than this page.",
    };
  if (status === 429)
    return {
      title: "Too many requests",
      hint: "The API is rate-limiting. Waiting a moment and retrying should work.",
    };
  if (status >= 500)
    return {
      title: "The API failed while building this view",
      hint: "That is a server-side error, not something on this page. Retrying is worth one attempt.",
    };
  if (status >= 400)
    return {
      title: "The API rejected this request",
      hint: "Retrying is unlikely to help on its own — the request itself was refused.",
    };
  return null;
}

export function describeLoadError(e: unknown): LoadError {
  const detail = e instanceof Error ? e.message : String(e);

  // Fetch wrappers commonly carry the status either as a property or inline in
  // the message ("HTTP 503", "503 Service Unavailable").
  const fromProp = typeof e === "object" && e !== null ? (e as { status?: unknown }).status : null;
  const status =
    typeof fromProp === "number"
      ? fromProp
      : Number(detail.match(/\b(\d{3})\b/)?.[1] ?? Number.NaN);

  const byStatus = Number.isFinite(status) ? forStatus(status) : null;
  if (byStatus) return { ...byStatus, detail };

  // No status at all: the request never reached a server.
  if (/failed to fetch|networkerror|load failed|ecconn|econnrefused|fetch failed/i.test(detail))
    return {
      title: "Could not reach the API",
      hint: "The server may be down, or this device is offline. The last loaded view is unaffected.",
      detail,
    };

  if (/abort/i.test(detail))
    return {
      title: "The request was cancelled",
      hint: "This usually happens when a view changes mid-load. Retrying is safe.",
      detail,
    };

  return {
    title: "Could not load this view",
    hint: "Retrying is the first thing to try. If it keeps failing, the detail below identifies it.",
    detail,
  };
}
