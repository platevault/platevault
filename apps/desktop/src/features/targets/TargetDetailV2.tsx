// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TargetDetailV2 — spec 036 gen-3 detail pane for a single canonical target.
 *
 * Renders:
 *   - Planner header: effectiveLabel, objectType + catalog pills, "Add to plan"
 *     and "+ New project here" actions (FR-012).
 *   - Identity table: Designation, Type, RA/Dec, Source, SIMBAD OID.
 *     STUB fields (Constellation, Magnitude, Apparent size, Best season, Transit,
 *     Moon, Altitude now) are marked below — the gen-3 backend does not yet return
 *     these.
 *   - Tonight altitude graph: real per-site ephemeris (spec 044 Track B,
 *     astronomy-engine, offline), rendered via `@visx/scale`/`shape`/`group`/
 *     `threshold` (T035) — usable-altitude band shading + twilight-vs-dark
 *     shading, sharing `altitude-scale.ts` with the list row's sparkline.
 *   - Coverage bars (filter integration hours) — stubbed; gen-3 backend does not
 *     yet expose coverage per filter on the target.get endpoint.
 *     // STUB: target coverage — backend pending.
 *   - Linked sessions / linked projects — empty-state stubs; cross-spec FK wiring
 *     is deferred (see spec 036 open gaps).
 *     // STUB: target↔session/project linkage backend pending.
 *   - Display-alias edit (FR-012).
 *   - Alias list + add-alias form.
 *
 * Split by responsibility (refactor sweep #982): `AltitudeGraph.tsx` is the
 * self-contained tonight-altitude SVG chart; `target-detail-format.ts` is
 * pure display-formatting helpers; `useTargetDetailMutations.ts` is the
 * alias/display-alias/notes edit state + mutation handlers. This file is
 * Props + data loading + the render.
 */

import { X } from 'lucide-react';
import { useNavigate, Link } from '@tanstack/react-router';
import type { TargetListItem } from '@/bindings/index';
import {
  useTargetDetail,
  useTargetSessions,
  useTargetProjects,
  useTargetNotes,
  useTargetAstroFormat,
} from './store';
import type { TargetDetailV3 } from './store';
import {
  DetailPane,
  DetailPanel,
  PropertyTable,
  type PropertyDef,
} from '@/components';
import { Pill, Section, EmptyState, Banner, Btn, Skeleton } from '@/ui';
import { m } from '@/lib/i18n';
import {
  altitudeFor,
  moonExcludedSpanHours,
  rowAltitudeFor,
  USABLE_ALT_DEG,
} from './planner-altitude';
import { BANDS } from './astro/moon-avoidance';
import type { SensorConfig } from './planner-derive';
import { useActiveSite } from './observing-sites/site-store';
import { usePlannerDateMs } from './planner-date-store';
import { GuidanceCell } from './GuidanceCell';
import { deriveRowMoonPlanning } from './astro/row-planning';
import type { ObservingNight } from './astro/moon-state';
import { useGuidanceParams } from './guidance-settings';
import { formatOppositionDate, oppositionRelative } from './astro/opposition';
import { bestMoonDate } from './astro/best-moon-date';
import { AltitudeGraph, type AltPoint } from './AltitudeGraph';
import { formatSeparationFigure, kindLabel } from './target-detail-format';
import { useTargetDetailMutations } from './useTargetDetailMutations';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  targetId: string;
  /** The selected list row — supplies constellation/magnitude + tonight stats. */
  item?: TargetListItem | null;
  /** Usable-altitude threshold (from Settings) for img-time / visible-tonight. */
  usableAltDeg?: number;
  /**
   * The shared observing night (spec 047), or `null` when no observing site
   * exists (site gate). Drives the real lunar distance + filter guidance
   * shown alongside the real (spec 044 Track B) tonight altitude graph.
   */
  night?: ObservingNight | null;
  /**
   * Camera sensor configuration (FR-035/FR-036, T046): when OSC the
   * imaging-time stat collapses to the strictest-band single-pass window and
   * a per-line breakdown appears for narrowband passbands (FR-037).
   * `null`/absent keeps the per-filter model unchanged (FR-038).
   */
  sensorConfig?: SensorConfig | null;
  /**
   * #658: called after an alias add/remove or display-alias set/clear
   * mutation succeeds, so the caller can refetch the list payload the
   * Targets page filters/renders from — otherwise a fresh user alias stays
   * unsearchable and a new display label never propagates to the list row
   * until an unrelated remount refetches it.
   */
  onMutated?: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: TargetDetailV3 };

// ── TargetDetailV2 ────────────────────────────────────────────────────────────

export function TargetDetailV2({
  targetId,
  item = null,
  usableAltDeg = USABLE_ALT_DEG,
  night = null,
  sensorConfig = null,
  onMutated,
}: Props) {
  const guidanceParams = useGuidanceParams();
  const navigate = useNavigate();

  // US6/T015: real astronomy needs an active observing site; the graph/stats
  // degrade cleanly (T013) via `altitudeFor`'s needsSite flag when there isn't one.
  const site = useActiveSite();
  // US2/T024: the Planner's chosen date (defaults to "tonight", FR-008).
  const dateMs = usePlannerDateMs();

  const detailQuery = useTargetDetail(targetId);
  const { data: sessions = [], loading: sessionsLoading } =
    useTargetSessions(targetId);
  const { data: projects = [], loading: projectsLoading } =
    useTargetProjects(targetId);
  const { data: notes = null } = useTargetNotes(targetId);
  // Sexagesimal RA/Dec (adopt target-match): backend-formatted, carry-safe
  // rounding (replaces the hand-rolled fmtRa/fmtDec, which could round a
  // seconds value up to an invalid ":60"). Only fires once the detail has
  // loaded (mirrors the pre-migration effect's `loadState.status==='loaded'` gate).
  const { data: astroFormat = null } = useTargetAstroFormat(
    targetId,
    detailQuery.data?.raDeg ?? null,
    detailQuery.data?.decDeg ?? null,
    !!detailQuery.data,
  );

  const loadState: LoadState = detailQuery.error
    ? { status: 'error', message: m.targets_detail_load_error() }
    : detailQuery.loading || !detailQuery.data
      ? { status: 'loading' }
      : { status: 'loaded', data: detailQuery.data };

  const {
    aliasInput,
    setAliasInput,
    aliasError,
    actionError,
    displayAliasInput,
    setDisplayAliasInput,
    displayAliasEditing,
    setDisplayAliasEditing,
    notesEditing,
    setNotesEditing,
    notesDraft,
    setNotesDraft,
    notesSaving,
    notesSaved,
    setNotesSaved,
    notesError,
    setNotesError,
    handleNotesSave,
    handleAliasAdd,
    handleAliasRemove,
    handleDisplayAliasSet,
    handleDisplayAliasClear,
  } = useTargetDetailMutations({
    targetId,
    serverDisplayAlias: detailQuery.data?.displayAlias,
    notes,
    onMutated,
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loadState.status === 'loading') {
    return (
      <DetailPane>
        <Skeleton count={5} label={m.common_loading()} />
      </DetailPane>
    );
  }

  if (loadState.status === 'error') {
    return (
      <DetailPane>
        <EmptyState
          title={m.settings_advanced_log_error()}
          desc={loadState.message}
        />
      </DetailPane>
    );
  }

  const detail = loadState.data;

  // Derive catalog pills from aliases with kind='designation' (non-primary).
  const catalogPills = detail.aliases
    .filter(
      (a) => a.kind === 'designation' && a.alias !== detail.primaryDesignation,
    )
    .slice(0, 4);

  // Common name (first common_name alias, if any).
  const commonName =
    detail.aliases.find((a) => a.kind === 'common_name')?.alias ?? null;

  // Tonight planner data — shared with the list row (same rowAltitudeFor source
  // so the graph peak and the "Max alt" stat agree). Falls back to a direct
  // real computation from the detail's own RA/Dec when the list item isn't
  // available (e.g. direct navigation to a target's detail page). The altitude/
  // imaging-time model is real (spec 044 Track B); lunar distance + filter
  // guidance below are the real spec 047 Track A values from `moon`.
  const rowAlt = item
    ? rowAltitudeFor(
        item,
        usableAltDeg,
        site,
        dateMs,
        guidanceParams,
        true,
        sensorConfig,
      )
    : altitudeFor(
        { id: detail.id, raDeg: detail.raDeg, decDeg: detail.decDeg },
        usableAltDeg,
        site,
        dateMs,
        guidanceParams,
        true,
        sensorConfig,
      );
  const tonightPoints: AltPoint[] = rowAlt.points;

  // FR-007 overlay: Moon-excluded spans for the DISPLAYED band — default
  // unchanged: the band with the most moon-free time (ties break in BANDS
  // order; the global band picker stays deferred). Same cached night as
  // rowAlt — no second astronomy pass.
  const displayBand = BANDS.reduce((best, b) =>
    rowAlt.moonFreeMinutesByBand[b] > rowAlt.moonFreeMinutesByBand[best]
      ? b
      : best,
  );
  const moonSpans =
    !rowAlt.needsCoordinates && !rowAlt.needsSite
      ? moonExcludedSpanHours(
          { id: detail.id, raDeg: detail.raDeg, decDeg: detail.decDeg },
          displayBand,
          site,
          dateMs,
          guidanceParams,
        )
      : [];

  const moon = deriveRowMoonPlanning(
    { raDeg: detail.raDeg, decDeg: detail.decDeg },
    night,
    guidanceParams,
  );

  // RA and Dec on separate lines (user decision 2026-07-17): the mono face is
  // wider than the old sans, so the joined form wrapped mid-coordinate.
  const raDecStr = astroFormat
    ? `${astroFormat.raSexagesimal}\n${astroFormat.decSexagesimal}`
    : null;

  // Identity facts split across two tabular columns (left-packed).
  const identityA: PropertyDef[] = [
    {
      key: 'desig',
      label: m.targets_col_designation(),
      value: detail.primaryDesignation,
    },
    {
      key: 'type',
      label: m.cmp_target_search_type_label(),
      value: detail.objectType.replace(/_/g, ' '),
    },
    {
      key: 'constellation',
      label: m.targets_prop_constellation(),
      value: item?.constellation ?? null,
    },
    {
      key: 'radec',
      label: m.targets_prop_ra_dec(),
      value: raDecStr,
      mono: true, // spec 055 FR-005: RA/Dec coordinate values render mono.
    },
  ];
  const identityB: PropertyDef[] = [
    {
      key: 'magnitude',
      label: m.targets_prop_magnitude(),
      value: item?.magnitude ?? null,
    },
    {
      key: 'source',
      label: m.projects_wizard_col_source(),
      value: detail.source,
    },
    {
      // Always applicable to a target identity (data-model.md: target-identity
      // fields are always applicable) — present the row even when unresolved
      // (spec-030 Q16 / FR-135) instead of omitting it for a non-SIMBAD target.
      key: 'simbad',
      label: m.targets_prop_simbad_oid(),
      value: detail.simbadOid ?? null,
    },
  ];

  // Tonight stats (numeric) — Filters render separately (a component, not a value).
  // No astronomy is possible in the degrade states (T013): no coordinates, or
  // no active observing site (US6/T015) — show nothing rather than 0°/NaN°.
  // Max alt / imaging time are real (spec 044 Track B); lunar distance is the
  // real spec 047 value (unknown → "—"), never a fabricated number.
  const tonightAvailable = !rowAlt.needsCoordinates && !rowAlt.needsSite;
  // US2/T025 + FR-009 amendment (iteration 2026-07-17): the DETAIL "Best
  // date" is the nearest Moon-viable night to the opposition date (scored
  // with the live Lorentzian guidance params, broadband L in v1) — the list's
  // "Opposition" column stays the pure anti-solar-RA date. Anchored on the
  // same instant as the list column (`night.midnight`, see
  // `deriveRowMoonPlanning`) so `oppositionDateMs` matches the list value
  // to the day; falls back to the planner date when the night isn't supplied.
  const bestMoon = tonightAvailable
    ? bestMoonDate(
        detail.raDeg,
        detail.decDeg,
        night?.midnight ?? new Date(dateMs),
        guidanceParams,
      )
    : null;
  const relativeText = (inDays: number): string => {
    const rel = oppositionRelative(inDays);
    return rel.unit === 'days'
      ? m.targets_opposition_in_days({ count: rel.count })
      : m.targets_opposition_in_months({ count: rel.count });
  };
  const bestDateValue = bestMoon
    ? `${formatOppositionDate(new Date(bestMoon.dateMs))} · ${relativeText(bestMoon.inDays)}`
    : null;
  // The stat explains itself (three states, FR-009 amendment): diverged from
  // opposition / coincides with a favourable Moon / no viable night found.
  const bestDateTooltip = bestMoon
    ? bestMoon.state === 'diverged'
      ? m.targets_best_date_tooltip_diverged({
          oppDate: formatOppositionDate(new Date(bestMoon.oppositionDateMs)),
          oppIllum: bestMoon.moonAtOpposition.illumPct,
          oppSep: Math.round(bestMoon.moonAtOpposition.sepDeg),
          bestDate: formatOppositionDate(new Date(bestMoon.dateMs)),
          bestIllum: bestMoon.moonAtBest.illumPct,
          bestSep: Math.round(bestMoon.moonAtBest.sepDeg),
        })
      : bestMoon.state === 'coincides'
        ? m.targets_best_date_tooltip_coincides({
            illum: bestMoon.moonAtBest.illumPct,
            sep: Math.round(bestMoon.moonAtBest.sepDeg),
          })
        : m.targets_best_date_tooltip_none()
    : undefined;
  // Three-quantity breakdown (iteration 2026-07-15, FR-005): dark window,
  // uptime (above threshold across the WHOLE night), and imaging time
  // (dark ∩ uptime) presented as three distinguishable stats.
  const darkWindowValue = rowAlt.darkWindowHours
    ? `${(rowAlt.darkWindowHours.endHour - rowAlt.darkWindowHours.startHour).toFixed(1)} h`
    : m.targets_detail_dark_window_none();
  // FR-036/SC-017: OSC cameras collapse the imaging-time headline to the
  // strictest-band single-pass window; mono/unknown keeps the geometric
  // dark ∩ uptime value byte-identical.
  const imagingHeadlineHours =
    rowAlt.oscSinglePassHours ?? rowAlt.hoursAboveUsable;
  // FR-037: for an OSC narrowband passband, each captured line's own
  // moon-viable window ("Ha 4h · OIII 1h") — the tolerant line may still be
  // usable on a moonlit night even when the single-pass headline is small.
  const oscPassband = sensorConfig?.passband;
  const oscLineValue =
    sensorConfig?.sensorType === 'osc' &&
    Array.isArray(oscPassband) &&
    oscPassband.length > 0 &&
    rowAlt.oscSinglePassHours !== null
      ? oscPassband
          .map(
            (b) => `${b} ${(rowAlt.moonFreeMinutesByBand[b] / 60).toFixed(1)}h`,
          )
          .join(' · ')
      : null;
  const tonightStats: PropertyDef[] = tonightAvailable
    ? [
        {
          key: 'maxalt',
          label: m.targets_col_max_alt(),
          value: `${Math.round(rowAlt.maxAltDeg)}°`,
        },
        {
          key: 'darkwindow',
          label: m.targets_detail_dark_window(),
          value: darkWindowValue,
        },
        {
          key: 'uptime',
          label: m.targets_detail_uptime({ threshold: usableAltDeg }),
          value: `${rowAlt.uptimeHours.toFixed(1)} h`,
        },
        {
          key: 'imgtime',
          label: m.targets_col_img_time(),
          value: `${imagingHeadlineHours.toFixed(1)} h`,
        },
        ...(oscLineValue !== null
          ? [
              {
                key: 'osclines',
                label: m.targets_detail_osc_lines(),
                value: oscLineValue,
              },
            ]
          : []),
        {
          key: 'lunar',
          label: m.targets_col_lunar(),
          value:
            moon.lunarSeparationDeg != null
              ? `${Math.round(moon.lunarSeparationDeg)}°`
              : null,
        },
        {
          key: 'bestdate',
          label: m.targets_col_best_date(),
          value: bestDateValue,
          tooltip: bestDateTooltip,
        },
      ]
    : [];

  // #758/FR-020: the three real target↔Moon separation figures — computed
  // (`rowAlt.separationScalars`, spec 044 T028) but previously never rendered
  // anywhere in the app. Distinct from the "Lunar" stat above (Track A's
  // single "tonight" reference separation, `astro/row-planning.ts`) — this is
  // Track B's transit/min-over-dark/dark-midpoint trio.
  const moonTrio: PropertyDef[] = tonightAvailable
    ? [
        {
          key: 'moon-transit',
          label: m.targets_detail_moon_at_transit(),
          value: formatSeparationFigure(rowAlt.separationScalars.atTransitDeg),
        },
        {
          key: 'moon-min-dark',
          label: m.targets_detail_moon_min_over_dark(),
          value: formatSeparationFigure(
            rowAlt.separationScalars.minOverDarkDeg,
          ),
        },
        {
          key: 'moon-dark-mid',
          label: m.targets_detail_moon_at_dark_midpoint(),
          value: formatSeparationFigure(
            rowAlt.separationScalars.atDarkMidpointDeg,
          ),
        },
      ]
    : [];

  // Title identity (h2, unchanged content/markup — just relocated into
  // DetailPanel's `title` slot, spec 054 T011/#1067).
  const titleContent = (
    <h2 className="alm-planner__title">
      {detail.effectiveLabel}
      {commonName && commonName !== detail.effectiveLabel && (
        <span className="alm-planner__subtitle"> — {commonName}</span>
      )}
    </h2>
  );

  // Pills + "New project" action, inline-left beside the title. Both go in
  // `titleExtra` (not the `actions` slot): SessionDetail/MasterDetail already
  // established this idiom — `actions` renders far-right in the header
  // (`.alm-detail__actions`), which would break the "inline-left, matches
  // Sessions" grouping this file's own header CSS documents.
  const titleExtraContent = (
    <>
      <div className="alm-planner__actions">
        {/* Primary/contextual action FIRST (Sessions convention: the
            highlight action leads the inline-left group). */}
        <Btn
          size="sm"
          variant="primary"
          onClick={() => {
            void navigate({
              to: '/projects/new',
              search: { targetId: detail.id },
            });
          }}
        >
          {m.targets_detail_new_project()}
        </Btn>
      </div>
      <div className="alm-planner__pill-row">
        <Pill variant="neutral">{detail.objectType.replace(/_/g, ' ')}</Pill>
        {catalogPills.map((a) => (
          <Pill key={a.id} variant="ghost">
            <span title={m.targets_detail_alias_kind_title({ kind: a.kind })}>
              <span className="alm-target-detail__alias-kind">
                [{kindLabel(a.kind)}]
              </span>
              {a.alias}
            </span>
          </Pill>
        ))}
      </div>
    </>
  );

  return (
    <DetailPanel fill title={titleContent} titleExtra={titleExtraContent}>
      {/* #816: DetailPane fill-mode contract (primitives.css .alm-detail--fill)
          requires ONE descendant establishing overflow-y:auto. DetailPanel is
          deliberately used in "content-only" mode here (no facts/aux slots) —
          that mode renders `children` as a direct sibling of DetailHeader
          inside `.alm-detail--fill` (see DetailPanel.tsx), identical to the
          pre-migration structure this comment originally documented. facts/
          aux were NOT used for the identity columns below: that would nest
          this region under `.alm-detailpanel__cols` > `.alm-detailpanel__content`
          instead of as a direct child of `.alm-detail--fill`, breaking the
          `.alm-detail--fill > .alm-planner__scroll` CSS rule (redesign-detail.css)
          this fix depends on — everything below (identity/tonight, coverage,
          links, display label, aliases, projects, notes, back button) lives
          in this single scrollable region so it isn't silently clipped by
          the pane's own overflow:hidden. */}
      <div className="alm-planner__scroll">
        {/* ── Identity + Tonight — left-packed: [facts A][facts B][tonight] ── */}
        <div className="alm-planner__cols">
          <div className="alm-planner__col">
            <PropertyTable mode="view" properties={identityA} />
          </div>
          <div className="alm-planner__col">
            <PropertyTable mode="view" properties={identityB} />
          </div>

          {/* Tonight column: a small transit graph + the planner stats. */}
          <div className="alm-planner__tonight">
            <div className="alm-planner__graph-title">
              {site
                ? m.targets_detail_tonight_title({
                    lat: Math.round(site.latitudeDeg),
                  })
                : m.targets_detail_tonight_title_no_site()}
            </div>
            {rowAlt.needsSite ? (
              <Banner variant="info">
                {m.targets_planner_no_site_banner()}{' '}
                <Link
                  to="/settings/$pane"
                  params={{ pane: 'planner' }}
                  className="alm-banner__action-link"
                >
                  {m.targets_planner_no_site_banner_action()}
                </Link>
              </Banner>
            ) : rowAlt.needsCoordinates ? (
              // #757: a site is active but this target has no catalogued
              // coordinates (unresolved manual target) — `rowAlt.points` is
              // `[]` here (DEGRADE_ROW), so the altitude graph MUST NOT render
              // (its transit-marker peak computation assumes a non-empty
              // curve). Render the same "un-plannable" degrade state as the
              // no-site case, distinctly worded, instead of crashing.
              <Banner variant="info">
                {m.targets_detail_needs_coordinates_banner()}
              </Banner>
            ) : (
              <>
                <AltitudeGraph
                  points={tonightPoints}
                  usableAltDeg={usableAltDeg}
                  darkWindowHours={rowAlt.darkWindowHours}
                  moonSpans={moonSpans}
                />
                {/* FR-029/SC-015: zero imaging time is always explained with a
                  stated sentence — darkness (FR-017's no-dark-window case),
                  altitude, or moon, same precedence as the table glyph. */}
                {tonightAvailable && rowAlt.zeroImagingReason !== null && (
                  <Banner variant="info">
                    {rowAlt.zeroImagingReason === 'darkness'
                      ? m.targets_imgtime_zero_darkness_title()
                      : rowAlt.zeroImagingReason === 'altitude'
                        ? m.targets_imgtime_zero_altitude_title({
                            threshold: usableAltDeg,
                          })
                        : m.targets_imgtime_zero_moon_title()}
                  </Banner>
                )}
                {tonightAvailable && (
                  <>
                    <PropertyTable mode="view" properties={tonightStats} />
                    {/* #758/FR-020: the transit/min-over-dark/dark-midpoint
                      Moon-separation trio — computed since spec 044 T028 but
                      never rendered anywhere in the app until now. */}
                    <div className="alm-planner__tonight-filters">
                      <span className="alm-planner__tonight-filters-label">
                        {m.targets_detail_moon_trio_title()}
                      </span>
                      <PropertyTable mode="view" properties={moonTrio} />
                    </div>
                    <div className="alm-planner__tonight-filters">
                      <span className="alm-planner__tonight-filters-label">
                        {m.common_filters()}
                      </span>
                      <GuidanceCell
                        night={night}
                        moon={moon}
                        params={guidanceParams}
                        targetLabel={detail.effectiveLabel}
                        moonFreeMinutesByBand={rowAlt.moonFreeMinutesByBand}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Coverage bars ────────────────────────────────────────────────── */}
        {/* STUB: target coverage — gen-3 TargetDetailV3 does not yet expose
          per-filter coverage. Render the section header with a stub note. */}
        <div className="alm-planner__coverage">
          <p className="alm-planner__section-title">{m.common_coverage()}</p>
          <div className="alm-planner__coverage-list">
            <span className="alm-planner__coverage-stub">
              {m.targets_detail_no_coverage()}
            </span>
          </div>
        </div>

        {/* ── Linked sessions + projects ───────────────────────────────────── */}
        <div className="alm-planner__links">
          <div>
            <p className="alm-planner__link-col-title">{m.common_sessions()}</p>
            {sessionsLoading ? (
              <Skeleton count={3} width="80%" label={m.common_loading()} />
            ) : sessions.length === 0 ? (
              <span className="alm-planner__link-empty">
                {m.targets_detail_no_sessions()}
              </span>
            ) : (
              <ul className="alm-planner__link-list">
                {sessions.map((s) => {
                  const dateStr = new Date(s.createdAt).toLocaleDateString(
                    undefined,
                    {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    },
                  );
                  return (
                    <li key={s.id} className="alm-planner__link-item">
                      <button
                        className="alm-planner__link-btn"
                        onClick={() =>
                          void navigate({
                            to: '/sessions',
                            search: { selected: s.id },
                          })
                        }
                      >
                        <span className="alm-planner__link-date">
                          {dateStr}
                        </span>
                        {s.filter !== '' && (
                          <span className="alm-planner__link-meta">
                            {s.filter}
                          </span>
                        )}
                        <span className="alm-planner__link-meta">
                          {m.targets_detail_session_frames({
                            count: s.frameCount,
                          })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <p className="alm-planner__link-col-title">{m.common_projects()}</p>
            {projectsLoading ? (
              <Skeleton count={3} width="80%" label={m.common_loading()} />
            ) : projects.length === 0 ? (
              <span className="alm-planner__link-empty">
                {m.targets_detail_no_projects_linked()}
              </span>
            ) : (
              <ul className="alm-planner__link-list">
                {projects.map((p) => (
                  <li key={p.id} className="alm-planner__link-item">
                    <button
                      className="alm-planner__link-btn"
                      onClick={() =>
                        void navigate({
                          to: '/projects',
                          search: { selected: p.id },
                        })
                      }
                    >
                      <span className="alm-planner__link-name">{p.name}</span>
                      <span className="alm-planner__link-state">
                        {p.lifecycle}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Display label ────────────────────────────────────────────────── */}
        <Section title={m.targets_detail_display_label_title()}>
          {displayAliasEditing ? (
            <div className="alm-target-detail__display-alias-edit">
              <input
                aria-label={m.targets_detail_display_label_title()}
                placeholder={detail.primaryDesignation}
                value={displayAliasInput}
                onChange={(e) => setDisplayAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleDisplayAliasSet();
                  if (e.key === 'Escape') setDisplayAliasEditing(false);
                }}
                className="alm-target-detail__text-input"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- focus management: the inline display-label editor mounts on demand and must receive focus so the user can type immediately
                autoFocus
              />
              <button
                onClick={handleDisplayAliasSet}
                className="alm-target-detail__action-btn"
              >
                {m.common_save()}
              </button>
              {detail.displayAlias != null && (
                <button
                  onClick={handleDisplayAliasClear}
                  className="alm-target-detail__action-btn alm-target-detail__action-btn--muted"
                >
                  {m.common_clear()}
                </button>
              )}
              <button
                onClick={() => setDisplayAliasEditing(false)}
                className="alm-target-detail__action-btn alm-target-detail__action-btn--muted"
              >
                {m.common_cancel()}
              </button>
            </div>
          ) : (
            <div className="alm-target-detail__display-alias-view">
              <span className="alm-target-detail__display-alias-value">
                {detail.displayAlias ?? (
                  <em className="alm-target-detail__display-alias-placeholder">
                    {m.targets_detail_display_label_unset()}
                  </em>
                )}
              </span>
              <button
                onClick={() => setDisplayAliasEditing(true)}
                className="alm-target-detail__edit-btn"
              >
                {detail.displayAlias != null
                  ? m.common_edit()
                  : m.targets_detail_set_alias()}
              </button>
            </div>
          )}
        </Section>

        {/* ── Aliases ──────────────────────────────────────────────────────── */}
        <Section title={m.common_aliases()} count={detail.aliases.length}>
          <div className="alm-target-detail__alias-list">
            {detail.aliases.map((a) => (
              <Pill key={a.id} variant={a.kind === 'user' ? 'accent' : 'ghost'}>
                <span
                  title={m.targets_detail_alias_kind_title({ kind: a.kind })}
                >
                  <span className="alm-target-detail__alias-kind">
                    [{kindLabel(a.kind)}]
                  </span>
                  {a.alias}
                </span>
                {a.kind === 'user' && (
                  <button
                    aria-label={m.targets_detail_alias_remove_aria({
                      alias: a.alias,
                    })}
                    className="alm-target-detail__alias-remove"
                    onClick={() => handleAliasRemove(a.id)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </Pill>
            ))}
            {detail.aliases.length === 0 && (
              <span className="alm-target-detail__alias-empty">
                {m.targets_detail_no_aliases()}
              </span>
            )}
          </div>

          {/* Add user alias form */}
          <div className="alm-target-detail__alias-add-row">
            <input
              aria-label={m.targets_detail_alias_input_aria()}
              placeholder={m.targets_detail_alias_placeholder()}
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAliasAdd();
              }}
              className="alm-target-detail__text-input"
            />
            <button
              onClick={handleAliasAdd}
              className="alm-target-detail__action-btn"
            >
              {m.common_add()}
            </button>
          </div>
          {aliasError && (
            <Banner variant="danger" className="alm-target-detail__banner">
              {aliasError}
            </Banner>
          )}
          {actionError && (
            <Banner variant="danger" className="alm-target-detail__banner">
              {actionError}
            </Banner>
          )}
        </Section>

        {/* Sessions AND Projects surfaces both live in the mid-page
          SESSIONS/PROJECTS link row above (single source of truth) — the
          duplicate bottom Sessions section was already removed to avoid two
          Sessions surfaces; the bottom Projects section (#670) was the same
          duplication (identical p.name/p.lifecycle list, same
          navigate-to-/projects action, plus a redundant EmptyState whose
          title and desc restated the same "No projects linked" sentence
          twice) — removed for the same reason. */}

        {/* ── Observing notes (spec 023 US4) ──────────────────────────────── */}
        <Section title={m.targets_detail_notes_title()}>
          {notesEditing ? (
            <div className="alm-target-detail__notes-edit">
              <textarea
                data-testid="target-notes-textarea"
                aria-label={m.targets_detail_notes_title()}
                className="alm-target-detail__notes-textarea"
                placeholder={m.targets_detail_notes_placeholder()}
                value={notesDraft}
                rows={5}
                maxLength={16384}
                disabled={notesSaving}
                onChange={(e) => {
                  setNotesDraft(e.target.value);
                  setNotesError(null);
                }}
              />
              <div className="alm-target-detail__notes-actions">
                <button
                  className="alm-target-detail__action-btn alm-target-detail__action-btn--muted"
                  disabled={notesSaving}
                  onClick={() => {
                    setNotesDraft(notes ?? '');
                    setNotesEditing(false);
                    setNotesError(null);
                  }}
                >
                  {m.common_cancel()}
                </button>
                <button
                  className="alm-target-detail__action-btn"
                  disabled={notesSaving}
                  onClick={() => void handleNotesSave()}
                >
                  {notesSaving ? m.common_saving() : m.common_save()}
                </button>
              </div>
              {notesError && (
                <Banner variant="danger" className="alm-target-detail__banner">
                  {notesError}
                </Banner>
              )}
            </div>
          ) : (
            <div className="alm-target-detail__notes-view">
              {notes ? (
                <div
                  data-testid="target-notes-body"
                  className="alm-target-detail__notes-body"
                >
                  {notes}
                </div>
              ) : (
                <span
                  data-testid="target-notes-empty"
                  className="alm-target-detail__notes-empty"
                >
                  {m.targets_detail_notes_empty()}
                </span>
              )}
              <div className="alm-target-detail__notes-footer">
                <button
                  className="alm-target-detail__edit-btn"
                  onClick={() => {
                    setNotesDraft(notes ?? '');
                    setNotesEditing(true);
                    setNotesSaved(false);
                  }}
                >
                  {m.common_edit()}
                </button>
                {notesSaved && (
                  <span className="alm-target-detail__notes-saved">
                    {m.targets_detail_notes_saved()}
                  </span>
                )}
              </div>
            </div>
          )}
        </Section>

        {/* Back button */}
        <button
          className="alm-target-detail__back-btn"
          onClick={() => navigate({ to: '/targets' })}
        >
          {m.targets_detail_back()}
        </button>
      </div>
    </DetailPanel>
  );
}
