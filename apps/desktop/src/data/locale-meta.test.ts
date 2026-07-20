// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * locale-meta.test.ts — spec 061 T010/research D6.
 */

import { describe, expect, it } from 'vitest';
import { LOCALE_META, localeDisplayLabel } from './locale-meta';
import { SHIPPED_LOCALES } from './locale';

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
