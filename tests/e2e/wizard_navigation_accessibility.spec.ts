// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import {
  test,
  expect,
  seedSetupComplete,
  disableOnboarding,
} from './support/harness';
import type { Page } from '@playwright/test';

const PROJECT_NEXT_LABELS = [
  'Next: sources →',
  'Next: calibration →',
  'Next: source views →',
  'Next: naming →',
];
const PROJECT_REVIEW_LABEL = 'Next: review →';
const SETUP_LOCALES = {
  'en-GB': {
    heading: 'Choose your language',
    labels: [
      '1. Language',
      '2. Theme',
      '3. Source Folders',
      '4. Processing Tools',
      '5. Configuration',
      '6. Observing Site',
      '7. Confirm',
      '8. Scan',
    ],
  },
  'pt-BR': {
    heading: 'Escolha seu idioma',
    labels: [
      '1. Idioma',
      '2. Tem\u0061',
      '3. Pastas de origem',
      '4. Ferramentas de processamento',
      '5. Configuração',
      '6. Local de observação',
      '7. Confirmar',
      '8. Escaneamento',
    ],
  },
} as const;
type SetupLocale = keyof typeof SETUP_LOCALES;

function seedSetupWizard(page: Page): void {
  page.addInitScript(() => {
    window.localStorage.removeItem('alm-preferences');
    window.localStorage.removeItem('alm-setup-wizard-state');
    window.localStorage.setItem('alm.locale', 'en-GB');
  });
}

function recordScrollIntoView(page: Page): void {
  page.addInitScript(() => {
    const original = Element.prototype.scrollIntoView;
    const observed: ScrollIntoViewOptions[] = [];
    (
      window as typeof window & {
        __wizardScrollOptions: ScrollIntoViewOptions[];
      }
    ).__wizardScrollOptions = observed;
    Element.prototype.scrollIntoView = function (
      options?: boolean | ScrollIntoViewOptions,
    ) {
      if (typeof options === 'object') observed.push(options);
      original.call(this, options);
    };
  });
}

async function openSetupWizard(page: Page): Promise<void> {
  seedSetupWizard(page);
  await page.goto('/#/setup');
  await expect(
    page.getByRole('heading', { name: SETUP_LOCALES['en-GB'].heading }),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('wizard navigation accessibility', () => {
  test('desktop progress labels fit without truncation in English and Portuguese', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    await openSetupWizard(page);
    for (const locale of Object.keys(SETUP_LOCALES) as SetupLocale[]) {
      if (locale === 'pt-BR') {
        await page.getByRole('button', { name: 'Português (Brasil)' }).click();
        await page.getByRole('button', { name: /^Continuar para/i }).click();
        await expect(
          page.getByRole('heading', {
            name: 'Escolha a aparência do PlateVault',
          }),
        ).toBeVisible();
        await page.getByRole('button', { name: /Voltar/i }).click();
        await expect(
          page.getByRole('heading', { name: SETUP_LOCALES[locale].heading }),
        ).toBeVisible();
      }

      const bar = page.locator('.pv-wizard__steps-bar');
      const cards = bar.locator('.pv-wizard__steps-card');
      await expect(cards).toHaveText([...SETUP_LOCALES[locale].labels]);

      const geometry = await bar.evaluate((element) => {
        const barRect = element.getBoundingClientRect();
        const cardGeometry = Array.from(
          element.querySelectorAll<HTMLElement>('.pv-wizard__steps-card'),
        ).map((card) => {
          const rect = card.getBoundingClientRect();
          const style = getComputedStyle(card);
          return {
            horizontallyContained:
              rect.left >= barRect.left && rect.right <= barRect.right,
            contentFits:
              card.scrollWidth <= card.clientWidth + 1 &&
              card.scrollHeight <= card.clientHeight + 1,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
          };
        });
        return {
          documentOverflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
          overflowHintDisplay: getComputedStyle(
            element.parentElement?.querySelector(
              '.pv-wizard__steps-overflow-hint',
            ) ?? element,
          ).display,
          cards: cardGeometry,
        };
      });

      expect(geometry.documentOverflow).toBe(false);
      expect(geometry.horizontalOverflow).toBe(false);
      expect(geometry.overflowHintDisplay).toBe('none');
      expect(geometry.cards).toHaveLength(8);
      for (const card of geometry.cards) {
        expect(card).toEqual({
          horizontallyContained: true,
          contentFits: true,
          textOverflow: 'clip',
          whiteSpace: 'normal',
        });
      }

      await page.screenshot({
        path: testInfo.outputPath(`${locale}-desktop-step-1.png`),
        fullPage: true,
      });
    }
  });

  test('initial mount and same-step pointer activation do not steal focus', async ({
    page,
  }) => {
    await openSetupWizard(page);

    const heading = page.getByRole('heading', {
      name: 'Choose your language',
    });
    const currentStep = page.getByRole('button', { name: '1. Language' });
    await expect(heading).not.toBeFocused();

    await currentStep.click();
    await expect(currentStep).toBeFocused();
    await expect(heading).not.toBeFocused();
  });

  test('keyboard step activation focuses the new heading', async ({ page }) => {
    await openSetupWizard(page);

    const sources = page.getByRole('button', { name: '3. Source Folders' });
    await sources.focus();
    await sources.press('Enter');

    const heading = page.getByRole('heading', {
      name: 'Where does your data live?',
    });
    await expect(heading).toBeFocused();
    await expect(heading).toHaveAttribute('tabindex', '-1');
  });

  test('320px layout exposes horizontal overflow and keeps the active item visible', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await openSetupWizard(page);

    const bar = page.locator('.pv-wizard__steps-bar');
    const overflowAffordance = await bar.evaluate((element) => {
      const style = getComputedStyle(element);
      const hint = element.parentElement?.querySelector<HTMLElement>(
        '.pv-wizard__steps-overflow-hint',
      );
      const hintRect = hint?.getBoundingClientRect();
      return {
        horizontalOverflow: element.scrollWidth > element.clientWidth,
        scrollbarColor: style.scrollbarColor,
        hintVisible:
          getComputedStyle(hint ?? element).display === 'grid' &&
          (hintRect?.width ?? 0) > 0 &&
          (hintRect?.height ?? 0) > 0,
      };
    });
    expect(overflowAffordance.horizontalOverflow).toBe(true);
    expect(overflowAffordance.scrollbarColor).not.toBe('auto');
    expect(overflowAffordance.hintVisible).toBe(true);
    await expect(page.locator('.pv-wizard__steps-overflow-hint')).toHaveText(
      '↔',
    );
    await page.screenshot({
      path: testInfo.outputPath('en-GB-reflow-320-step-1.png'),
      fullPage: true,
    });

    const confirm = page.getByRole('button', { name: '7. Confirm' });
    await confirm.focus();
    await confirm.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Ready to go' }),
    ).toBeFocused();

    const active = page.getByRole('button', { name: '7. Confirm' });
    await expect
      .poll(() =>
        active.evaluate((element) => {
          const bar = element.parentElement;
          if (!bar) return false;
          const itemRect = element.getBoundingClientRect();
          const barRect = bar.getBoundingClientRect();
          return (
            itemRect.left >= barRect.left && itemRect.right <= barRect.right
          );
        }),
      )
      .toBe(true);

    await active.focus();
    const geometry = await active.evaluate((element) => {
      const bar = element.parentElement;
      if (!bar) throw new Error('progress bar missing');
      const barStyle = getComputedStyle(bar);
      const itemRect = element.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const hintRect = bar.parentElement
        ?.querySelector('.pv-wizard__steps-overflow-hint')
        ?.getBoundingClientRect();
      return {
        documentOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        horizontalOverflow: bar.scrollWidth > bar.clientWidth,
        overflowX: barStyle.overflowX,
        overflowY: barStyle.overflowY,
        focusRing: getComputedStyle(element).boxShadow,
        focusRingInside:
          itemRect.left - 2 >= barRect.left &&
          itemRect.right + 2 <= Math.min(barRect.right, hintRect?.left ?? 0),
      };
    });
    expect(geometry).toEqual({
      documentOverflow: false,
      horizontalOverflow: true,
      overflowX: 'auto',
      overflowY: 'hidden',
      focusRing: expect.not.stringMatching(/^none$/),
      focusRingInside: true,
    });
    await page.screenshot({
      path: testInfo.outputPath('en-GB-reflow-320-step-6.png'),
      fullPage: true,
    });

    const footerOrder = await page
      .locator('.pv-wizard__content--centered')
      .evaluate((content) => {
        const scroll = content.closest('.pv-wizard__scroll');
        const footer = content.querySelector('.pv-wizard__footer');
        return {
          footerInScroll: Boolean(scroll?.contains(footer)),
          footerInContent: Boolean(footer && content.contains(footer)),
          footerLast: content.lastElementChild === footer,
        };
      });
    expect(footerOrder).toEqual({
      footerInScroll: true,
      footerInContent: true,
      footerLast: true,
    });
  });

  test('project Review exposes and focuses its final-step heading', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await disableOnboarding(page);
    await page.goto('/#/projects/new');
    await expect(
      page.getByRole('heading', { name: /Step 1 · Name & profile/ }),
    ).toBeVisible({ timeout: 10_000 });

    for (const label of PROJECT_NEXT_LABELS) {
      await page.getByRole('button', { name: label }).click();
    }
    const review = page.getByRole('button', {
      name: PROJECT_REVIEW_LABEL,
    });
    await review.focus();
    await review.press('Enter');

    await expect(
      page.getByRole('heading', { name: /Step 6 · Review/ }),
    ).toBeFocused();
  });
});

test.describe('wizard navigation reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('active-step scrolling is instant', async ({ page }) => {
    recordScrollIntoView(page);
    await openSetupWizard(page);

    const confirm = page.getByRole('button', { name: '7. Confirm' });
    await confirm.focus();
    await confirm.press('Enter');

    await expect
      .poll(() =>
        page.evaluate(() => {
          const observed = (
            window as typeof window & {
              __wizardScrollOptions?: ScrollIntoViewOptions[];
            }
          ).__wizardScrollOptions;
          return observed?.[observed.length - 1]?.behavior;
        }),
      )
      .toBe('auto');
  });
});
