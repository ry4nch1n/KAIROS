import { test, expect } from "@playwright/test";

// Happy-path smoke: the shell boots, the rail switches all four services, and
// Radar renders a real chart from seeded data. Runs against the live dev stack.

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

test.describe("KAIROS shell", () => {
  test("boots with the Radar panel active", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(panel("radar"))).toBeVisible();
    for (const p of ["brief", "library", "revenue"] as Panel[]) {
      await expect(page.locator(panel(p))).toBeHidden();
    }
  });

  test("rail switches between all four services", async ({ page }) => {
    await page.goto("/");
    for (const svc of PANELS) {
      await page.getByRole("button", { name: NAV[svc], exact: true }).click();
      await expect(page.locator(panel(svc))).toBeVisible();
      for (const other of PANELS.filter((o) => o !== svc)) {
        await expect(page.locator(panel(other))).toBeHidden();
      }
    }
  });

  test("Radar renders an ECharts canvas from seeded data", async ({ page }) => {
    await page.goto("/");
    // EChart mounts a <canvas> once /api/overview resolves; auto-waits for data.
    await expect(page.locator(`${panel("radar")} canvas`).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Revenue panel shows its heading", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Revenue Model", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Revenue Model/ })).toBeVisible();
  });
});
