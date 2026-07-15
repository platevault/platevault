// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AltitudeSparkline — inline altitude sparkline for a Planner row (task #85,
 * spec 043; polished task #19; real ephemeris since spec 044 Track B; enlarged
 * + marked-up for #580).
 *
 * Plots the real per-row altitude curve from `planner-altitude.ts` (per-site
 * ephemeris, astronomy-engine) across the night. Shares its x/y scale with
 * `TargetDetailV2`'s detail-pane graph via `altitude-scale.ts` (spec 044 Track
 * B, T035) so the two never drift.
 *
 * #580 (legibility): the sparkline was too small/cramped to read. It is now
 * wider + taller, draws a distinct coloured line over a soft area fill, shades
 * the twilight either side of the astronomical dark window (the same twilight
 * marks the detail-pane graph uses, from `RowAltitude.darkWindowHours`), and
 * marks the transit / max-altitude point with a dot. A faint guide line marks
 * the usable-altitude threshold; the stroke turns "usable" colour when the
 * target peaks above it tonight.
 *
 * task #19 (kept): bottom time-axis ticks at 18:00, 00:00, 06:00 local, and a
 * per-sample <title> tooltip so hovering shows approximate time + altitude.
 *
 * Geometry (polyline points, guide-line Y, tick + shading positions) is
 * data-driven — the allowed dynamic inline-attribute case. All visual styling
 * is token-only CSS on the wrapping classes.
 */

import { type RowAltitude, USABLE_ALT_DEG } from './planner-altitude';
import { altitudeScale, hourScale, HOUR_DOMAIN } from './altitude-scale';

// ── Coordinate space ───────────────────────────────────────────────────────────
//
// #580: enlarged from 72×22 → 96×28 viewBox (curve area + axis ticks). The CSS
// sets the rendered size to match (via .styles/components/merges-3.css).

const VB_W = 96;
const CURVE_H = 22; // height of the altitude-curve area (viewBox units)
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
// Format: "18:00 −3° · 21:00 42° · 00:00 68° · 03:00 52° · 06:00 8°"
// We sample every ~3 h (i.e. every 9th point at the 36-sample resolution).

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
  const { points, visibleTonight, darkWindowHours } = alt;
  const n = points.length;

  const xy = points.map((p) => ({
    x: n > 1 ? tHourToX(p.tHour) : 0,
    y: altToY(p.altDeg),
  }));
  const polyline = xy
    .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');

  // Axis baseline Y: top of tick area (just below the curve).
  const axisY = CURVE_H;

  // #580 area fill: close the curve down to the axis baseline so the body of
  // the night's altitude reads at a glance, not just a thin line.
  const area =
    xy.length > 1
      ? `${xy[0].x.toFixed(1)},${axisY} ${polyline} ${xy[xy.length - 1].x.toFixed(1)},${axisY}`
      : '';

  const guideY = altToY(USABLE_ALT_DEG).toFixed(1);

  // #580 transit/max-altitude marker: the highest sampled point.
  const peak =
    xy.length > 0
      ? points.reduce(
          (best, p, i) => (p.altDeg > best.alt ? { alt: p.altDeg, i } : best),
          { alt: -Infinity, i: 0 },
        )
      : null;

  // #580 twilight shading: the not-dark hours either side of the astronomical
  // dark window (same source + semantics as the detail-pane graph). Clamped to
  // the viewBox; omitted entirely when there is no dark window tonight.
  const twilightStartW = darkWindowHours
    ? Math.max(0, tHourToX(darkWindowHours.startHour))
    : 0;
  const twilightEndX = darkWindowHours
    ? tHourToX(darkWindowHours.endHour)
    : VB_W;

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
          Pointer-events are enabled on the SVG via the merges-3 CSS block. */}
      <title>
        {label} — {tooltip}
      </title>

      {/* #580 twilight shading either side of the dark window. */}
      {darkWindowHours && twilightStartW > 0 && (
        <rect
          className="alm-targets-spark__twilight"
          x={0}
          y={0}
          width={twilightStartW}
          height={axisY}
        />
      )}
      {darkWindowHours && twilightEndX < VB_W && (
        <rect
          className="alm-targets-spark__twilight"
          x={twilightEndX}
          y={0}
          width={VB_W - twilightEndX}
          height={axisY}
        />
      )}

      {/* #580 soft area fill under the curve. */}
      {area && <polygon className="alm-targets-spark__area" points={area} />}

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

      {/* #580 transit / max-altitude marker. */}
      {peak && Number.isFinite(peak.alt) && (
        <circle
          className="alm-targets-spark__peak"
          cx={xy[peak.i].x.toFixed(1)}
          cy={xy[peak.i].y.toFixed(1)}
          r={1.8}
        />
      )}

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
