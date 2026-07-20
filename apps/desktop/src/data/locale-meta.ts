// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Locale display metadata (spec 061 research D6).
//
// Flags denote countries, not languages — Portuguese is spoken in Portugal,
// Brazil, Angola and Mozambique, and English has no non-arbitrary flag at
// all. The flag is decoration; the native name is the identifier, and it is
// mandatory: the person who needs the language chooser most is someone who
// cannot read the interface they landed on, and "Português (Brasil)" works
// for that reader while "Portuguese (Brazil)" rendered in English does not.
//
// A screen reader announcing "flag of Brazil" is noise, so the accessible
// name for a locale option MUST come from `nativeName`, never from `flag`.

import type { Locale } from '@/paraglide/runtime';

export interface LocaleMeta {
  id: Locale;
  /** The language's own name for itself, in its own script — the accessible name. */
  nativeName: string;
  /** Decorative only — never the accessible name (research D6). */
  flag: string;
}

/**
 * Keyed by `Locale` (the union of `project.inlang/settings.json`'s `locales`
 * array), so adding a shipped locale without a matching entry here is a
 * compile error rather than a silent gap.
 */
export const LOCALE_META: Record<Locale, LocaleMeta> = {
  'en-GB': { id: 'en-GB', nativeName: 'English (UK)', flag: '🇬🇧' },
  'pt-BR': { id: 'pt-BR', nativeName: 'Português (Brasil)', flag: '🇧🇷' },
};

/** `"🇬🇧 English (UK)"` — flag + native name together (FR-007). */
export function localeDisplayLabel(id: Locale): string {
  const meta = LOCALE_META[id];
  return `${meta.flag} ${meta.nativeName}`;
}
