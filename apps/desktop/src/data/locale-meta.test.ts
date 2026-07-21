// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * locale-meta.test.ts — spec 061 T010/research D6.
 */

import { describe, expect, it } from 'vitest';
import {
  LOCALE_META,
  localeDisplayLabel,
  needsReviewNotice,
} from './locale-meta';
import { BASE_LOCALE, SHIPPED_LOCALES } from './locale';

describe('LOCALE_META', () => {
  it('has an entry for every shipped locale, with a non-empty native name distinct from the flag', () => {
    for (const id of SHIPPED_LOCALES) {
      const meta = LOCALE_META[id];
      expect(meta).toBeDefined();
      expect(meta.nativeName.length).toBeGreaterThan(0);
      expect(meta.nativeName).not.toBe(meta.flag);
    }
  });

  it('en-GB and pt-BR match the spec-mandated labels', () => {
    expect(LOCALE_META['en-GB']).toMatchObject({
      nativeName: 'English (UK)',
      flag: '🇬🇧',
    });
    expect(LOCALE_META['pt-BR']).toMatchObject({
      nativeName: 'Português (Brasil)',
      flag: '🇧🇷',
    });
  });

  it('localeDisplayLabel combines the flag and native name (FR-007)', () => {
    expect(localeDisplayLabel('pt-BR')).toBe('🇧🇷 Português (Brasil)');
  });
});

describe('review status (FR-013)', () => {
  it('declares a review status for every shipped locale', () => {
    for (const id of SHIPPED_LOCALES) {
      expect(LOCALE_META[id].reviewStatus).toBeDefined();
    }
  });

  it('marks the base locale as the source catalogue, never as reviewed', () => {
    // The base locale is what everything else is translated FROM, so
    // "reviewed" would be a category error — there is nothing to check it
    // against. This guards against a future contributor flipping it.
    expect(LOCALE_META[BASE_LOCALE].reviewStatus).toBe('source');
  });

  it('marks pt-BR as machine-generated so it carries a review notice', () => {
    expect(LOCALE_META['pt-BR'].reviewStatus).toBe('machine-generated');
    expect(needsReviewNotice('pt-BR')).toBe(true);
  });

  it('does not flag the source catalogue as needing review', () => {
    expect(needsReviewNotice(BASE_LOCALE)).toBe(false);
  });
});
