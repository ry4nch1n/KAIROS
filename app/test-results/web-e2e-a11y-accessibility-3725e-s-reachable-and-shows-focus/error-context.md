# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: web\e2e\a11y.spec.ts >> accessibility — WCAG 2.1 AA >> brief: every interactive element is reachable and shows focus
- Location: web\e2e\a11y.spec.ts:93:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/#brief", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | 
  3   | // WCAG 2.1 AA as an executable gate.
  4   | //
  5   | // None of this decayed because anyone decided it should. It accumulated one
  6   | // component at a time, because nothing measured it: ~86 elements below the
  7   | // contrast floor, text down to 9px, zero focus indicators, no <h1> anywhere, and
  8   | // a section nav that no keyboard could reach. The mobile-overflow spec is the
  9   | // proof that a gate works here — horizontal overflow is the one axis that
  10  | // measured clean, because it was the one axis under test.
  11  | //
  12  | // Same spirit as routeParity and docsDrift: an executable invariant rather than a
  13  | // prose reminder.
  14  | //
  15  | // Deliberately NOT covered, because it is not machine-checkable to a useful
  16  | // standard: ARIA correctness, live-region announcement, and focus-trap behaviour.
  17  | // Those are reviewed, not gated.
  18  | 
  19  | const PANELS = [
  20  |   { name: "radar", hash: "#radar" },
  21  |   { name: "radar-comparables", hash: "#radar/comparables" },
  22  |   { name: "brief", hash: "#brief" },
  23  |   { name: "library", hash: "#library" },
  24  |   { name: "revenue", hash: "#revenue" },
  25  | ];
  26  | 
  27  | /** Colour parsing that understands what the browser actually returns.
  28  |  *  Chrome resolves color-mix() to `color(srgb 0.9 0.95 0.92)` — 0-1 floats.
  29  |  *  Reading those as 0-255 scores every mixed tint as near-black, which produces
  30  |  *  a page full of phantom failures. Both forms are handled. */
  31  | const CONTRAST_PROBE = `(() => {
  32  |   const parse = (c) => {
  33  |     if (!c) return null;
  34  |     const s = c.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)/);
  35  |     if (s) return [+s[1]*255, +s[2]*255, +s[3]*255, s[4] === undefined ? 1 : +s[4]];
  36  |     const m = c.match(/rgba?\\(([^)]+)\\)/);
  37  |     if (!m) return null;
  38  |     const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
  39  |     return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
  40  |   };
  41  |   const over = (fg, bg) => fg.slice(0,3).map((v,i) => v*fg[3] + bg[i]*(1-fg[3])).concat([1]);
  42  |   const lum = (c) => { const [r,g,b] = c.slice(0,3).map(v => { v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); }); return .2126*r+.7152*g+.0722*b; };
  43  |   const bgOf = (e) => {
  44  |     const stack = [];
  45  |     for (let n = e; n; n = n.parentElement) {
  46  |       const c = parse(getComputedStyle(n).backgroundColor);
  47  |       if (c && c[3] > 0) stack.push(c);
  48  |     }
  49  |     let acc = [255,255,255,1];
  50  |     for (let i = stack.length-1; i >= 0; i--) acc = over(stack[i], acc);
  51  |     return acc;
  52  |   };
  53  |   const fails = [], tiny = [];
  54  |   document.querySelectorAll('*').forEach(e => {
  55  |     const c = getComputedStyle(e);
  56  |     if (c.display === 'none' || c.visibility === 'hidden' || e.closest('[hidden]')) return;
  57  |     if (e.children.length || !e.textContent.trim()) return;
  58  |     // A gradient/image background cannot be sampled from a computed value, so a
  59  |     // reading here would be invented rather than measured.
  60  |     if (getComputedStyle(e).backgroundImage !== 'none') return;
  61  |     const fs = parseFloat(c.fontSize);
  62  |     const label = (e.className || e.tagName).toString().slice(0, 40);
  63  |     if (fs < 11) tiny.push(label + ' @' + fs + 'px');
  64  |     const fgRaw = parse(c.color);
  65  |     if (!fgRaw) return;
  66  |     const bg = bgOf(e), fg = over(fgRaw, bg);
  67  |     const L1 = lum(fg), L2 = lum(bg);
  68  |     const ratio = (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
  69  |     const large = fs >= 18 || (fs >= 14 && parseInt(c.fontWeight) >= 700);
  70  |     if (ratio < (large ? 3 : 4.5)) fails.push(label + ' ' + ratio.toFixed(2) + ':1 (' + c.color + ')');
  71  |   });
  72  |   return { fails: [...new Set(fails)], tiny: [...new Set(tiny)] };
  73  | })()`;
  74  | 
  75  | async function open(page: Page, hash: string) {
> 76  |   await page.goto("/" + hash);
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  77  |   // Panels fetch on mount; charts settle a frame later.
  78  |   await page.waitForTimeout(1500);
  79  | }
  80  | 
  81  | test.describe("accessibility — WCAG 2.1 AA", () => {
  82  |   for (const { name, hash } of PANELS) {
  83  |     test(`${name}: text meets the contrast floor and the 11px minimum`, async ({ page }) => {
  84  |       await open(page, hash);
  85  |       const { fails, tiny } = (await page.evaluate(CONTRAST_PROBE)) as {
  86  |         fails: string[];
  87  |         tiny: string[];
  88  |       };
  89  |       expect(fails, `text below 4.5:1 (large text 3:1):\n${fails.join("\n")}`).toEqual([]);
  90  |       expect(tiny, `text below the 11px floor:\n${tiny.join("\n")}`).toEqual([]);
  91  |     });
  92  | 
  93  |     test(`${name}: every interactive element is reachable and shows focus`, async ({ page }) => {
  94  |       await open(page, hash);
  95  |       const result = await page.evaluate(() => {
  96  |         const vis = (e: Element) =>
  97  |           !e.closest("[hidden]") && (e as HTMLElement).offsetParent !== null;
  98  |         // An <a> with an onClick and no href is not in the tab order and does not
  99  |         // fire on Enter — this is what made the whole section nav unreachable.
  100 |         const deadAnchors = [...document.querySelectorAll("a")]
  101 |           .filter((a) => vis(a) && !a.getAttribute("href"))
  102 |           .map((a) => a.className || a.textContent?.trim().slice(0, 30) || "a");
  103 | 
  104 |         const focusables = [
  105 |           ...document.querySelectorAll(
  106 |             'button:not([disabled]),a[href],input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])',
  107 |           ),
  108 |         ].filter(vis) as HTMLElement[];
  109 | 
  110 |         const noRing: string[] = [];
  111 |         for (const el of focusables) {
  112 |           el.focus();
  113 |           const cs = getComputedStyle(el);
  114 |           const ring =
  115 |             (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
  116 |             cs.boxShadow.includes("rgb");
  117 |           if (!ring) noRing.push(el.className || el.tagName);
  118 |         }
  119 |         return {
  120 |           deadAnchors: [...new Set(deadAnchors)],
  121 |           noRing: [...new Set(noRing)],
  122 |           count: focusables.length,
  123 |         };
  124 |       });
  125 |       expect(result.count).toBeGreaterThan(0);
  126 |       expect(
  127 |         result.deadAnchors,
  128 |         `<a> without href acting as a button (keyboard-unreachable):\n${result.deadAnchors.join("\n")}`,
  129 |       ).toEqual([]);
  130 |       expect(
  131 |         result.noRing,
  132 |         `focusable with no visible focus indicator:\n${result.noRing.join("\n")}`,
  133 |       ).toEqual([]);
  134 |     });
  135 | 
  136 |     test(`${name}: has exactly one h1 and skips no heading level`, async ({ page }) => {
  137 |       await open(page, hash);
  138 |       const levels = await page.evaluate(() =>
  139 |         [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
  140 |           .filter((e) => !e.closest("[hidden]") && (e as HTMLElement).offsetParent !== null)
  141 |           .map((e) => Number(e.tagName[1])),
  142 |       );
  143 |       expect(
  144 |         levels.filter((l) => l === 1),
  145 |         `expected exactly one <h1>, got ${levels.filter((l) => l === 1).length}`,
  146 |       ).toHaveLength(1);
  147 |       expect(levels[0], "the first heading must be the h1").toBe(1);
  148 |       for (let i = 1; i < levels.length; i++) {
  149 |         expect(
  150 |           levels[i] - levels[i - 1],
  151 |           `heading jumps from h${levels[i - 1]} to h${levels[i]} (outline: ${levels.join(" ")})`,
  152 |         ).toBeLessThanOrEqual(1);
  153 |       }
  154 |     });
  155 | 
  156 |     test(`${name}: touch targets are at least 44px tall at 375px`, async ({ page }) => {
  157 |       await page.setViewportSize({ width: 375, height: 812 });
  158 |       await open(page, hash);
  159 |       const small = await page.evaluate(() => {
  160 |         const out: string[] = [];
  161 |         document
  162 |           .querySelectorAll('button:not([disabled]),a[href],input:not([type="hidden"]),select')
  163 |           .forEach((el) => {
  164 |             const e = el as HTMLElement;
  165 |             if (e.closest("[hidden]") || !e.offsetParent) return;
  166 |             const r = e.getBoundingClientRect();
  167 |             if (r.width === 0) return;
  168 |             // Inline controls legitimately expand their HIT AREA with a positioned
  169 |             // ::after rather than their box, so the box alone under-reports them.
  170 |             const ae = getComputedStyle(e, "::after");
  171 |             let h = r.height;
  172 |             if (ae && ae.content !== "none" && ae.position === "absolute") {
  173 |               const eh = parseFloat(ae.height);
  174 |               if (!Number.isNaN(eh) && eh > h) h = eh;
  175 |             }
  176 |             if (h < 44)
```