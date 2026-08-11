import { describe, it, expect } from "vitest";
import { cardImage, steamCover, browserGroupOf, groupBrowserCards } from "./briefCards.ts";
import type { BriefNotable } from "shared";

const item = (over: Partial<BriefNotable> = {}): BriefNotable => ({ name: "TEKO", ...over });
const CAPSULE = "https://cdn.cloudflare.steamstatic.com/steam/apps/3835670/header.jpg";

describe("#155 brief card art", () => {
  it("derives a capsule only from a numeric appid", () => {
    expect(steamCover("3835670")).toBe(CAPSULE);
    expect(steamCover(" 3835670 ")).toBe(CAPSULE);
    expect(steamCover("Steam appid 3835670")).toBeNull(); // the free-text `figure` misuse
    expect(steamCover(null)).toBeNull();
    expect(steamCover(undefined)).toBeNull();
  });

  it("falls back to the Steam capsule for a browser card that only has an appid", () => {
    // The #155 regression: TEKO carried an appid and still rendered a branded placeholder.
    expect(cardImage(item({ steam_appid: "3835670" }), "browser")).toBe(CAPSULE);
  });

  it("prefers the payload's own art over the derived capsule", () => {
    const it0 = item({ image_url: "https://img.itch.zone/teko.png", steam_appid: "3835670" });
    expect(cardImage(it0, "browser")).toBe("https://img.itch.zone/teko.png");
    expect(cardImage(item({ cover_url: "https://cdn/x.jpg", steam_appid: "3835670" }), "browser")) //
      .toBe("https://cdn/x.jpg");
  });

  it("ignores a malformed url and keeps walking the chain", () => {
    expect(cardImage(item({ image_url: "not a url", steam_appid: "3835670" }), "browser")).toBe(
      CAPSULE,
    );
    // Nothing usable at all → null, i.e. the branded placeholder, exactly as today.
    expect(cardImage(item({ image_url: "javascript:alert(1)" }), "browser")).toBeNull();
    expect(cardImage(item(), "browser")).toBeNull();
  });

  it("leaves the notable branch behaving as before", () => {
    expect(cardImage(item({ cover_url: "https://cdn/cap.jpg" }), "notable")).toBe(
      "https://cdn/cap.jpg",
    );
    expect(cardImage(item({ steam_appid: "3835670" }), "notable")).toBe(CAPSULE);
    expect(cardImage(item(), "notable")).toBeNull();
  });
});

describe("#156 browser section grouped by evidence kind", () => {
  it("routes each known kind to its own group", () => {
    expect(browserGroupOf("Browser game")).toBe("native");
    expect(browserGroupOf("Loop signal")).toBe("funnel");
    expect(browserGroupOf("browser platform")).toBe("platform"); // case-insensitive
  });

  it("groups an unexpected or missing kind with browser-native rather than dropping it", () => {
    expect(browserGroupOf(undefined)).toBe("native");
    expect(browserGroupOf(null)).toBe("native");
    expect(browserGroupOf("Something the routine invented")).toBe("native");
  });

  it("splits an edition into ordered, non-empty groups without losing a card", () => {
    const cards = [
      item({ name: "AOD", kind: "Browser game" }),
      item({ name: "TEKO", kind: "Loop signal" }),
      item({ name: "CG Hot chart", kind: "Browser platform" }),
      item({ name: "Merge Idle War", kind: "Browser game" }),
      item({ name: "mystery", kind: "Brand new kind" }),
      item({ name: "no kind at all" }),
    ];
    const groups = groupBrowserCards(cards);
    expect(groups.map((g) => g.id)).toEqual(["native", "funnel", "platform"]);
    expect(groups.map((g) => g.label)).toEqual([
      "Browser-native supply",
      "Funnel / route evidence",
      "Platform notes",
    ]);
    expect(groups[0].items.map((i) => i.name)).toEqual([
      "AOD",
      "Merge Idle War",
      "mystery",
      "no kind at all",
    ]);
    expect(groups[1].items.map((i) => i.name)).toEqual(["TEKO"]);
    expect(groups[2].items.map((i) => i.name)).toEqual(["CG Hot chart"]);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(cards.length);
  });

  it("omits groups with nothing in them", () => {
    const groups = groupBrowserCards([item({ kind: "Loop signal" })]);
    expect(groups.map((g) => g.id)).toEqual(["funnel"]);
    expect(groupBrowserCards([])).toEqual([]);
  });
});
