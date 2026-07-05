/**
 * GuidanceCell — filter-guidance pills + explanation popover (spec 047 T017/T018).
 *
 * ONE shared component composing `FilterBadges` with a hover/focus-openable
 * explanation (FR-012, SC-006): tonight's Moon illumination/age, this row's
 * lunar separation, and each band's required minimum separation under the
 * active per-band parameters. Used by both the Planner table row and the
 * target detail pane so the guidance surface + its explanation are never
 * duplicated.
 *
 * Unknown coordinates (no separation) render the pills' own unknown state and
 * a short unknown-reason explanation instead of fabricating thresholds.
 */

import { Popover } from '@base-ui-components/react/popover';
import { m } from '@/lib/i18n';
import { FilterBadges } from './FilterBadges';
import { BANDS, minSeparationDeg, type MoonAvoidanceParams } from './astro/moon-avoidance';
import type { ObservingNight } from './astro/moon-state';
import type { RowMoonPlanning } from './astro/row-planning';
import { phaseLabel } from './MoonSummary';

interface Props {
  /** The shared observing night, or `null` when the site gate is closed. */
  night: ObservingNight | null;
  /** This row's derived planner astronomy (lunar separation + guidance). */
  moon: RowMoonPlanning;
  /** Active per-band Moon-avoidance parameters (Settings → Target Planner). */
  params: MoonAvoidanceParams;
  /** Accessible label for the trigger (identifies the row for screen readers). */
  targetLabel: string;
}

/**
 * Guidance cell: pill strip trigger that opens an explanation popover on
 * hover or focus (FR-012). Stops row-select click propagation so opening the
 * popover never also selects the row.
 */
export function GuidanceCell({ night, moon, params, targetLabel }: Props) {
  const { bandViability, recommendation, lunarSeparationDeg } = moon;

  return (
    <Popover.Root>
      <Popover.Trigger
        className="alm-guidance-cell__trigger"
        openOnHover
        nativeButton
        onClick={(e) => e.stopPropagation()}
        aria-label={m.targets_guidance_explain_title() + ': ' + targetLabel}
      >
        <FilterBadges viability={bandViability} recommendation={recommendation} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={4}>
          <Popover.Popup className="alm-guidance-popup" data-testid="guidance-explain-popup">
            <div className="alm-guidance-popup__title">{m.targets_guidance_explain_title()}</div>
            {bandViability === null || !night ? (
              <div className="alm-guidance-popup__unknown">
                {m.targets_guidance_explain_unknown()}
              </div>
            ) : (
              <>
                <div className="alm-guidance-popup__line">
                  {m.targets_guidance_explain_moon({
                    phase: phaseLabel(night.phaseName),
                    pct: Math.round(night.illuminationFrac * 100),
                    age: night.moonAgeFromFullDays.toFixed(1),
                  })}
                </div>
                <div className="alm-guidance-popup__line">
                  {m.targets_guidance_explain_separation({
                    deg: Math.round(lunarSeparationDeg ?? 0),
                  })}
                </div>
                <ul className="alm-guidance-popup__bands">
                  {BANDS.map((band) => {
                    const minDeg = minSeparationDeg(band, night.moonAgeFromFullDays, params);
                    const viable = bandViability[band];
                    return (
                      <li key={band} className="alm-guidance-popup__band-row">
                        <span className="alm-guidance-popup__band-name">
                          {m.targets_guidance_explain_band_row({ band, deg: Math.round(minDeg) })}
                        </span>
                        <span
                          className={
                            'alm-guidance-popup__band-state' +
                            (viable
                              ? ' alm-guidance-popup__band-state--viable'
                              : ' alm-guidance-popup__band-state--not-viable')
                          }
                        >
                          {viable
                            ? m.targets_guidance_state_viable()
                            : m.targets_guidance_state_not_viable()}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
