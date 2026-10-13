// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './support/harness';

// Each theme's display name is a catalogue message (settings_theme_name_*),
// so the localized accessible name is read from the same key the picker
// renders rather than retyped here per locale.
const THEME_CASES = [
  { id: 'warm-clay', nameKey: 'settings_theme_name_warm_clay', mode: 'light' },
  {
    id: 'warm-slate',
    nameKey: 'settings_theme_name_warm_slate',
    mode: 'light',
  },
  {
    id: 'observatory-dark',
    nameKey: 'settings_theme_name_observatory',
    mode: 'dark',
  },
  {
    id: 'espresso-dark',
    nameKey: 'settings_theme_name_espresso',
    mode: 'dark',
  },
  {
    id: 'observatory-cool-light',
    nameKey: 'settings_theme_name_observatory_cool_light',
    mode: 'light',
  },
  {
    id: 'observatory-cool',
    nameKey: 'settings_theme_name_observatory_cool',
    mode: 'dark',
  },
] as const;

/** The desktop message catalogue for `locale`, resolved from tests/e2e. */
function readCatalogue(
  testInfo: TestInfo,
  locale: keyof typeof LOCALES,
): Record<string, unknown> {
  const file = path.resolve(
    testInfo.project.testDir,
    '../../apps/desktop/messages',
    `${locale}.json`,
  );
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/**
 * The swatch's accessible name: `<theme name> · <mode>`. A name that already
 * ends in its mode (Observatory Cool · Light) carries it once, matching
 * ThemePicker's `themeAccessibleLabel`.
 */
function themeAccessibleName(themeName: string, modeLabel: string): string {
  const suffix = ` · ${modeLabel}`;
  const base = themeName
    .toLocaleLowerCase()
    .endsWith(suffix.toLocaleLowerCase())
    ? themeName.slice(0, -suffix.length)
    : themeName;
  return `${base}${suffix}`;
}

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
      '[data-testid="step-theme"]',
      '[data-testid="theme-picker"]',
      '[data-testid="theme-specimen"]',
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
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openThemeStep(page, locale);

      const labels = LOCALES[locale];
      const catalogue = readCatalogue(testInfo, locale);
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
        const themeName = catalogue[theme.nameKey];
        if (typeof themeName !== 'string') {
          throw new Error(`${locale} catalogue has no ${theme.nameKey}`);
        }
        const choice = picker.getByRole('button', {
          name: themeAccessibleName(themeName, mode),
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
