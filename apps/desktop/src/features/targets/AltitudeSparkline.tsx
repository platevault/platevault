/**
 * AltitudeSparkline — tiny inline opposition/altitude sparkline for a Planner
 * row (task #85).
 *
 * STUB (real values arrive with ephemeris + observer location, #58): plots the
 * approximate per-row altitude curve from planner-altitude.ts across the night.
 * A faint guide line marks the usable-altitude threshold; the stroke turns
 * "usable" colour when the target peaks above it tonight. Geometry (the polyline
 * points + the guide-line Y) is data-driven, which is the allowed dynamic
 * inline-style/attribute case — everything visual is otherwise token-only CSS on
 * the wrapping classes.
 */

import { type RowAltitude, USABLE_ALT_DEG } from './planner-altitude';

// Sparkline coordinate space (unitless viewBox; real size comes from CSS).
const VB_W = 64;
const VB_H = 18;
const PAD_Y = 1;
const ALT_MIN = -10;
const ALT_MAX = 90;

function altToY(alt: number): number {
  const clamped = Math.max(ALT_MIN, Math.min(ALT_MAX, alt));
  const frac = (clamped - ALT_MIN) / (ALT_MAX - ALT_MIN);
  return PAD_Y + (VB_H - 2 * PAD_Y) * (1 - frac);
}

interface Props {
  alt: RowAltitude;
  /** Accessible label for screen readers. */
  label: string;
}

export function AltitudeSparkline({ alt, label }: Props) {
  const { points, visibleTonight } = alt;
  const n = points.length;

  const polyline = points
    .map((p, i) => {
      const x = n > 1 ? (i / (n - 1)) * VB_W : 0;
      return `${x.toFixed(1)},${altToY(p.altDeg).toFixed(1)}`;
    })
    .join(' ');

  const guideY = altToY(USABLE_ALT_DEG).toFixed(1);

  return (
    <svg
      className={
        'alm-targets-spark' +
        (visibleTonight ? ' alm-targets-spark--usable' : ' alm-targets-spark--low')
      }
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {/* Usable-altitude guide line (≥30°). Geometry only; colour via CSS. */}
      <line
        className="alm-targets-spark__guide"
        x1={0}
        y1={guideY}
        x2={VB_W}
        y2={guideY}
      />
      {/* Altitude curve across the night. */}
      <polyline className="alm-targets-spark__curve" points={polyline} />
    </svg>
  );
}
