import { test, expect, type Page } from "@playwright/test";

// Mobile layout guard. The SPA is opened on phones, so at a phone width every
// service must (a) not scroll the page horizontally and (b) not clip its value
// displays inside their cards. Both failure modes have shipped: the Radar sub-nav
// spilled the page, and the Revenue KPI numbers were clipped inside overflow-hidden
// cards (page didn't scroll — the card hid the spill — so a page-scroll check alone
// misses it). This asserts both. Wide data tables may still scroll INSIDE their box.

const PANELS = ["radar", "brief", "library", "revenue"] as const;
type Panel = (typeof PANELS)[number];

// Rail buttons expose their service via aria-label (see components/Rail.tsx).
const NAV: Record<Panel, string> = {
  radar: "GameRadar",
  brief: "News Brief",
  library: "Library",
  revenue: "Revenue Model",
};

const panel = (p: Panel) => `section[data-svc="${p}"]`;

// Value displays that live inside overflow-hidden cards — these must fit their box
// (a clipped number reads as "text outside the box"). Not tables (they scroll on
// purpose) or clamped prose (`.pfield` line-clamps vertically by design).
const MUST_FIT = ":is(.kpi-big, .kpi .val)";

function pageOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

// Value elements whose content is wider than their box (horizontally clipped).
function clippedValues(page: Page, scope: string) {
  return page.$$eval(`${scope} ${MUST_FIT}`, (els) =>
    els
      .filter((e) => e.scrollWidth > e.clientWidth + 1)
      .map((e) => `"${(e.textContent || "").trim().slice(0, 24)}" (content ${e.scrollWidth}px > box ${e.clientWidth}px)`),
  );
}

// Fonts change text width, so wait for the real (Fira) faces before measuring —
// a fallback face could hide a clip that ships on the phone.
async function settle(page: Page) {
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
  });
  await page.waitForTimeout(500);
}

test.describe("mobile — layout fits at 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const svc of PANELS) {
    test(`${svc}: no page scroll, no clipped values`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: NAV[svc], exact: true }).click();
      await expect(page.locator(panel(svc))).toBeVisible();
      if (svc === "radar") {
        await expect(page.locator(`${panel(svc)} canvas`).first()).toBeVisible({ timeout: 15_000 });
      }
      await settle(page);

      const over = await pageOverflow(page);
      expect(over, `${svc} scrolls the page horizontally by ${over}px at 375px`).toBeLessThanOrEqual(1);

      const clipped = await clippedValues(page, panel(svc));
      expect(clipped, `${svc} clips value(s) inside their card: ${clipped.join("; ")}`).toEqual([]);
    });
  }

  test("a wide Radar data table scrolls in-container, not the page", async ({ page }) => {
    await page.goto("/");
    // On mobile the sub-nav lives in a drawer — open it, jump to a table-heavy view.
    await page.locator(`${panel("radar")} .nav-toggle`).click();
    await page.locator(`${panel("radar")} .nav-item`, { hasText: "Genre Explorer" }).click();
    await expect(page.locator(`${panel("radar")} .dtable`).first()).toBeVisible({ timeout: 15_000 });
    await settle(page);
    const over = await pageOverflow(page);
    expect(over, `Genre Explorer spilled to the page (${over}px) instead of scrolling in its box`).toBeLessThanOrEqual(1);
  });
});
