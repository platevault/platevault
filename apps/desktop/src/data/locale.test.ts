// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * locale.test.ts — spec 061 T012.
 *
 * Covers the parts of the locale runtime that don't need the settings-DB
 * mock (see locale.persistence.test.ts for DB-wins reconciliation):
 * strategy precedence order, and the compile-time fallback to the base
 * locale for a key missing from pt-BR.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function setNavigatorLanguages(languages: string[]): void {
  Object.defineProperty(navigator, 'languages', {
    value: languages,
    configurable: true,
  });
}

describe('strategy precedence — custom-almSettings > preferredLanguage > baseLocale', () => {
  const originalLanguages = navigator.languages;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    setNavigatorLanguages([...originalLanguages]);
  });

  it('a saved choice in the mirror wins over the OS/webview language', async () => {
    setNavigatorLanguages(['pt-BR']);
    localStorage.setItem('alm.locale', 'en-GB');

    const { registerLocaleStrategy, getCurrentLocale } = await import(
      './locale'
    );
    registerLocaleStrategy();

    expect(getCurrentLocale()).toBe('en-GB');
  });

  it('falls back to the OS/webview language when nothing is saved', async () => {
    setNavigatorLanguages(['pt-BR']);

    const { registerLocaleStrategy, getCurrentLocale } = await import(
      './locale'
    );
    registerLocaleStrategy();

    expect(getCurrentLocale()).toBe('pt-BR');
  });

  it('falls back to the base locale when neither a saved choice nor a shipped OS language is available', async () => {
    setNavigatorLanguages(['fr-FR']);

    const { registerLocaleStrategy, getCurrentLocale, BASE_LOCALE } =
      await import('./locale');
    registerLocaleStrategy();

    expect(getCurrentLocale()).toBe(BASE_LOCALE);
    expect(BASE_LOCALE).toBe('en-GB');
  });

  it('ignores a malformed mirror value and falls through the chain', async () => {
    setNavigatorLanguages(['pt-BR']);
    localStorage.setItem('alm.locale', 'not-a-real-locale');

    const { registerLocaleStrategy, getCurrentLocale } = await import(
      './locale'
    );
    registerLocaleStrategy();

    expect(getCurrentLocale()).toBe('pt-BR');
  });
});

describe('missing-translation fallback (research D5)', () => {
  it('a key absent from pt-BR resolves to the base-locale (en-GB) string, never a raw key', async () => {
    const { m } = await import('@/lib/i18n');

    // common_close is not in the pt-BR stub catalog (spec 061 p1 ships only
    // a handful of proof-of-mechanism keys; the full translation is a
    // separate node). Paraglide compiles the fallback at build time.
    const value = m.common_close({}, { locale: 'pt-BR' });

    expect(value).toBe('Close');
    expect(value).not.toBe('common_close');
    expect(value).not.toBe('');
  });

  it('a key present in pt-BR resolves to the translated string', async () => {
    const { m } = await import('@/lib/i18n');

    expect(m.common_save({}, { locale: 'pt-BR' })).toBe('Salvar');
    expect(m.common_save({}, { locale: 'en-GB' })).toBe('Save');
  });
});
