import { describe, expect, it } from "vitest";
import { artImage, artSrcSet } from "./artImage.ts";

const HEADER = "https://kairos-pitch-art.netlify.app/glasswright-20260807/header.png";

describe("artImage", () => {
  it("routes a known art host through its own Image CDN", () => {
    const out = artImage(HEADER, 460);
    const u = new URL(out);
    expect(u.origin).toBe("https://kairos-pitch-art.netlify.app");
    expect(u.pathname).toBe("/.netlify/images");
    expect(u.searchParams.get("w")).toBe("460");
    expect(u.searchParams.get("fm")).toBe("webp");
  });

  it("passes the source as a ROOT-RELATIVE path, never an absolute URL", () => {
    // An absolute URL would be treated as a remote image and require an allowlist
    // on the art site — this is the one detail that makes the transform work.
    const url = new URL(artImage(HEADER, 460)).searchParams.get("url");
    expect(url).toBe("/glasswright-20260807/header.png");
    expect(url).not.toContain("kairos-pitch-art");
    expect(url).not.toMatch(/^https?:/);
  });

  it("crops to an exact box when a height is given", () => {
    const p = new URL(artImage(HEADER, 460, 259)).searchParams;
    expect(p.get("w")).toBe("460");
    expect(p.get("h")).toBe("259");
    expect(p.get("fit")).toBe("cover");
  });

  it("omits height and fit when no height is given", () => {
    const p = new URL(artImage(HEADER, 460)).searchParams;
    expect(p.get("h")).toBeNull();
    expect(p.get("fit")).toBeNull();
  });

  it("rounds fractional widths to whole pixels", () => {
    const p = new URL(artImage(HEADER, 459.6, 258.4)).searchParams;
    expect(p.get("w")).toBe("460");
    expect(p.get("h")).toBe("258");
  });

  it("percent-encodes a path with spaces or unicode", () => {
    const src = "https://kairos-pitch-art.netlify.app/a b/héro.png";
    const url = new URL(artImage(src, 460)).searchParams.get("url");
    expect(url).toBe("/a%20b/h%C3%A9ro.png");
  });

  it("leaves an unknown host untouched", () => {
    const src = "https://example.com/pic.png";
    expect(artImage(src, 460)).toBe(src);
    // The prototypes site is NOT an art host — its Image CDN 415s on these paths.
    const proto = "https://kairos-prototypes.netlify.app/glasswright-20260807/header.png";
    expect(artImage(proto, 460)).toBe(proto);
  });

  it("leaves a relative URL untouched", () => {
    expect(artImage("/local/pic.png", 460)).toBe("/local/pic.png");
    expect(artImage("pic.png", 460)).toBe("pic.png");
  });

  it("leaves a data URI untouched", () => {
    const uri = "data:image/png;base64,iVBORw0KGgo=";
    expect(artImage(uri, 460)).toBe(uri);
  });

  it("returns an empty string for empty/null/undefined rather than a broken URL", () => {
    expect(artImage("", 460)).toBe("");
    expect(artImage(null, 460)).toBe("");
    expect(artImage(undefined, 460)).toBe("");
  });

  it("leaves an already-transformed URL untouched", () => {
    const once = artImage(HEADER, 460);
    expect(artImage(once, 920)).toBe(once);
  });

  it("leaves the URL untouched for a nonsense width", () => {
    expect(artImage(HEADER, 0)).toBe(HEADER);
    expect(artImage(HEADER, -10)).toBe(HEADER);
    expect(artImage(HEADER, Number.NaN)).toBe(HEADER);
  });
});

describe("artSrcSet", () => {
  it("emits 1x and 2x variants at doubled dimensions", () => {
    const set = artSrcSet(HEADER, 460, 259);
    expect(set).toBeDefined();
    const [one, two] = (set as string).split(", ");
    expect(one.endsWith(" 1x")).toBe(true);
    expect(two.endsWith(" 2x")).toBe(true);
    const p1 = new URL(one.replace(" 1x", "")).searchParams;
    const p2 = new URL(two.replace(" 2x", "")).searchParams;
    expect([p1.get("w"), p1.get("h")]).toEqual(["460", "259"]);
    expect([p2.get("w"), p2.get("h")]).toEqual(["920", "518"]);
  });

  it("doubles width only when no height is given", () => {
    const two = (artSrcSet(HEADER, 460) as string).split(", ")[1];
    const p = new URL(two.replace(" 2x", "")).searchParams;
    expect(p.get("w")).toBe("920");
    expect(p.get("h")).toBeNull();
  });

  it("is undefined when the URL isn't rewritable, so no bogus srcset ships", () => {
    expect(artSrcSet("https://example.com/pic.png", 460)).toBeUndefined();
    expect(artSrcSet("/local/pic.png", 460)).toBeUndefined();
    expect(artSrcSet("", 460)).toBeUndefined();
    expect(artSrcSet(null, 460)).toBeUndefined();
  });
});
