// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DetailDockPlacementControl — spec 054 T021 (US4).
 *
 * The ONE Auto/Bottom/Right control (owner mandate: "we can toggle it to
 * auto/bottom/right easily in the config") — rendered identically in Settings
 * (`features/settings/General.tsx`) and in the in-page detail-panel header
 * (`ListPageLayout`), so there is exactly one place that maps the 3-way
 * choice onto `setDetailDockMode` (shared-component guard, spec 054 constraint).
 * "Right" (not "Side") matches the owner's wording; "Auto" is the adaptive mode.
 */

import { SegControl } from '@/ui';
import { m } from '@/lib/i18n';
import {
  useDetailDockPref,
  setDetailDockMode,
  type DetailDockPageKey,
  type DetailDockMode,
} from '@/data/preferences';

export interface DetailDockPlacementControlProps {
  page: DetailDockPageKey;
  className?: string;
}

export function DetailDockPlacementControl({
  page,
  className,
}: DetailDockPlacementControlProps) {
  const { mode } = useDetailDockPref(page);
  return (
    <SegControl
      className={className}
      aria-label={m.detail_dock_placement_aria()}
      options={[
        { value: 'adaptive', label: m.detail_dock_placement_auto() },
        { value: 'bottom', label: m.detail_dock_placement_bottom() },
        { value: 'side', label: m.detail_dock_placement_right() },
      ]}
      value={mode}
      onChange={(value) => setDetailDockMode(page, value as DetailDockMode)}
    />
  );
}
