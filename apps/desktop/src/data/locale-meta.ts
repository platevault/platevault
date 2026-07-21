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

/**
 * How much human scrutiny a catalogue has had (FR-013).
 *
 * `source` is the catalogue everything else is translated from, so "reviewed"
 * would be a category error — there is nothing to review it against.
 */
export type LocaleReviewStatus = 'source' | 'reviewed' | 'machine-generated';

export interface LocaleMeta {
  id: Locale;
  /** The language's own name for itself, in its own script — the accessible name. */
  nativeName: string;
  /** Decorative only — never the accessible name (research D6). */
  flag: string;
  /**
   * FR-013: an unreviewed translation must be identifiable as such, so review
   * status is a known quantity rather than an assumption.
   *
   * This lives here, not in `messages/{locale}.json`, because the inlang
   * message-format file has no inert metadata slot — every non-`$schema`
   * top-level key compiles into a real Paraglide message function, so a
   * marker stored there would become a fake message. Keeping it beside the
   * other per-locale facts also makes it typed, testable, and available to
   * the chooser, which is what makes the status identifiable to a *user*
   * rather than only to someone reading a config file.
   */
  reviewStatus: LocaleReviewStatus;
}

/**
 * Keyed by `Locale` (the union of `project.inlang/settings.json`'s `locales`
 * array), so adding a shipped locale without a matching entry here is a
 * compile error rather than a silent gap.
 */
export const LOCALE_META: Record<Locale, LocaleMeta> = {
  'en-GB': {
    id: 'en-GB',
    nativeName: 'English (UK)',
    flag: '🇬🇧',
    reviewStatus: 'source',
  },
  'pt-BR': {
    id: 'pt-BR',
    nativeName: 'Português (Brasil)',
    flag: '🇧🇷',
    reviewStatus: 'machine-generated',
  },
};

/** `"🇬🇧 English (UK)"` — flag + native name together (FR-007). */
export function localeDisplayLabel(id: Locale): string {
  const meta = LOCALE_META[id];
  return `${meta.flag} ${meta.nativeName}`;
}

/**
 * Whether a locale should carry a "not yet reviewed by a fluent speaker"
 * notice in the UI (FR-013). Only `machine-generated` qualifies — `source`
 * and `reviewed` are both trustworthy, for different reasons.
 */
export function needsReviewNotice(id: Locale): boolean {
  return LOCALE_META[id].reviewStatus === 'machine-generated';
}
