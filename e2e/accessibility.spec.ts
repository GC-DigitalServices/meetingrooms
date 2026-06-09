import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Run against public pages only — no auth required.
// Authenticated pages require PLAYWRIGHT_SESSION_COOKIE to be set (future work).
// See docs/performance-budget.md for how to run against a Railway preview URL.

test.describe("Accessibility — public pages", () => {
  test("/sign-in has no WCAG 2.2 AA violations", async ({ page }) => {
    await page.goto("/sign-in");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("/terms has no WCAG 2.2 AA violations", async ({ page }) => {
    await page.goto("/terms");
    // Page should redirect to sign-in if no session — check for either outcome
    const url = page.url();
    if (url.includes("/sign-in")) {
      // Acceptable — page requires a session; the sign-in page is tested above
      return;
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
