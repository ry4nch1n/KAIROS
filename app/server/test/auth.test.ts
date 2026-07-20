import { describe, it, expect, afterEach } from "vitest";
import { isAuthorized, UNAUTHORIZED_STATUS, unauthorizedBody } from "../src/api/auth.ts";
import { createApp } from "../src/api/app.ts";
import type { Querier } from "../src/db/db.ts";

const ORIGINAL_TOKEN = process.env.PUBLISH_TOKEN;
afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.PUBLISH_TOKEN;
  else process.env.PUBLISH_TOKEN = ORIGINAL_TOKEN;
});

describe("isAuthorized — shared bearer-token gate", () => {
  it("accepts exactly `Bearer <token>` from a string, Express headers, or Fetch Headers", () => {
    expect(isAuthorized("Bearer t", "t")).toBe(true);
    expect(isAuthorized({ authorization: "Bearer t" }, "t")).toBe(true);
    expect(isAuthorized(new Headers({ authorization: "Bearer t" }), "t")).toBe(true);
  });

  it("rejects missing, empty, malformed, or wrong tokens", () => {
    expect(isAuthorized(undefined, "t")).toBe(false);
    expect(isAuthorized(null, "t")).toBe(false);
    expect(isAuthorized("", "t")).toBe(false);
    expect(isAuthorized({}, "t")).toBe(false);
    expect(isAuthorized("Bearer wrong", "t")).toBe(false);
    expect(isAuthorized("t", "t")).toBe(false); // bare token, no scheme
    expect(isAuthorized("bearer t", "t")).toBe(false); // scheme is case-sensitive
    expect(isAuthorized("Bearer  t", "t")).toBe(false); // extra space
    expect(isAuthorized("Bearer t ", "t")).toBe(false); // trailing space
  });

  it("fails CLOSED when PUBLISH_TOKEN is unset or empty — even with a Bearer header", () => {
    expect(isAuthorized("Bearer anything", undefined)).toBe(false);
    expect(isAuthorized("Bearer anything", "")).toBe(false);
    expect(isAuthorized("Bearer ", undefined)).toBe(false);
    delete process.env.PUBLISH_TOKEN;
    expect(isAuthorized("Bearer anything")).toBe(false); // reads env by default
  });

  it("reads PUBLISH_TOKEN at call time (not module load)", () => {
    process.env.PUBLISH_TOKEN = "first";
    expect(isAuthorized("Bearer first")).toBe(true);
    process.env.PUBLISH_TOKEN = "second";
    expect(isAuthorized("Bearer first")).toBe(false);
    expect(isAuthorized("Bearer second")).toBe(true);
  });

  it("exposes the 401 rejection shape, fresh per call", () => {
    expect(UNAUTHORIZED_STATUS).toBe(401);
    expect(unauthorizedBody()).toEqual({ error: "unauthorized" });
    expect(unauthorizedBody()).not.toBe(unauthorizedBody());
  });
});

// The DB is never reached on the rejection path; these assertions only exercise
// the gate, so a stub querier is enough (and it proves nothing leaks through).
const stubDb: Querier = {
  query: async () => {
    throw new Error("handler ran despite failed auth");
  },
  exec: async () => {
    throw new Error("handler ran despite failed auth");
  },
} as unknown as Querier;

async function withServer(fn: (base: string) => Promise<void>) {
  const server = createApp(stubDb).listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    await fn(`http://localhost:${port}/api`);
  } finally {
    server.close();
  }
}

const GATED: Array<[string, string]> = [
  ["POST", "/brief/publish"],
  ["POST", "/brief/steering"],
  ["POST", "/library"],
  ["POST", "/pitches"],
  ["DELETE", "/pitches/some-slug"],
];

describe("token-gated Express routes reject via the shared gate", () => {
  it("401s every gated route with no / wrong header while PUBLISH_TOKEN is set", async () => {
    process.env.PUBLISH_TOKEN = "test-token";
    await withServer(async (base) => {
      for (const [method, path] of GATED) {
        const none = await fetch(`${base}${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: method === "POST" ? "{}" : undefined,
        });
        expect(none.status, `${method} ${path} without a token`).toBe(401);
        expect(await none.json()).toEqual({ error: "unauthorized" });

        const wrong = await fetch(`${base}${path}`, {
          method,
          headers: { "content-type": "application/json", authorization: "Bearer nope" },
          body: method === "POST" ? "{}" : undefined,
        });
        expect(wrong.status, `${method} ${path} with a wrong token`).toBe(401);
      }
    });
  });

  it("401s every gated route when PUBLISH_TOKEN is unset, even with a Bearer header", async () => {
    delete process.env.PUBLISH_TOKEN;
    await withServer(async (base) => {
      for (const [method, path] of GATED) {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: { "content-type": "application/json", authorization: "Bearer anything" },
          body: method === "POST" ? "{}" : undefined,
        });
        expect(res.status, `${method} ${path} with PUBLISH_TOKEN unset`).toBe(401);
      }
    });
  });

  it("lets a valid token past the gate (handler runs; gate no longer the blocker)", async () => {
    process.env.PUBLISH_TOKEN = "test-token";
    await withServer(async (base) => {
      const res = await fetch(`${base}/brief/steering`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ flags: [] }),
      });
      // The stub DB throws inside the handler → 400, never 401. Reaching the
      // handler at all is the proof the valid token was accepted.
      expect(res.status).not.toBe(401);
    });
  });
});
