import { test, expect } from "@playwright/test";

// Resilience: reproduce API states no DB seed can produce, by intercepting
// /api/* in the browser (Playwright route mocking). This is the capability
// argument for e2e over the vitest component tests — the SPA is exercised
// against synthetic backend failures, not just happy data.

const RADAR = 'section[data-svc="radar"]';

// Radar opens on Steam (#135), so the call that runs on mount is `api.steam()` →
// GET /api/steam. Both specs below mock *that* endpoint: mocking the platform the
// panel no longer opens on would leave the failure/delay unreachable and the tests
// passing for the wrong reason.
const MOUNT_ENDPOINT = "**/api/steam**";

test.describe("Radar resilience", () => {
  test("survives an /api/steam 500 without white-screening", async ({ page }) => {
    await page.route(MOUNT_ENDPOINT, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "boom" }),
      }),
    );

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto("/");

    // Shell + rail still render; Radar shows its graceful failure card.
    await expect(page.locator(".rail")).toBeVisible();
    await expect(page.locator(RADAR)).toBeVisible();

    // Asserted by ROLE and RECOVERY, not by copy. The old assertion pinned the
    // string "Failed to load", which was the defect: that message named a JS
    // error class and offered no way out. What must hold is that the failure is
    // announced as an alert and carries a retry — both survive a rewording.
    const alert = page.locator(RADAR).getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: /try again/i })).toBeVisible();
    // And it must not leak an exception class at the reader.
    await expect(alert.locator(".lf-head b")).not.toHaveText(/Error|TypeError/);

    // The rest of the app stays navigable despite the failed call.
    await page.getByRole("button", { name: "Revenue Model", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Revenue Model/ })).toBeVisible();

    expect(pageErrors, `unexpected uncaught errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
  });

  test("shows loading skeletons while /api/steam is slow", async ({ page }) => {
    // Hold the response open under test control rather than on a timer. Radar renders
    // a <Skel/> whenever its data is null, so a skeleton on screen is only evidence of
    // the *loading* state if the request is provably still in flight — with a fixed
    // sleep this asserted nothing (it passed even when the mock never fired).
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    await page.route(MOUNT_ENDPOINT, async (route) => {
      calls++;
      await held;
      await route.continue();
    });

    await page.goto("/");
    await expect(page.locator(`${RADAR} .skeleton`).first()).toBeVisible();
    // (React StrictMode double-invokes effects in dev, so the count is ≥1, not ==1.)
    expect(
      calls,
      "Radar never called the endpoint it is supposed to load on mount",
    ).toBeGreaterThan(0);

    release();
    // …and it resolves to a real chart once the (delayed) data lands — the skeleton
    // is a transient loading state, not something the panel is stuck in.
    await expect(page.locator(`${RADAR} canvas`).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`${RADAR} .skeleton`)).toHaveCount(0);
  });
});
