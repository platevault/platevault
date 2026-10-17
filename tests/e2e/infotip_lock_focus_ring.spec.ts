// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from '@playwright/test';

test('InfoTip and Lock focus rings differ from hover', async ({ page }) => {
  await page.goto('/focus-ring-fixture.html');

  await page.getByTestId('fixture-start').focus();
  const sharedFocusRing = await page
    .getByTestId('shared-focus-ring')
    .evaluate((element) => getComputedStyle(element).boxShadow);
  expect(sharedFocusRing).not.toBe('none');

  for (const testId of ['info-tip', 'lock-focus-target']) {
    await page.getByTestId('fixture-start').focus();
    await page.keyboard.press('Tab');
    if (testId === 'lock-focus-target') await page.keyboard.press('Tab');
    const target = page.getByTestId(testId);
    await expect(target).toBeVisible();

    await expect(target).toBeFocused();
    const focusStyle = await target.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        boxShadow: computed.boxShadow,
        borderColor: computed.borderColor,
        color: computed.color,
      };
    });
    expect(focusStyle.boxShadow).toBe(sharedFocusRing);

    await target.evaluate((element) => element.blur());
    await target.hover();
    const hoverStyle = await target.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        boxShadow: computed.boxShadow,
        borderColor: computed.borderColor,
        color: computed.color,
      };
    });
    expect(hoverStyle.boxShadow).not.toBe(sharedFocusRing);
    expect(hoverStyle).not.toEqual(focusStyle);

    await page.mouse.move(0, 0);
  }
});
