// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Observing Site: "Pick on map" section shared by the first-run wizard
// (StepSite) and the Settings site form (ObservingSites).
//
// Privacy (SignPath condition c, astro-plan-pil2e): the map tiles come from
// tile.openstreetmap.org, and once coordinates are entered the requested tiles
// show roughly where the site is. The section therefore shows a notice and a
// "Show map" button in place of the map, and mounts SiteLocationPicker only
// after the user clicks it. The choice is per view: every new mount of the
// step or form starts without the map. The lat/lon fields work either way.

import { lazy, Suspense, useState } from 'react';
import { m } from '@/lib/i18n';
import { Btn } from '@/ui';
import type { SiteLocationPickerProps } from './SiteLocationPicker';

// Leaflet is ~240 KB raw. Lazy-load so it splits to its own chunk, which is
// fetched only after the user asks for the map.
const SiteLocationPicker = lazy(() =>
  import('./SiteLocationPicker').then((mod) => ({
    default: mod.SiteLocationPicker,
  })),
);

/**
 * Renders the map section of a site form: a notice and "Show map" button
 * until the user asks for the map, then the click-to-pick map.
 *
 * @param latitudeDeg - Parsed latitude field, or `null` when blank/invalid
 * @param longitudeDeg - Parsed longitude field, or `null` when blank/invalid
 * @param onPick - Called with the clicked coordinates; the caller updates its fields
 */
export function SiteMapSection({
  latitudeDeg,
  longitudeDeg,
  onPick,
}: SiteLocationPickerProps) {
  const [mapShown, setMapShown] = useState(false);

  return (
    <div className="pv-step-site__map-section" data-testid="site-map-section">
      <span className="pv-field-label">{m.setup_site_map_label()}</span>
      {mapShown ? (
        <Suspense
          fallback={
            <div
              className="pv-step-site__map"
              role="status"
              aria-label={m.setup_site_map_label()}
            />
          }
        >
          <SiteLocationPicker
            latitudeDeg={latitudeDeg}
            longitudeDeg={longitudeDeg}
            onPick={onPick}
          />
        </Suspense>
      ) : (
        <div className="pv-step-site__map-placeholder">
          <p className="pv-step-site__map-notice">
            {m.setup_site_map_notice()}
          </p>
          <Btn size="sm" type="button" onClick={() => setMapShown(true)}>
            {m.setup_site_map_show()}
          </Btn>
        </div>
      )}
    </div>
  );
}
