// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-mode: first-run wizard's Language step (spec 061 US1,
 * T017-T022) — the wizard's new first step (FR-005), ahead of Source
 * Folders/Tools/Configuration/Observing Site/Confirm/Scan.
 *
 * Scope note on "renders in Portuguese" (spec 061 acceptance scenario 3):
 * this branch stacks on `061-p1-locale-runtime` and lands independently of
 * `061-us3-ptbr-catalog`, which owns the full pt-BR message catalog. At this
 * point in the stack `messages/pt-BR.json` is still a 5-key stub, so most
 * wizard step headings fall back to the base locale by design (FR-009) —
 * that fallback is what's asserted below, not translated Portuguese text.
 * What IS fully verifiable here, and is the actual mechanism this spec
 * exists to pin: the language choice applies immediately with no reload
 * (FR-004), survives Back-navigation (FR-005 US1 scenario 5) and the rest of
 * setup, and is still in effect once the main app opens (FR-003).
 *
 * Sources are pre-seeded in `alm-setup-wizard-state` (same technique
 * `setup_wizard_site_step.spec.ts` and `regression_setup_legacy_catalog.spec.ts`
 * use) so the flow can drive from Language through Finish without needing a
 * native folder-picker dialog, which Playwright cannot drive headlessly.
 */
import { test, expect } from './support/harness';

function seedFreshWizardWithSources(
  page: import('@playwright/test').Page,
): void {
  page.addInitScript(() => {
    window.localStorage.removeItem('alm-preferences');
    window.localStorage.setItem(
      'alm-setup-wizard-state',
      JSON.stringify({
        currentStep: 0, // Language step (spec 061 US1) — always first (FR-005).
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

test.describe('setup wizard · Language step (spec 061 US1)', () => {
  test('is the first step, ahead of Source Folders, with both shipped locales', async ({
    page,
  }) => {
    page.addInitScript(() => {
      window.localStorage.removeItem('alm-preferences');
      window.localStorage.removeItem('alm-setup-wizard-state');
    });
    await page.goto('/#/setup');

    await expect(
      page.getByRole('heading', { name: 'Choose your language' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Setup · Step 1 of 7')).toBeVisible();

    const english = page.getByRole('button', { name: 'English (UK)' });
    const portuguese = page.getByRole('button', {
      name: 'Português (Brasil)',
    });
    await expect(english).toBeVisible();
    await expect(portuguese).toBeVisible();
    // Base locale starts active (FR-001/FR-002 default).
    await expect(english).toHaveAttribute('aria-pressed', 'true');
    await expect(portuguese).toHaveAttribute('aria-pressed', 'false');
  });

  test('selecting a language applies immediately with no reload, survives Back, and persists to the main app', async ({
    page,
  }) => {
    seedFreshWizardWithSources(page);
    await page.goto('/#/setup');

    await expect(
      page.getByRole('heading', { name: 'Choose your language' }),
    ).toBeVisible({ timeout: 10_000 });

    // A marker that only survives if the choice below applies in place — a
    // full navigation/reload would reset the JS context and wipe it
    // (FR-004: "without a reload").
    await page.evaluate(() => {
      (window as unknown as { __noReloadMarker: boolean }).__noReloadMarker =
        true;
    });

    const portuguese = page.getByRole('button', {
      name: 'Português (Brasil)',
    });
    await portuguese.click();

    await expect(portuguese).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __noReloadMarker?: boolean })
            .__noReloadMarker,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('alm.locale'))).toBe(
      'pt-BR',
    );

    // Advance through the rest of setup. Steps whose message keys pt-BR
    // doesn't have yet fall back to English (FR-009) — this only proves no
    // raw key ever leaks to the screen, not that the string is translated.
    await page.getByRole('button', { name: /Continue/i }).click();
    await expect(
      page.getByRole('heading', { name: 'Where does your data live?' }),
    ).toBeVisible();
    await expect(page.getByText(/^setup_/)).toHaveCount(0);

    // T020: Back-navigation returns to the Language step, and the earlier
    // choice is still there — a mistaken pick is recoverable.
    await page.getByRole('button', { name: /Back/i }).click();
    await expect(
      page.getByRole('heading', { name: 'Choose your language' }),
    ).toBeVisible();
    await expect(portuguese).toHaveAttribute('aria-pressed', 'true');

    // Forward again, then through the rest of the flow to Finish.
    await page.getByRole('button', { name: /Continue/i }).click();
    await expect(
      page.getByRole('heading', { name: 'Where does your data live?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: /Continue/i }).click(); // -> Processing Tools
    await page.getByRole('button', { name: /Continue/i }).click(); // -> Configuration
    await page.getByRole('button', { name: /Continue/i }).click(); // -> Observing Site (optional)
    await page
      .getByRole('button', { name: /Continue without a site/i })
      .click(); // acknowledge skip
    await page
      .getByRole('button', { name: /Continue without a site/i })
      .click(); // proceed -> Confirm

    await expect(page.getByRole('button', { name: /Start scan/i })).toBeVisible(
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /Start scan/i }).click();

    const finishBtn = page.getByTestId('finish-button');
    await expect(finishBtn).toBeEnabled({ timeout: 10_000 });
    await finishBtn.click();

    // Setup completes and the main app opens (US1 acceptance scenario 3) —
    // the language choice is still in effect.
    await expect(page).toHaveURL(/#\/inbox/, { timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem('alm.locale'))).toBe(
      'pt-BR',
    );
  });
});
