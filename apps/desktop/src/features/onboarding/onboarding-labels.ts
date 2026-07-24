// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared page-path map and dynamic i18n label/tooltip helpers for the onboarding
 * feature. Extracted here to break the FindSpotlight <-> ChecklistSection import
 * cycle: both modules import from this leaf module, which imports neither of them.
 */

import { m } from '@/lib/i18n';
import type { OnboardingPage } from '@/bindings/index';

const PAGE_META: Record<OnboardingPage, { path: string; label: () => string }> =
  {
    inbox: {
      path: '/inbox',
      label: () => m.settings_datasources_category_inbox(),
    },
    sessions: { path: '/sessions', label: () => m.common_sessions() },
    calibration: {
      path: '/calibration',
      label: () => m.settings_datasources_category_calibration(),
    },
    targets: { path: '/targets', label: () => m.nav_targets() },
    projects: { path: '/projects', label: () => m.common_projects() },
  };

export const PAGE_ORDER: OnboardingPage[] = [
  'inbox',
  'sessions',
  'calibration',
  'targets',
  'projects',
];

/** Route path per page — consumed by FindSpotlight to navigate first. */
export const ONBOARDING_PAGE_PATHS = Object.fromEntries(
  PAGE_ORDER.map((p) => [p, PAGE_META[p].path]),
) as Record<OnboardingPage, string>;

export function pageLabel(page: OnboardingPage): string {
  return PAGE_META[page].label();
}

export function pagePath(page: OnboardingPage): string {
  return PAGE_META[page].path;
}

/** Dynamic catalog access for registry-keyed item/prerequisite strings. The
 * keys are all present in `messages/en-GB.json` (seeded T011); the itemId → key
 * mapping is `onboarding_item_<id-with-underscores>_<label|tooltip>`. */
const catalog = m as unknown as Record<
  string,
  (args?: Record<string, unknown>) => string
>;

export const itemLabel = (id: string): string =>
  catalog[`onboarding_item_${id.replaceAll('.', '_')}_label`]();

export const itemTooltip = (id: string): string =>
  catalog[`onboarding_item_${id.replaceAll('.', '_')}_tooltip`]();

// The backend sends dotted registry reason keys (e.g.
// `onboarding.prerequisite.inbox.confirm_first`); Paraglide message functions
// are underscore-keyed, so convert before lookup exactly as the item strings do
// — a raw dotted key resolves to `undefined()` and crashes the whole shell into
// the error boundary (only the real backend populates prerequisites, so mocks
// with `prerequisite: null` never reach this path).
export const prerequisiteReason = (reasonKey: string): string =>
  catalog[reasonKey.replaceAll('.', '_')]();
