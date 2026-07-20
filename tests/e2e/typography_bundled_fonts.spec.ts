// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Spec 055 Phase 1 (T003) — bundled hinted fonts replace the Google Fonts CDN.
 *
 * Pins the three Phase-1 guarantees (SC-001/SC-002):
 *   1. Zero network requests to fonts.googleapis.com / fonts.gstatic.com
 *      during app load — the UI must render identically offline.
 *   2. `document.fonts` contains the six bundled Inter faces (400/500/600,
 *      normal/italic) once the app has loaded.
 *   3. Computed `font-family` on rendered body text resolves to 'Inter'.
 *
 * See apps/desktop/src/styles/tokens.css (@font-face blocks) and
 * apps/desktop/src/assets/fonts/FONTS.md (asset provenance).
 */
import { test, expect, seedSetupComplete } from './support/harness';

test.describe('Spec 055 · bundled hinted fonts (Phase 1)', () => {
  test('no network requests reach fonts.googleapis.com or fonts.gstatic.com during app load', async ({
    page,
  }) => {
    const fontCdnRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('fonts.googleapis.com') ||
        url.includes('fonts.gstatic.com')
      ) {
        fontCdnRequests.push(url);
      }
    });

    seedSetupComplete(page);
    await page.goto('/#/sessions');
    await page.waitForLoadState('networkidle');

    expect(fontCdnRequests).toEqual([]);
  });

  test('document.fonts contains the six bundled Inter faces after load', async ({
    page,
  }) => {
    seedSetupComplete(page);
    await page.goto('/#/sessions');
    await page.waitForLoadState('networkidle');

    const faces = await page.evaluate(async () => {
      await document.fonts.ready;
      return Array.from(document.fonts)
        .filter((face) => face.family === 'Inter')
        .map((face) => ({ weight: face.weight, style: face.style }));
    });

    const expected = [
      { weight: '400', style: 'normal' },
      { weight: '400', style: 'italic' },
      { weight: '500', style: 'normal' },
      { weight: '500', style: 'italic' },
      { weight: '600', style: 'normal' },
      { weight: '600', style: 'italic' },
    ];

    for (const face of expected) {
      expect(
        faces.some((f) => f.weight === face.weight && f.style === face.style),
        `expected an Inter ${face.weight}/${face.style} face in document.fonts, got ${JSON.stringify(faces)}`,
      ).toBe(true);
    }
  });

  test('computed body font-family resolves to Inter', async ({ page }) => {
    seedSetupComplete(page);
    await page.goto('/#/sessions');
    await page.waitForLoadState('networkidle');

    const fontFamily = await page.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    );
    expect(fontFamily).toContain('Inter');
  });
});
