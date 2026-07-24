// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Playwright mock-e2e: completion choreography (spec 056, US3 T025).
 *
 * Covers the completion choreography layered onto `ChecklistSection.tsx` by
 * T024: an in-place check animation + emphasis, the drop to the group's
 * completed area, the automatic-tick progress pulse, and the polite per-tick
 * aria-live announcement, plus reduced-motion parity.
 *
 * The checklist is only mounted inside the `.pv-onb-ring` flyout (portalled to
 * `document.body`), so every test opens it first — see `openChecklist`.
 *
 * Automatic ticks require the real event bus, so the mock cannot trigger that
 * state transition. A browser fixture applies the production animation classes
 * to prove the tick, progress, and spotlight shorthands all parse.
 *
 * ── No per-row dismiss ──────────────────────────────────────────────────────
 *  The per-row dismiss "X" was deliberately removed: the round checkbox is the
 *  single per-item completion affordance, and whole-section removal lives in
 *  the section header's ··· menu (covered by `onboarding_removal.spec.ts`).
 *  The dismiss choreography test that used to live here was deleted with it —
 *  re-pointing it at the checkbox would have duplicated the manual check-off
 *  test below verbatim.
 */

import {
  test,
  expect,
  landOnMockRoute,
  openChecklist,
  ONB_SECTION as SECTION,
} from './support/harness';
import type { Page } from '@playwright/test';

interface AnimationStyle {
  name: string;
  duration: string;
  timing: string;
  iterations: string;
}

async function readChoreographyAnimations(
  page: Page,
): Promise<Record<'tick' | 'progress' | 'spotlight', AnimationStyle>> {
  return page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div data-animation="tick" class="pv-onb-checklist__item--completing"></div>
      <div class="pv-onb-checklist__progress--pulse">
        <span data-animation="progress" class="pv-onb-checklist__progress-fill"></span>
      </div>
      <svg><rect data-animation="spotlight" class="react-joyride__spotlight"></rect></svg>
    `;
    document.body.append(host);
    document.documentElement.dataset.onbSpotlightPulse = 'on';

    const read = (name: string): AnimationStyle => {
      const element = host.querySelector<HTMLElement | SVGElement>(
        `[data-animation="${name}"]`,
      );
      if (!element) throw new Error(`missing ${name} animation probe`);
      const style = getComputedStyle(element);
      return {
        name: style.animationName,
        duration: style.animationDuration,
        timing: style.animationTimingFunction,
        iterations: style.animationIterationCount,
      };
    };

    try {
      return {
        tick: read('tick'),
        progress: read('progress'),
        spotlight: read('spotlight'),
      };
    } finally {
      delete document.documentElement.dataset.onbSpotlightPulse;
      host.remove();
    }
  });
}

/** Open the checklist flyout and wait for its body (no-op when already open). */
test.describe('onboarding completion choreography (spec 056 US3)', () => {
  test('renders a polite aria-live region for per-tick announcements (T024)', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    const announcer = page.locator(
      `${SECTION} [role="status"][aria-live="polite"]`,
    );
    await expect(announcer).toHaveCount(1);
  });

  test('production animation classes resolve complete shorthands', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    await expect(readChoreographyAnimations(page)).resolves.toEqual({
      tick: {
        name: 'pv-onb-tick-pop',
        duration: '0.15s',
        timing: 'ease-out',
        iterations: '1',
      },
      progress: {
        name: 'pv-onb-progress-pulse',
        duration: '0.6s',
        timing: 'ease-in-out',
        iterations: '2',
      },
      spotlight: {
        name: 'pv-onb-spotlight-pulse',
        duration: '1s',
        timing: 'ease-in-out',
        iterations: 'infinite',
      },
    });
  });

  test('manual check-off plays the in-place choreography then moves the item to the completed area', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    const row = page.locator('[data-item-id="sessions.review_first"]');
    await page.getByRole('checkbox', { name: 'Review a session' }).click();

    // In place first: the row carries the completing marker while it animates.
    await expect(row).toHaveAttribute('data-completing', 'true');
    // Then it settles into the greyed, checked completed area of its group.
    await expect(
      page.locator(
        `[data-testid="onb-checklist-completed"] [data-item-id="sessions.review_first"]`,
      ),
    ).toBeVisible();
  });

  test('a completed item can be un-checked from the completed area', async ({
    page,
  }) => {
    await landOnMockRoute(page, '/#/sessions');
    await openChecklist(page);

    const done = page.locator(
      `[data-testid="onb-checklist-completed"] [data-item-id="sessions.review_first"]`,
    );

    await page.getByRole('checkbox', { name: 'Review a session' }).click();
    await expect(done).toBeVisible();

    // The completed row is struck through and greyed rather than hidden
    // precisely so it can be taken back — its tick is a live control, not
    // decoration. A click landing on a crossed-out row and doing nothing
    // would read as broken.
    await done.getByRole('checkbox').click();

    await expect(done).toHaveCount(0);
    // Back among the group's open items, checkable again.
    await expect(
      page.getByRole('checkbox', { name: 'Review a session' }),
    ).toBeVisible();
  });

  test.describe('reduced motion parity', () => {
    // `reducedMotion` moved out of the top-level `PlaywrightTestOptions` type
    // in @playwright/test 1.61.1 (still a real BrowserContextOptions field,
    // still applied at runtime) — set it via the `contextOptions` escape
    // hatch instead of the removed direct property.
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test('completion applies the final state instantly with no animation (FR-020)', async ({
      page,
    }) => {
      await landOnMockRoute(page, '/#/sessions');
      await openChecklist(page);

      const noAnimation = {
        name: 'none',
        duration: '1e-06s',
        timing: 'ease',
        iterations: '1',
      };
      await expect(readChoreographyAnimations(page)).resolves.toEqual({
        tick: noAnimation,
        progress: noAnimation,
        spotlight: noAnimation,
      });

      await page.getByRole('checkbox', { name: 'Review a session' }).click();

      // No transient completing marker under reduced motion …
      await expect(page.locator('[data-completing="true"]')).toHaveCount(0);
      // … the item is in its final completed-area state immediately.
      await expect(
        page.locator(
          `[data-testid="onb-checklist-completed"] [data-item-id="sessions.review_first"]`,
        ),
      ).toBeVisible();
    });
  });
});
