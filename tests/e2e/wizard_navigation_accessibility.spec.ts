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

function seedSetupWizard(page: Page): void {
  page.addInitScript(() => {
    window.localStorage.removeItem('alm-preferences');
    window.localStorage.removeItem('alm-setup-wizard-state');
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
    page.getByRole('heading', { name: 'Choose your language' }),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('wizard navigation accessibility', () => {
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

    const sources = page.getByRole('button', { name: '2. Source Folders' });
    await sources.focus();
    await sources.press('Enter');

    const heading = page.getByRole('heading', {
      name: 'Where does your data live?',
    });
    await expect(heading).toBeFocused();
    await expect(heading).toHaveAttribute('tabindex', '-1');
  });

  test('320px layout isolates horizontal progress overflow and keeps the active item visible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await openSetupWizard(page);

    const confirm = page.getByRole('button', { name: '6. Confirm' });
    await confirm.focus();
    await confirm.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Ready to go' }),
    ).toBeFocused();

    const active = page.getByRole('button', { name: '6. Confirm' });
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
          itemRect.right + 2 <= barRect.right,
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

    const confirm = page.getByRole('button', { name: '6. Confirm' });
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
