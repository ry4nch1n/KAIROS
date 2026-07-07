import { test, expect } from "@playwright/test";

// Resilience: reproduce API states no DB seed can produce, by intercepting
// /api/* in the browser (Playwright route mocking). This is the capability
// argument for e2e over the vitest component tests — the SPA is exercised
// against synthetic backend failures, not just happy data.

const RADAR = 'section[data-svc="radar"]';

test.describe("Radar resilience", () => {
  test("survives an /api/overview 500 without white-screening", async ({ page }) => {
    await page.route("**/api/overview**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "boom" }),
      }),
    );

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto("/");

    // Shell + rail still render; Radar shows its graceful "Failed to load" card.
    await expect(page.locator(".rail")).toBeVisible();
    await expect(page.locator(RADAR)).toBeVisible();
    await expect(page.locator(RADAR).getByText(/Failed to load/i)).toBeVisible();

    // The rest of the app stays navigable despite the failed call.
    await page.getByRole("button", { name: "Revenue Model", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Revenue Model/ })).toBeVisible();

    expect(pageErrors, `unexpected uncaught errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
  });

  test("shows loading skeletons while /api/overview is slow", async ({ page }) => {
    await page.route("**/api/overview**", async (route) => {
      // Hold the response so the skeleton state is observable.
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    await page.goto("/");
    await expect(page.locator(`${RADAR} .skeleton`).first()).toBeVisible();
    // …and it resolves to a real chart once the (delayed) data lands.
    await expect(page.locator(`${RADAR} canvas`).first()).toBeVisible({ timeout: 15_000 });
  });
});
