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

type KnownFrameType = 'light' | 'dark' | 'flat' | 'bias';
type LabelOptions = { locale?: 'en-GB' | 'pt-BR' };

const FRAME_TYPE_LABELS: Record<
  KnownFrameType,
  (options?: LabelOptions) => string
> = {
  light: (options) => m.setup_scan_frame_type_light({}, options),
  dark: (options) => m.setup_scan_frame_type_dark({}, options),
  flat: (options) => m.setup_scan_frame_type_flat({}, options),
  bias: (options) => m.setup_scan_frame_type_bias({}, options),
};

const FRAME_TYPE_COUNT_LABELS: Record<
  KnownFrameType,
  (count: number, options?: LabelOptions) => string
> = {
  light: (count, options) => m.setup_scan_frame_count_light({ count }, options),
  dark: (count, options) => m.setup_scan_frame_count_dark({ count }, options),
  flat: (count, options) => m.setup_scan_frame_count_flat({ count }, options),
  bias: (count, options) => m.setup_scan_frame_count_bias({ count }, options),
};

function knownFrameType(value: string): KnownFrameType | null {
  const normalized = value.trim().toLowerCase();
  return Object.hasOwn(FRAME_TYPE_LABELS, normalized)
    ? (normalized as KnownFrameType)
    : null;
}

export function frameTypeLabel(value: string, options?: LabelOptions): string {
  const known = knownFrameType(value);
  return known
    ? FRAME_TYPE_LABELS[known](options)
    : m.setup_scan_frame_type_unknown(
        {
          value: value.trim() || m.common_unknown({}, options),
        },
        options,
      );
}

export function frameTypeCountLabel(
  value: string,
  count: number,
  options?: LabelOptions,
): string {
  const known = knownFrameType(value);
  return known
    ? FRAME_TYPE_COUNT_LABELS[known](count, options)
    : m.setup_scan_frame_count_unknown(
        {
          count,
          value: value.trim() || m.common_unknown({}, options),
        },
        options,
      );
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
export function masterLabel(
  item: MasterLabelFields,
  options?: LabelOptions,
): string {
  const parts: string[] = [
    item.masterFrameType
      ? m.setup_scan_master_kind(
          {
            kind: frameTypeLabel(item.masterFrameType, options),
          },
          options,
        )
      : m.setup_scan_master({}, options),
  ];
  if (item.masterFilter) parts.push(item.masterFilter);
  if (item.masterExposureS != null) {
    parts.push(formatExposureSeconds(item.masterExposureS));
  }
  return parts.join(' · ');
}
