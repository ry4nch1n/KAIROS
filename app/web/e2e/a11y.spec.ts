import { test, expect, type Page } from "@playwright/test";

// WCAG 2.1 AA as an executable gate.
//
// None of this decayed because anyone decided it should. It accumulated one
// component at a time, because nothing measured it: ~86 elements below the
// contrast floor, text down to 9px, zero focus indicators, no <h1> anywhere, and
// a section nav that no keyboard could reach. The mobile-overflow spec is the
// proof that a gate works here — horizontal overflow is the one axis that
// measured clean, because it was the one axis under test.
//
// Same spirit as routeParity and docsDrift: an executable invariant rather than a
// prose reminder.
//
// Deliberately NOT covered, because it is not machine-checkable to a useful
// standard: ARIA correctness, live-region announcement, and focus-trap behaviour.
// Those are reviewed, not gated.

const PANELS = [
  { name: "radar", hash: "#radar" },
  { name: "radar-comparables", hash: "#radar/comparables" },
  { name: "brief", hash: "#brief" },
  { name: "library", hash: "#library" },
  { name: "revenue", hash: "#revenue" },
];

/** Colour parsing that understands what the browser actually returns.
 *  Chrome resolves color-mix() to `color(srgb 0.9 0.95 0.92)` — 0-1 floats.
 *  Reading those as 0-255 scores every mixed tint as near-black, which produces
 *  a page full of phantom failures. Both forms are handled. */
const CONTRAST_PROBE = `(() => {
  const parse = (c) => {
    if (!c) return null;
    const s = c.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)/);
    if (s) return [+s[1]*255, +s[2]*255, +s[3]*255, s[4] === undefined ? 1 : +s[4]];
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
  };
  const over = (fg, bg) => fg.slice(0,3).map((v,i) => v*fg[3] + bg[i]*(1-fg[3])).concat([1]);
  const lum = (c) => { const [r,g,b] = c.slice(0,3).map(v => { v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); }); return .2126*r+.7152*g+.0722*b; };
  const bgOf = (e) => {
    const stack = [];
    for (let n = e; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) stack.push(c);
    }
    let acc = [255,255,255,1];
    for (let i = stack.length-1; i >= 0; i--) acc = over(stack[i], acc);
    return acc;
  };
  const fails = [], tiny = [];
  document.querySelectorAll('*').forEach(e => {
    const c = getComputedStyle(e);
    if (c.display === 'none' || c.visibility === 'hidden' || e.closest('[hidden]')) return;
    if (e.children.length || !e.textContent.trim()) return;
    // A gradient/image background cannot be sampled from a computed value, so a
    // reading here would be invented rather than measured.
    if (getComputedStyle(e).backgroundImage !== 'none') return;
    const fs = parseFloat(c.fontSize);
    const label = (e.className || e.tagName).toString().slice(0, 40);
    if (fs < 11) tiny.push(label + ' @' + fs + 'px');
    const fgRaw = parse(c.color);
    if (!fgRaw) return;
    const bg = bgOf(e), fg = over(fgRaw, bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
    const large = fs >= 18 || (fs >= 14 && parseInt(c.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) fails.push(label + ' ' + ratio.toFixed(2) + ':1 (' + c.color + ')');
  });
  return { fails: [...new Set(fails)], tiny: [...new Set(tiny)] };
})()`;

async function open(page: Page, hash: string) {
  await page.goto("/" + hash);
  // Panels fetch on mount; charts settle a frame later.
  await page.waitForTimeout(1500);
}

test.describe("accessibility — WCAG 2.1 AA", () => {
  for (const { name, hash } of PANELS) {
    test(`${name}: text meets the contrast floor and the 11px minimum`, async ({ page }) => {
      await open(page, hash);
      const { fails, tiny } = (await page.evaluate(CONTRAST_PROBE)) as {
        fails: string[];
        tiny: string[];
      };
      expect(fails, `text below 4.5:1 (large text 3:1):\n${fails.join("\n")}`).toEqual([]);
      expect(tiny, `text below the 11px floor:\n${tiny.join("\n")}`).toEqual([]);
    });

    test(`${name}: every interactive element is reachable and shows focus`, async ({ page }) => {
      await open(page, hash);
      const result = await page.evaluate(() => {
        const vis = (e: Element) =>
          !e.closest("[hidden]") && (e as HTMLElement).offsetParent !== null;
        // An <a> with an onClick and no href is not in the tab order and does not
        // fire on Enter — this is what made the whole section nav unreachable.
        const deadAnchors = [...document.querySelectorAll("a")]
          .filter((a) => vis(a) && !a.getAttribute("href"))
          .map((a) => a.className || a.textContent?.trim().slice(0, 30) || "a");

        const focusables = [
          ...document.querySelectorAll(
            'button:not([disabled]),a[href],input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])',
          ),
        ].filter(vis) as HTMLElement[];

        const noRing: string[] = [];
        for (const el of focusables) {
          el.focus();
          const cs = getComputedStyle(el);
          const ring =
            (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
            cs.boxShadow.includes("rgb");
          if (!ring) noRing.push(el.className || el.tagName);
        }
        return {
          deadAnchors: [...new Set(deadAnchors)],
          noRing: [...new Set(noRing)],
          count: focusables.length,
        };
      });
      expect(result.count).toBeGreaterThan(0);
      expect(
        result.deadAnchors,
        `<a> without href acting as a button (keyboard-unreachable):\n${result.deadAnchors.join("\n")}`,
      ).toEqual([]);
      expect(
        result.noRing,
        `focusable with no visible focus indicator:\n${result.noRing.join("\n")}`,
      ).toEqual([]);
    });

    test(`${name}: has exactly one h1 and skips no heading level`, async ({ page }) => {
      await open(page, hash);
      const levels = await page.evaluate(() =>
        [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
          .filter((e) => !e.closest("[hidden]") && (e as HTMLElement).offsetParent !== null)
          .map((e) => Number(e.tagName[1])),
      );
      expect(
        levels.filter((l) => l === 1),
        `expected exactly one <h1>, got ${levels.filter((l) => l === 1).length}`,
      ).toHaveLength(1);
      expect(levels[0], "the first heading must be the h1").toBe(1);
      for (let i = 1; i < levels.length; i++) {
        expect(
          levels[i] - levels[i - 1],
          `heading jumps from h${levels[i - 1]} to h${levels[i]} (outline: ${levels.join(" ")})`,
        ).toBeLessThanOrEqual(1);
      }
    });

    test(`${name}: touch targets are at least 44px tall at 375px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, hash);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        document
          .querySelectorAll('button:not([disabled]),a[href],input:not([type="hidden"]),select')
          .forEach((el) => {
            const e = el as HTMLElement;
            if (e.closest("[hidden]") || !e.offsetParent) return;
            const r = e.getBoundingClientRect();
            if (r.width === 0) return;
            // Inline controls legitimately expand their HIT AREA with a positioned
            // ::after rather than their box, so the box alone under-reports them.
            const ae = getComputedStyle(e, "::after");
            let h = r.height;
            if (ae && ae.content !== "none" && ae.position === "absolute") {
              const eh = parseFloat(ae.height);
              if (!Number.isNaN(eh) && eh > h) h = eh;
            }
            if (h < 44)
              out.push(`${e.className || e.tagName} ${Math.round(r.width)}x${Math.round(h)}`);
          });
        return [...new Set(out)];
      });
      expect(small, `controls under the 44px touch floor:\n${small.join("\n")}`).toEqual([]);
    });
  }

  // Dark mode is a second token set over the same scale. If it can drift on
  // contrast independently of light, it is not one system.
  test("dark mode holds the same contrast floor", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    for (const { name, hash } of PANELS) {
      await open(page, hash);
      const { fails } = (await page.evaluate(CONTRAST_PROBE)) as { fails: string[] };
      expect(fails, `${name} (dark) below the contrast floor:\n${fails.join("\n")}`).toEqual([]);
    }
    await ctx.close();
  });
});
