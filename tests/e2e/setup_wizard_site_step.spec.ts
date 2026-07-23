// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-mode: first-run wizard's Observing Site step (spec 044
 * Track B, US6 T016 — `StepSite.tsx`).
 *
 * Genuinely missing at the mock-e2e layer per
 * `docs/development/e2e-mock-coverage-audit-2026-07-05.md` ("1 / spec 044
 * US3 | Manage observing sites (Settings/wizard Site step itself)... |
 * UNCOVERED — StepSite.tsx has no dedicated test at any layer, mock or
 * vitest"). `ObservingSites.tsx` (the Settings editor) has vitest coverage;
 * the wizard step reusing the same field set did not.
 *
 * Scope note: `SetupWizard.handleFinish` only persists the site (via
 * `saveSites`) when `!isMockMode` — under `VITE_USE_MOCKS=true` (this
 * suite's only runtime) that whole branch is skipped, so real persistence
 * to the site-store cannot be proven here. What CAN be proven at this layer
 * — and is real, unmocked component behavior, not gated by `isMockMode` —
 * is `StepSite`'s own rendering, its `siteStepError` inline validation, and
 * that the step is genuinely optional (FR-025: blank never blocks
 * Continue). Real site persistence is covered for the Settings editor by
 * `ObservingSites.test.tsx` (vitest) and, end-to-end, by the Layer-2
 * `targets_journeys.rs` journeys.
 *
 * Jumps directly to the Site step (index 3) by seeding
 * `alm-setup-wizard-state`, the same technique
 * `regression_setup_legacy_catalog.spec.ts` uses — avoids re-walking the
 * Sources/Tools/Config steps for every test.
 */
import { test, expect } from './support/harness';

function seedWizardAtSiteStep(page: import('@playwright/test').Page): void {
  page.addInitScript(() => {
    window.localStorage.removeItem('alm-preferences');
    window.localStorage.setItem(
      'alm-setup-wizard-state',
      JSON.stringify({
        currentStep: 4, // Site step (STEPS[4]; spec 044 US3 put it before Confirm,
        // then spec 061 US1's new Language step at index 0 shifted it 3→4).
        sources: [
          {
            kind: 'light_frames',
            path: '/astro/lights',
            scanDepth: 'recursive',
          },
          { kind: 'project', path: '/astro/projects', scanDepth: 'recursive' },
        ],
        catalogSettings: { selectedCatalogIds: [] },
        tools: {
          pixinsight: { enabled: false, path: null },
          siril: { enabled: false, path: null },
        },
      }),
    );
  });
}

test.describe('setup wizard · Observing Site step (spec 044 US3/T016)', () => {
  test('renders the optional-site copy and advances to Confirm when left blank', async ({
    page,
  }) => {
    seedWizardAtSiteStep(page);
    await page.goto('/#/setup');

    await expect(
      page.getByRole('heading', { name: 'Where do you observe from?' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/Optional — add one observing site now, or skip/i),
    ).toBeVisible();
    await expect(
      page.getByText(/You can leave this blank and set it up later/i),
    ).toBeVisible();

    // Every field starts empty — never a pre-filled or fabricated value.
    await expect(page.locator('#setup-site-name')).toHaveValue('');
    await expect(page.locator('#setup-site-lat')).toHaveValue('');
    await expect(page.locator('#setup-site-lon')).toHaveValue('');

    // FR-025: the step is entirely optional — leaving it blank must still
    // advance. Skipping is acknowledged rather than blocked (#1050): on an
    // empty step the primary action names the consequence, the first click
    // reveals it, and the second proceeds.
    const skipBtn = page.getByRole('button', {
      name: 'Continue without a site →',
    });
    await expect(skipBtn).toBeEnabled();
    await skipBtn.click();

    // Still on the site step, now with the cost of skipping spelled out.
    const skipWarning = page.getByTestId('setup-site-skip-warning');
    await expect(skipWarning).toBeVisible();
    await expect(skipWarning).toHaveAttribute('role', 'status');
    await expect(skipWarning).toHaveAttribute('aria-live', 'polite');
    await expect(
      page.getByRole('heading', { name: 'Where do you observe from?' }),
    ).toBeVisible();

    await skipBtn.click();
    await expect(
      page.getByRole('heading', { name: 'Ready to go' }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByTestId('app-error-boundary-fallback'),
    ).not.toBeVisible();
  });

  test('an out-of-range latitude surfaces the real, localized inline validation error', async ({
    page,
  }) => {
    seedWizardAtSiteStep(page);
    await page.goto('/#/setup');
    await expect(
      page.getByRole('heading', { name: 'Where do you observe from?' }),
    ).toBeVisible({ timeout: 10_000 });

    // siteStepError only fires once the step is non-empty (siteStepHasSite) —
    // name + lat + lon must all be filled in first.
    await page.locator('#setup-site-name').fill('Backyard');
    await page.locator('#setup-site-lon').fill('10');
    await page.locator('#setup-site-lat').fill('200');

    const latitude = page.locator('#setup-site-lat');
    await expect(latitude).toHaveAttribute('aria-invalid', 'true');
    await expect(latitude).toHaveAttribute(
      'aria-describedby',
      'setup-site-lat-error',
    );
    await expect(page.locator('#setup-site-lat-error')).toHaveText(
      'Latitude must be a number between -90 and 90.',
    );
    await expect(latitude).toBeFocused();
  });

  test("a valid site's field values are retained across Back/Continue navigation", async ({
    page,
  }) => {
    seedWizardAtSiteStep(page);
    await page.goto('/#/setup');
    await expect(
      page.getByRole('heading', { name: 'Where do you observe from?' }),
    ).toBeVisible({ timeout: 10_000 });

    await page.locator('#setup-site-name').fill('Backyard Observatory');
    await page.locator('#setup-site-lat').fill('51.5');
    await page.locator('#setup-site-lon').fill('-0.1');
    await expect(page.getByText(/must be a number between/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Continue to confirm →' }).click();
    await expect(
      page.getByRole('heading', { name: 'Ready to go' }),
    ).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: '← Back' }).click();
    await expect(
      page.getByRole('heading', { name: 'Where do you observe from?' }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#setup-site-name')).toHaveValue(
      'Backyard Observatory',
    );
    await expect(page.locator('#setup-site-lat')).toHaveValue('51.5');
    await expect(page.locator('#setup-site-lon')).toHaveValue('-0.1');
  });
});
