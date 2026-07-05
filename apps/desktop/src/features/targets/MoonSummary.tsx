/**
 * MoonSummary — tonight's Moon at a glance for the planner bar (spec 047 US1).
 *
 * Shows the real nightly Moon state (phase name, illumination %, waxing/waning
 * direction) with a small terminator-ellipse phase glyph. All values come from
 * `moon-state.ts` (astronomy-engine); this component is pure presentation.
 *
 * Accessibility: the SVG is decorative (`aria-hidden`); the widget carries a
 * full text equivalent via `aria-label`, and the visible text repeats the
 * phase, illumination, and direction so screen-reader and sighted users get
 * the same information.
 */

import { m } from '@/lib/i18n';
import type { ObservingNight, MoonPhaseName } from './astro/moon-state';

/** i18n label for each 8-phase name (render-time so it re-reads the locale). */
const PHASE_LABEL: Record<MoonPhaseName, () => string> = {
  new: () => m.targets_moon_phase_new(),
  'waxing-crescent': () => m.targets_moon_phase_waxing_crescent(),
  'first-quarter': () => m.targets_moon_phase_first_quarter(),
  'waxing-gibbous': () => m.targets_moon_phase_waxing_gibbous(),
  full: () => m.targets_moon_phase_full(),
  'waning-gibbous': () => m.targets_moon_phase_waning_gibbous(),
  'last-quarter': () => m.targets_moon_phase_last_quarter(),
  'waning-crescent': () => m.targets_moon_phase_waning_crescent(),
};

/** Human phase label for a phase name. */
export function phaseLabel(phase: MoonPhaseName): string {
  return PHASE_LABEL[phase]();
}

const R = 9; // glyph radius (px)

/**
 * Right-half (lit-when-waxing) semicircle path for the phase glyph.
 * Mirrored horizontally when waning so the lit limb faces the correct side.
 */
function litSemicirclePath(waxing: boolean): string {
  // Waxing: right limb lit. Waning: left limb lit (sweep flag flipped).
  const sweep = waxing ? 1 : 0;
  return `M 0 ${-R} A ${R} ${R} 0 0 ${sweep} 0 ${R} Z`;
}

interface Props {
  night: ObservingNight;
}

/**
 * Nightly Moon summary widget. Compositing model for the glyph:
 *   1. dark full disk,
 *   2. lit semicircle on the lit limb,
 *   3. a terminator ellipse (rx = R·|1−2f|) filled lit for a gibbous Moon
 *      (extends the lit region past the middle) or dark for a crescent (eats
 *      into the lit half). At f = 0.5 the ellipse collapses to a line.
 */
export function MoonSummary({ night }: Props) {
  const { phaseName, waxing, illuminationFrac } = night;
  const pct = Math.round(illuminationFrac * 100);
  const label = phaseLabel(phaseName);
  const direction = waxing ? m.targets_moon_waxing() : m.targets_moon_waning();
  const ariaLabel = m.targets_moon_summary_aria({ phase: label, pct, direction });

  const ellipseRx = R * Math.abs(1 - 2 * illuminationFrac);
  const ellipseLit = illuminationFrac > 0.5;

  return (
    <div
      className="alm-moon-summary"
      aria-label={ariaLabel}
      data-testid="moon-summary"
    >
      <svg
        className="alm-moon-summary__glyph"
        viewBox={`${-R - 1} ${-R - 1} ${2 * R + 2} ${2 * R + 2}`}
        width={2 * R + 2}
        height={2 * R + 2}
        aria-hidden="true"
        focusable="false"
      >
        <circle className="alm-moon-summary__disk" r={R} cx={0} cy={0} />
        <path className="alm-moon-summary__lit" d={litSemicirclePath(waxing)} />
        <ellipse
          className={
            ellipseLit ? 'alm-moon-summary__lit' : 'alm-moon-summary__disk'
          }
          cx={0}
          cy={0}
          rx={ellipseRx}
          ry={R}
        />
      </svg>
      <span className="alm-moon-summary__text">
        <span className="alm-moon-summary__title">{m.targets_moon_summary_title()}</span>
        <span className="alm-moon-summary__phase">{label}</span>
        <span className="alm-moon-summary__meta">
          {m.targets_moon_illumination({ pct })} · {direction}
        </span>
      </span>
    </div>
  );
}
