// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Label for a detected calibration master (spec 040 FR-006, issue #754).
 *
 * FR-006/US2 requires masters be identified by type + filter + exposure —
 * "Master Dark · 300 s", "Master Flat · Ha". The first-run wizard's scan step
 * built this label; the persistent Inbox list rendered the frame type alone,
 * so the same master read differently on the two surfaces that show it.
 * Both now call this.
 */

import { m } from '@/lib/i18n';
import { formatExposureSeconds } from '@/lib/format';

/**
 * The master fields shared by `InboxItemSummary` and `InboxListItem`.
 * Structural rather than a binding import: the two DTOs differ in optionality
 * (`_Serialize` vs `_Deserialize`) but agree on these three.
 */
export interface MasterLabelFields {
  masterFrameType?: string | null;
  masterFilter?: string | null;
  masterExposureS?: number | null;
}

/** Capitalize the first letter (e.g. "dark" → "Dark"). */
function titleCase(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Compose a master's display label, omitting qualifiers the extractor could
 * not determine. Degrades to a bare "Master" when even the frame type is
 * unknown — never fabricates a type.
 *
 * Exposure goes through `formatExposureSeconds` so masters round and space
 * their unit like every other exposure in the app (#811); FR-006's "300s"
 * examples predate that convention.
 */
export function masterLabel(item: MasterLabelFields): string {
  const parts: string[] = [
    item.masterFrameType
      ? m.setup_scan_master_kind({ kind: titleCase(item.masterFrameType) })
      : m.setup_scan_master(),
  ];
  if (item.masterFilter) parts.push(item.masterFilter);
  if (item.masterExposureS != null) {
    parts.push(formatExposureSeconds(item.masterExposureS));
  }
  return parts.join(' · ');
}
