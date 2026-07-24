// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { Page } from '@playwright/test';
import { expect, test } from './support/harness';

const THEME_CASES = [
  { id: 'warm-clay', label: 'Warm Clay', mode: 'light' },
  { id: 'warm-slate', label: 'Warm Slate', mode: 'light' },
  { id: 'observatory-dark', label: 'Observatory', mode: 'dark' },
  { id: 'espresso-dark', label: 'Espresso', mode: 'dark' },
  {
    id: 'observatory-cool-light',
    label: 'Observatory Cool',
    mode: 'light',
  },
  { id: 'observatory-cool', label: 'Observatory Cool', mode: 'dark' },
] as const;

const LOCALES = {
  'en-GB': {
    heading: 'Choose how PlateVault looks',
    picker: 'Theme',
    system: 'System · auto · dark',
    light: 'light',
    dark: 'dark',
  },
  'pt-BR': {
    heading: 'Escolha a aparência do PlateVault',
    picker: 'Tem\u0061',
    system: 'Sistema · auto · escuro',
    light: 'claro',
    dark: 'escuro',
  },
} as const;

const SYSTEM_RESOLUTION_CASES = [
  {
    colorScheme: 'light',
    accessibleName: 'System · auto · light',
    resolvedTheme: 'warm-slate',
  },
  {
    colorScheme: 'dark',
    accessibleName: 'System · auto · dark',
    resolvedTheme: 'observatory-cool',
  },
] as const;

function seedThemeStep(page: Page, locale: keyof typeof LOCALES): void {
  page.addInitScript((selectedLocale) => {
    window.localStorage.removeItem('alm-preferences');
    window.localStorage.setItem('pv.locale', selectedLocale);
    window.localStorage.setItem(
      'alm-setup-wizard-state',
      JSON.stringify({ version: 2, currentStep: 1 }),
    );
  }, locale);
}

async function openThemeStep(
  page: Page,
  locale: keyof typeof LOCALES = 'en-GB',
): Promise<void> {
  seedThemeStep(page, locale);
  await page.goto('/#/setup');
  await expect(
    page.getByRole('heading', { name: LOCALES[locale].heading }),
  ).toBeVisible({ timeout: 10_000 });
}

async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const selectors = [
      '.pv-step-theme',
      '.pv-theme-picker',
      '.pv-theme-specimen',
    ];
    return {
      documentFits:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
      surfacesFit: selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        return {
          selector,
          present: Boolean(element),
          fits: element
            ? element.scrollWidth <= element.clientWidth + 1
            : false,
        };
      }),
    };
  });

  expect(geometry.documentFits).toBe(true);
  expect(geometry.surfacesFit).toEqual(
    geometry.surfacesFit.map(({ selector }) => ({
      selector,
      present: true,
      fits: true,
    })),
  );
}

test.describe('setup wizard · Theme step', () => {
  for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
    test(`${locale} offers System and all six shipped themes`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openThemeStep(page, locale);

      const labels = LOCALES[locale];
      const picker = page.getByRole('group', { name: labels.picker });
      await expect(picker.getByRole('button')).toHaveCount(7);

      const system = picker.getByRole('button', { name: labels.system });
      await expect(system).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        'observatory-cool',
      );

      for (const theme of THEME_CASES) {
        const mode = theme.mode === 'light' ? labels.light : labels.dark;
        const choice = picker.getByRole('button', {
          name: `${theme.label} · ${mode}`,
          exact: true,
        });
        await choice.click();
        await expect(choice).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          theme.id,
        );
        await expect
          .poll(() => page.evaluate(() => localStorage.getItem('pv.theme')))
          .toBe(theme.id);
      }

      await system.click();
      await expect(system).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        'observatory-cool',
      );
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('pv.theme')))
        .toBe('system');
    });
  }

  for (const systemCase of SYSTEM_RESOLUTION_CASES) {
    test(`System follows the ${systemCase.colorScheme} OS theme and persists the System choice`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: systemCase.colorScheme });
      await openThemeStep(page);

      const explicitTheme = page.getByRole('button', {
        name: 'Espresso · dark',
      });
      await explicitTheme.click();
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        'espresso-dark',
      );

      const system = page.getByRole('button', {
        name: /^System · auto ·/,
      });
      await system.click();
      await expect(system).toHaveAttribute('aria-pressed', 'true');
      await expect(system).toHaveAccessibleName(systemCase.accessibleName);
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        systemCase.resolvedTheme,
      );
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('pv.theme')))
        .toBe('system');
    });
  }

  test('supports keyboard selection and restores the persisted theme after reload', async ({
    page,
  }) => {
    await openThemeStep(page);

    const warmClay = page.getByRole('button', {
      name: 'Warm Clay · light',
    });
    await warmClay.focus();
    await page.keyboard.press('Space');
    await expect(warmClay).toHaveAttribute('aria-pressed', 'true');

    const espresso = page.getByRole('button', {
      name: 'Espresso · dark',
    });
    await espresso.focus();
    await page.keyboard.press('Enter');
    await expect(espresso).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'espresso-dark',
    );

    await page.reload();
    await expect(
      page.getByRole('heading', { name: LOCALES['en-GB'].heading }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      'espresso-dark',
    );
    await expect(espresso).toHaveAttribute('aria-pressed', 'true');
  });

  test('desktop and 320 CSS px layouts have no horizontal page overflow', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 320, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await openThemeStep(page);
      await expectNoHorizontalPageOverflow(page);
    }
  });

  test('200%-equivalent layout reflows without horizontal page overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await openThemeStep(page, 'pt-BR');
    await page.evaluate(() => {
      document.documentElement.style.zoom = '200%';
    });
    await expectNoHorizontalPageOverflow(page);
  });
});
