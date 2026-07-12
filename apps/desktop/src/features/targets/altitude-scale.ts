/**
 * altitude-scale.ts — shared altitude/night-hour scale helpers (spec 044
 * Track B, T035). ONE domain definition + `@visx/scale` factory used by both
 * `AltitudeSparkline.tsx` (per-row inline sparkline) and `TargetDetailV2.tsx`'s
 * detail-pane altitude graph, so the two charts never drift out of sync and
 * neither hand-rolls its own linear-interpolation math.
 */

import { scaleLinear } from '@visx/scale';

/** Altitude domain both charts plot (degrees): a touch below the horizon to zenith-ish. */
export const ALT_DOMAIN: [number, number] = [-10, 90];

/** Night-hour domain both charts plot: 0 = night start … 12 = night end. */
export const HOUR_DOMAIN: [number, number] = [0, 12];

/**
 * Altitude → pixel-Y scale. `rangeBottomPx`/`rangeTopPx` are the pixel
 * coordinates for the domain's min/max (SVG y grows downward, so the low
 * altitude maps to the larger pixel value).
 */
export function altitudeScale(rangeBottomPx: number, rangeTopPx: number) {
  // clamp: true — mirrors the prior hand-rolled Math.max/min clamping so an
  // out-of-domain altitude (rare, near ±90°) still plots at the chart edge
  // instead of extrapolating off-canvas.
  return scaleLinear<number>({
    domain: ALT_DOMAIN,
    range: [rangeBottomPx, rangeTopPx],
    clamp: true,
  });
}

/** Night-hour → pixel-X scale. */
export function hourScale(rangeLeftPx: number, rangeRightPx: number) {
  return scaleLinear<number>({
    domain: HOUR_DOMAIN,
    range: [rangeLeftPx, rangeRightPx],
    clamp: true,
  });
}
