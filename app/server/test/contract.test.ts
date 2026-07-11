import { describe, it, expect } from "vitest";
import { freshMemoryDb } from "../src/db/db.ts";
import { createApp } from "../src/api/app.ts";
import { CONTRACT, validatePitchInput, assertPitchInput, validateBriefPayload } from "shared";
import type { PitchInput } from "shared";

const goodPitch: PitchInput = {
  slug: "salvage-line",
  title: "Salvage Line",
  pitchDate: "2026-07-06",
  rank: 1,
  loopFamily: "extraction-lite",
  badge: "recommended",
  status: "proposed",
  platformLadder: "browser->steam",
  browserFit: 2,
  steamFit: 3,
  buildEase: 2,
  // pitch v5 fields
  grayBoxDays: 10,
  contentScope: "small",
  marketability: 3,
  founderFit: 2,
  hook: "Strip a derelict star-freighter before its reactor cooks you.",
};

describe("C1 contract shape", () => {
  it("declares versions and non-empty taxonomy enums", () => {
    expect(CONTRACT.version).toBeGreaterThanOrEqual(1);
    expect(CONTRACT.pitch.version).toBeGreaterThanOrEqual(1);
    expect(CONTRACT.pitch.loopFamilies.length).toBeGreaterThan(0);
    expect(CONTRACT.pitch.badges).toContain("recommended");
    expect(CONTRACT.pitch.statuses).toContain("proposed");
  });
});

describe("C2 validatePitchInput", () => {
  it("accepts a well-formed pitch", () => {
    expect(validatePitchInput(goodPitch)).toMatchObject({ ok: true });
  });
  it("rejects missing required fields", () => {
    expect(validatePitchInput({ title: "x" }).ok).toBe(false);
  });
  it("rejects an unknown loop family (must bump the contract)", () => {
    const r = validatePitchInput({ ...goodPitch, loopFamily: "roguelike-deckbuilder" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/loopFamily/);
  });
  it("rejects out-of-range scores and bad dates", () => {
    expect(validatePitchInput({ ...goodPitch, browserFit: 9 }).ok).toBe(false);
    expect(validatePitchInput({ ...goodPitch, pitchDate: "07/06/2026" }).ok).toBe(false);
  });
  it("rejects an unknown provenance (must bump the contract)", () => {
    const r = validatePitchInput({ ...goodPitch, provenance: "vibes-based" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/provenance/);
  });
  it("assertPitchInput throws on invalid", () => {
    expect(() => assertPitchInput({ title: "x" })).toThrow(/contract/);
  });
  it("every seed-batch enum value is in the contract", () => {
    // guards against the UI/seed using a value the contract doesn't know
    for (const lf of ["extraction-lite", "contained-systemic", "cozy-craft", "idle-tycoon"])
      expect(CONTRACT.pitch.loopFamilies).toContain(lf);
    for (const b of ["recommended", "cheapest-build", "retention-safe", "cashflow"])
      expect(CONTRACT.pitch.badges).toContain(b);
  });
});

describe("C2b pitch v5 — scope + hook + founder-fit fields", () => {
  it("bumped both versions and added the contentScopes taxonomy + score axes", () => {
    expect(CONTRACT.pitch.version).toBeGreaterThanOrEqual(5);
    expect(CONTRACT.version).toBeGreaterThanOrEqual(4);
    expect(CONTRACT.pitch.contentScopes).toEqual(["small", "medium", "large"]);
    expect(CONTRACT.pitch.scoreFields).toContain("marketability");
    expect(CONTRACT.pitch.scoreFields).toContain("founderFit");
  });
  it("accepts a full v5 pitch (all new fields valid)", () => {
    expect(validatePitchInput(goodPitch).ok).toBe(true);
  });
  it("validates the new 1..3 score axes like the platform ones", () => {
    expect(validatePitchInput({ ...goodPitch, marketability: 0 }).ok).toBe(false);
    expect(validatePitchInput({ ...goodPitch, founderFit: 4 }).ok).toBe(false);
  });
  it("rejects an unknown contentScope (must bump the contract)", () => {
    const r = validatePitchInput({ ...goodPitch, contentScope: "epic" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/contentScope/);
  });
  it("grayBoxDays must be a positive integer", () => {
    expect(validatePitchInput({ ...goodPitch, grayBoxDays: 0 }).ok).toBe(false);
    expect(validatePitchInput({ ...goodPitch, grayBoxDays: 3.5 }).ok).toBe(false);
    expect(validatePitchInput({ ...goodPitch, grayBoxDays: null }).ok).toBe(true); // optional
  });
});

describe("C3 validateBriefPayload is advisory, never hard-fails a real payload", () => {
  it("passes a complete payload with no warnings", () => {
    const payload: Record<string, unknown> = {};
    for (const f of CONTRACT.briefPayload.recommended) payload[f] = [];
    const r = validateBriefPayload(payload);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });
  it("warns (but stays ok) when a recommended field is missing", () => {
    const r = validateBriefPayload({ new_notable: [] });
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("fails only on a non-object payload", () => {
    expect(validateBriefPayload(null).ok).toBe(false);
  });
});

describe("C4 contract is served + enforced through the API", () => {
  it("GET /api/contract returns the contract; POST /api/pitches rejects a contract violation", async () => {
    process.env.PUBLISH_TOKEN = "test-token";
    const db = await freshMemoryDb();
    const app = createApp(db);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const b = `http://localhost:${port}`;
    try {
      const c = await (await fetch(`${b}/api/contract`)).json();
      expect(c.pitch.loopFamilies).toContain("extraction-lite");

      const bad = await fetch(`${b}/api/pitches`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ ...goodPitch, loopFamily: "not-a-family" }),
      });
      expect(bad.status).toBe(400); // contract violation surfaces as a 400, not a silent write
    } finally {
      server.close();
    }
  });
});
