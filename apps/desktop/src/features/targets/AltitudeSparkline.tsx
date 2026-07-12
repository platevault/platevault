/**
 * AltitudeSparkline — tiny inline altitude sparkline for a Planner row (task
 * #85, spec 043; polished task #19; real ephemeris since spec 044 Track B).
 *
 * Plots the real per-row altitude curve from `planner-altitude.ts` (per-site
 * ephemeris, astronomy-engine) across the night. A faint guide line marks the
 * usable-altitude threshold; the stroke turns "usable" colour when the target
 * peaks above it tonight. Shares its x/y scale with `TargetDetailV2`'s
 * detail-pane graph via `altitude-scale.ts` (spec 044 Track B, T035).
 *
 * task #19 additions:
 *   - Reduced height (viewBox uses VB_H = 20; CSS sets 22 px via wave2 block).
 *   - Bottom time-axis ticks at 18:00, 00:00, and 06:00 local.
 *   - A per-sample <title> tooltip so hovering anywhere on the curve shows
 *     the approximate time + altitude degree for that sample.  The tooltip
 *     uses a single full-SVG <title> with a compact multi-line summary rather
 *     than per-point hit targets, because the SVG is 72 px wide and individual
 *     sample regions would be sub-pixel.  Browser-native <title> shows on hover
 *     without JS; pointer-events are enabled via the wave2 CSS block.
 *
 * Geometry (the polyline points, guide-line Y, and tick positions) is
 * data-driven — the allowed dynamic inline-attribute case.  All visual styling
 * is token-only CSS on the wrapping classes.
 */

import { type RowAltitude, USABLE_ALT_DEG } from './planner-altitude';
import { altitudeScale, hourScale, HOUR_DOMAIN } from './altitude-scale';

// ── Coordinate space ───────────────────────────────────────────────────────────
//
// task #19: VB_H increased from 18 → 20 (curve area) + TICK_H (axis ticks).
// The CSS sets the rendered size to 72 × 22 px (via .cssblocks/targets-wave2.css).

const VB_W = 72;
const CURVE_H = 14; // height of the altitude-curve area (px in viewBox units)
const TICK_H = 6; // height reserved below curve for time-axis tick + label
const VB_H = CURVE_H + TICK_H;
const PAD_Y = 1;

// spec 044 Track B, T035: the SAME altitude/hour scale `TargetDetailV2`'s
// detail-pane graph uses (altitude-scale.ts), not a second hand-rolled
// linear interpolation.
const altScale = altitudeScale(CURVE_H - PAD_Y, PAD_Y);
const hrScale = hourScale(0, VB_W);

function altToY(alt: number): number {
  return altScale(alt);
}

function tHourToX(tHour: number): number {
  return hrScale(tHour);
}

// ── Time-axis tick config ──────────────────────────────────────────────────────
//
// Three ticks: 18:00 (start of night), 00:00 (midnight), 06:00 (end).
// tHour values: 0 → 18:00, 6 → 00:00, 12 → 06:00.

const TIME_TICKS: Array<{ tHour: number; label: string }> = [
  { tHour: 0, label: '18' },
  { tHour: 6, label: '00' },
  { tHour: 12, label: '06' },
];

// ── Hover tooltip helper ───────────────────────────────────────────────────────
//
// Build a compact multi-line tooltip string summarising the night curve.
// Format: "18:00 −3° | 21:00 42° | 00:00 68° | 03:00 52° | 06:00 8°"
// We sample every 3 h (i.e. every 9th point at the 36-sample resolution).

function buildTooltip(alt: RowAltitude): string {
  const step = Math.floor(alt.points.length / 4); // ~3h interval
  const samples = alt.points.filter((_, i) => i % (step || 1) === 0);
  const parts = samples.map((p) => {
    const clock = (18 + Math.round(p.tHour)) % 24;
    const hh = String(clock).padStart(2, '0');
    return `${hh}:00 ${Math.round(p.altDeg)}°`;
  });
  return parts.join(' · ');
}

// ── Component ──────────────────────────────────────────────────────────────────

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
      const x = n > 1 ? tHourToX(p.tHour) : 0;
      // Use i-based x when tHour spacing is uniform; tHour-based when not.
      void i; // tHour is authoritative
      return `${x.toFixed(1)},${altToY(p.altDeg).toFixed(1)}`;
    })
    .join(' ');

  const guideY = altToY(USABLE_ALT_DEG).toFixed(1);

  // Axis baseline Y: top of tick area (just below the curve).
  const axisY = CURVE_H;

  const tooltip = buildTooltip(alt);

  return (
    <svg
      className={
        'alm-targets-spark' +
        (visibleTonight
          ? ' alm-targets-spark--usable'
          : ' alm-targets-spark--low')
      }
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {/* Hover tooltip: native <title> shown by browser on hover.
          Pointer-events are enabled on the SVG via .cssblocks/targets-wave2.css. */}
      <title>
        {label} — {tooltip}
      </title>

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

      {/* task #19: time-axis baseline (separates curve from tick labels). */}
      <line
        className="alm-targets-spark__axis-tick"
        x1={0}
        y1={axisY}
        x2={VB_W}
        y2={axisY}
      />

      {/* task #19: time-axis ticks + hour labels at 18:00, 00:00, 06:00. */}
      {TIME_TICKS.map(({ tHour, label: tickLabel }) => {
        const x = tHourToX(tHour).toFixed(1);
        return (
          <g key={tHour}>
            {/* Tick mark dropping below the axis baseline. */}
            <line
              className="alm-targets-spark__axis-tick"
              x1={x}
              y1={axisY}
              x2={x}
              y2={axisY + 2}
            />
            {/* Hour label: left-anchor for first tick, middle for centre,
                right-anchor for last tick so labels stay within the viewBox. */}
            <text
              className="alm-targets-spark__axis-label"
              x={x}
              y={VB_H}
              textAnchor={
                tHour === 0
                  ? 'start'
                  : tHour === HOUR_DOMAIN[1]
                    ? 'end'
                    : 'middle'
              }
            >
              {tickLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
