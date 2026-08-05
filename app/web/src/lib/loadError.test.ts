import { describe, it, expect } from "vitest";
import { describeLoadError } from "./loadError.ts";

// The panel used to print `Failed to load: TypeError: Failed to fetch`, which
// names a JS class rather than a problem and offers no way forward. These pin the
// two properties that matter: the headline never leaks an error class, and every
// case carries an actionable hint.
describe("describeLoadError", () => {
  it("explains an unreachable API instead of naming the exception", () => {
    const r = describeLoadError(new TypeError("Failed to fetch"));
    expect(r.title).toBe("Could not reach the API");
    expect(r.hint).toMatch(/down|offline/i);
    expect(r.detail).toBe("Failed to fetch");
  });

  it("distinguishes a server fault from a rejected request", () => {
    expect(describeLoadError(new Error("HTTP 503")).title).toMatch(/API failed/i);
    expect(describeLoadError(new Error("HTTP 400")).title).toMatch(/rejected/i);
  });

  it("calls out an auth failure, which retrying will not fix", () => {
    const r = describeLoadError(new Error("HTTP 401 Unauthorized"));
    expect(r.title).toMatch(/not authorised/i);
    expect(r.hint).toMatch(/sign/i);
  });

  it("reads a numeric status property when the message has no code", () => {
    const r = describeLoadError(Object.assign(new Error("request failed"), { status: 404 }));
    expect(r.title).toMatch(/not available/i);
  });

  it("handles a rate limit separately from other 4xx", () => {
    expect(describeLoadError(new Error("HTTP 429")).title).toMatch(/too many/i);
  });

  it("never surfaces an error class name in the headline", () => {
    const cases: unknown[] = [
      new TypeError("Failed to fetch"),
      new Error("HTTP 500"),
      "a bare string",
      { status: 403 },
      null,
      undefined,
      42,
    ];
    for (const c of cases) {
      const r = describeLoadError(c);
      expect(r.title).not.toMatch(/Error|TypeError|\[object/);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a generic but still actionable message", () => {
    const r = describeLoadError("something odd");
    expect(r.title).toBe("Could not load this view");
    expect(r.detail).toBe("something odd");
  });
});
