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

// The two invariants, reused across service views and sub-tabs. Retried briefly:
// ECharts resize via ResizeObserver and the web-font swap can leave a transient
// sub-frame where a chart is momentarily wider than its box under CPU contention
// (parallel workers). A *real* overflow persists and still fails after the timeout.
async function assertFits(page: Page, scope: string, label: string) {
  await expect(async () => {
    const over = await pageOverflow(page);
    expect(over, `${label} scrolls the page horizontally by ${over}px at 375px`).toBeLessThanOrEqual(1);
    const clipped = await clippedValues(page, scope);
    expect(clipped, `${label} clips value(s) inside their card: ${clipped.join("; ")}`).toEqual([]);
  }).toPass({ timeout: 6000, intervals: [150, 300, 600, 1000] });
}

test.describe("mobile — layout fits at 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const svc of PANELS) {
    test(`${svc}: no page scroll, no clipped values`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: NAV[svc], exact: true }).click();
      await expect(page.locator(panel(svc))).toBeVisible();
      if (svc === "radar") {
        // Best-effort: wait for the first chart so we measure the rendered layout —
        // but don't hard-fail if ECharts is slow under parallel-worker load (the charts
        // are width:100% and can't cause page overflow anyway; the real risks are grids
        // and value displays, present with or without charts). assertFits() re-measures.
        await page.locator(`${panel(svc)} canvas`).first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      }
      await settle(page);
      await assertFits(page, panel(svc), svc);
    });
  }

  // Revenue has a Browser|Steam mode toggle; the loop above only covers the default
  // (Browser) panel. The Steam panel reuses the same .kpi-row/.rev-panel classes, so
  // it must clear the same bar — including Unity's extra two-input Pro-seats row.
  test("revenue Steam sub-tab fits (incl. Unity's extra input row)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Revenue Model", exact: true }).click();
    await expect(page.locator(panel("revenue"))).toBeVisible();

    // Browser → Steam via the mode segmented control in the topbar.
    await page.locator(`${panel("revenue")} .seg-btn`, { hasText: "Steam" }).click();
    await expect(page.locator(panel("revenue")).getByText("Net revenue (USD)")).toBeVisible();
    await settle(page);
    await assertFits(page, panel("revenue"), "revenue/steam (godot)");

    // Unity adds a "Pro seats × years" row of two side-by-side inputs — a distinct
    // overflow risk. Pick it from the sub-nav drawer and re-check.
    await page.locator(`${panel("revenue")} .nav-toggle`).click();
    await page.locator(`${panel("revenue")} .nav-item`, { hasText: "Unity" }).click();
    await expect(page.locator(panel("revenue")).getByText(/Unity Pro seats/)).toBeVisible();
    await settle(page);
    await assertFits(page, panel("revenue"), "revenue/steam (unity)");
  });

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
