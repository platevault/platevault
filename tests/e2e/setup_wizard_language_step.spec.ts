// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-mode: first-run wizard's Language step (spec 061 US1,
 * T017-T022) — the wizard's new first step (FR-005), ahead of Source
 * Folders/Tools/Configuration/Observing Site/Confirm/Scan.
 *
 * The pt-BR catalog (`061-us3-ptbr-catalog`) is at full key parity with
 * en-GB, so once Portuguese is selected every wizard step heading and
 * button renders in Portuguese (spec 061 acceptance scenario 3) — the
 * locators below match the actual Portuguese strings, not an English
 * fallback. What this spec exists to pin: the language choice applies
 * immediately with no reload (FR-004), survives Back-navigation (FR-005
 * US1 scenario 5) and the rest of setup, and is still in effect once the
 * main app opens (FR-003).
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
    await expect(page.getByText('Escolha seu idioma preferido')).toBeVisible();

    // Advance through the rest of setup. pt-BR is at full key parity with
    // en-GB, so every step heading and navigation action renders in Portuguese.
    const continueButton = page.getByRole('button', {
      name: /^Continuar para/i,
    });
    await expect(continueButton).toBeVisible();
    await continueButton.click();
    await expect(
      page.getByRole('heading', { name: 'Onde seus dados residem?' }),
    ).toBeVisible();
    await expect(page.getByText(/^setup_/)).toHaveCount(0);

    // T020: Back-navigation returns to the Language step, and the earlier
    // choice is still there — a mistaken pick is recoverable.
    await page.getByRole('button', { name: /Voltar/i }).click();
    await expect(
      page.getByRole('heading', { name: 'Escolha seu idioma' }),
    ).toBeVisible();
    await expect(portuguese).toHaveAttribute('aria-pressed', 'true');

    // Forward again, then through the rest of the flow to Finish.
    await continueButton.click();
    await expect(
      page.getByRole('heading', { name: 'Onde seus dados residem?' }),
    ).toBeVisible();
    await continueButton.click(); // -> Processing Tools
    await continueButton.click(); // -> Configuration
    await continueButton.click(); // -> Observing Site (optional)
    const continueWithoutSite = page.getByTestId('setup-site-skip-ack');
    await continueWithoutSite.click(); // acknowledge skip
    await continueWithoutSite.click(); // proceed -> Confirm

    const startScan = page.getByRole('button', {
      name: /Iniciar escaneamento/i,
    });
    await expect(startScan).toBeVisible({ timeout: 10_000 });
    await startScan.click();

    const lightSource = page.getByTestId('scan-source-/astro/lights');
    await expect(lightSource.getByRole('status')).toContainText('Concluído', {
      timeout: 10_000,
    });
    await expect(lightSource).toContainText('Quadros de luz');
    await lightSource.getByRole('button').click();
    await expect(lightSource).toContainText('16 quadros de luz');
    await expect(lightSource).toContainText('2 quadros escuros');
    await expect(lightSource).toContainText('Mestre Escuro · Ha · 300 s');
    await expect(page.getByTestId('scan-summary')).toHaveAttribute(
      'role',
      'status',
    );

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
