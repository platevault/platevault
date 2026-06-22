/**
 * FilterBadges — compact filter-band tag display for the Planner table
 * (spec 044, task "Filters possible" column).
 *
 * Renders a `FiltersRecommendation` as a row of small pill-shaped badges.
 * The bands are grouped into broadband (L/R/G/B) and narrowband (Ha/OIII/SII)
 * tiers; each tier renders with a distinct CSS class for colour coding.
 *
 * NOT astronomy — the recommendation is a mock placeholder per spec 044 §3.
 * Replace with real Telescopius-based model when research §5 lands.
 */

import type { FilterBand, FiltersRecommendation } from './planner-altitude';

// ── Band metadata ──────────────────────────────────────────────────────────────

/** Broadband bands (LRGB). */
const BROADBAND_BANDS: FilterBand[] = ['L', 'R', 'G', 'B'];
/** Narrowband bands (Ha/OIII/SII). */
const NARROWBAND_BANDS: FilterBand[] = ['Ha', 'OIII', 'SII'];

function bandTier(band: FilterBand): 'broadband' | 'narrowband' {
  return BROADBAND_BANDS.includes(band) ? 'broadband' : 'narrowband';
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  recommendation: FiltersRecommendation;
}

/**
 * Render a compact set of filter-band badges for a Planner table row.
 * Broadband badges use the `--bb` modifier; narrowband use `--nb`.
 */
export function FilterBadges({ recommendation }: Props) {
  const { bands, label } = recommendation;

  // Preserve canonical display order (LRGB first, then Ha/OIII/SII).
  const ordered = [...BROADBAND_BANDS, ...NARROWBAND_BANDS].filter((b) => bands.includes(b));

  return (
    <span className="alm-filter-badges" title={label}>
      {ordered.map((band) => (
        <span
          key={band}
          className={`alm-filter-badge alm-filter-badge--${bandTier(band)}`}
          aria-label={band}
        >
          {band}
        </span>
      ))}
    </span>
  );
}
