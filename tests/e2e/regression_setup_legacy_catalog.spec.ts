/**
 * Regression — setup wizard tolerates legacy persisted `catalogSettings`.
 *
 * The catalog step was reworked from `{ downloadAll: boolean }` to
 * `{ selectedCatalogIds: string[] }`. Wizard state is persisted in
 * `localStorage["alm-setup-wizard-state"]`, so a user mid-setup before the
 * rework had the OLD shape saved. `loadWizardState` kept `parsed.catalogSettings`
 * verbatim (it was truthy), so `StepConfirm`/`StepCatalogs` read
 * `selectedCatalogIds.length` on `undefined` → "Cannot read properties of
 * undefined (reading 'length')" and the error boundary.
 *
 * Fix: `loadWizardState` coerces any `catalogSettings` lacking the
 * `selectedCatalogIds` array to the default. This pins it.
 *
 * Verification layer: PE — Playwright mocks-UI (run in WSL).
 */
import { test, expect } from "@playwright/test";

// App uses createHashHistory; setup wizard reads its persisted state on mount.
function seedLegacyWizardState(page: import("@playwright/test").Page): void {
  page.addInitScript(() => {
    // Not setup-complete → SetupPage renders the wizard (mock mode skips the gate).
    window.localStorage.removeItem("alm-preferences");
    window.localStorage.setItem(
      "alm-setup-wizard-state",
      JSON.stringify({
        currentStep: 3, // Confirm step — reads catalogSettings.selectedCatalogIds.length
        sources: [
          { kind: "light_frames", path: "/astro/lights", scanDepth: "recursive" },
          { kind: "project", path: "/astro/projects", scanDepth: "recursive" },
          { kind: "inbox", path: "/astro/inbox", scanDepth: "recursive" },
        ],
        // OLD shape — no `selectedCatalogIds`.
        catalogSettings: { downloadAll: true },
        tools: {
          pixinsight: { enabled: false, path: null },
          siril: { enabled: false, path: null },
        },
      }),
    );
  });
}

test.describe("Regression · setup legacy catalogSettings", () => {
  test("Confirm step renders with legacy {downloadAll} state (no crash)", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    seedLegacyWizardState(page);
    await page.goto("/#/setup");

    // The error boundary must NOT appear, and no 'length' of undefined error.
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    // Confirm step heading (from SetupWizard STEPS[3]).
    await expect(page.getByText(/Ready to go/i)).toBeVisible({ timeout: 10_000 });

    expect(
      errors.filter((e) => /Cannot read properties of undefined/i.test(e)),
      `page errors: ${errors.join(" | ")}`,
    ).toHaveLength(0);
  });

  test("Catalogs step renders with legacy {downloadAll} state (no crash)", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    page.addInitScript(() => {
      window.localStorage.removeItem("alm-preferences");
      window.localStorage.setItem(
        "alm-setup-wizard-state",
        JSON.stringify({
          currentStep: 2, // Catalogs step
          sources: [],
          catalogSettings: { downloadAll: true },
          tools: {
            pixinsight: { enabled: false, path: null },
            siril: { enabled: false, path: null },
          },
        }),
      );
    });
    await page.goto("/#/setup");

    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    await expect(page.getByText(/catalog/i).first()).toBeVisible({ timeout: 10_000 });
    expect(
      errors.filter((e) => /Cannot read properties of undefined/i.test(e)),
      `page errors: ${errors.join(" | ")}`,
    ).toHaveLength(0);
  });
});
