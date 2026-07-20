// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/** Pure category vocabulary shared by the Data Sources pane and its cards. */
import type { RootCategory } from '@/bindings/index';
import { m } from '@/lib/i18n';

// Issue #623: followSymlinks/hashOnScan removed — retired from the
// overridable/scan-behavior duplicate (see DataSources.tsx's module doc
// comment); resetting them here reset invisible keys with no control on
// this pane.
export const SOURCES_KEYS = ['alwaysPreviewBeforePlan'];

/** Display order and labels for category groups (matches mock: Raw / Calibration / Project / Inbox). */
export const CATEGORY_ORDER: RootCategory[] = [
  'raw',
  'calibration',
  'project',
  'inbox',
];

/** Render-time factory (spec 046 #8b) so category labels re-read the active locale. */
export function categoryLabel(category: RootCategory): string {
  switch (category) {
    case 'raw':
      return m.settings_datasources_category_raw();
    case 'calibration':
      return m.settings_datasources_category_calibration();
    case 'project':
      return m.settings_datasources_category_project();
    case 'inbox':
      return m.settings_datasources_category_inbox();
  }
}

// Categories `file_record` rows are populated for (spec 048) — the only
// roots a reconcile pass has anything to diff against.
export const RECONCILABLE_CATEGORIES: RootCategory[] = ['raw', 'calibration'];
