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
 */

import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useNavigate, Link } from '@tanstack/react-router';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { TargetDetailV3 } from '@/bindings/aliases';
import type { ContractError } from '@/lib/errors';
import type { TargetListItem } from '@/bindings/index';
import type {
  TargetSessionItem,
  TargetProjectItem,
  TargetAstroFormat,
} from '@/bindings';
import { DetailPane, PropertyTable, type PropertyDef } from '@/components';
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
import { errorMessage } from './target-error-message';
import { useActiveSite } from './observing-sites/site-store';
import { usePlannerDateMs } from './planner-date-store';
import { GuidanceCell } from './GuidanceCell';
import { deriveRowMoonPlanning } from './astro/row-planning';
import type { ObservingNight } from './astro/moon-state';
import { useGuidanceParams } from './guidance-settings';
import { formatOppositionDate, oppositionRelative } from './astro/opposition';
import { bestMoonDate } from './astro/best-moon-date';
import type { SeparationFigure } from './planner-derive';
import { Group } from '@visx/group';
import { LinePath } from '@visx/shape';
import { Threshold } from '@visx/threshold';
import { altitudeScale, hourScale } from './altitude-scale';

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
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: TargetDetailV3 };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * #758/FR-020: format one of the three real target↔Moon separation figures —
 * a whole-degree value, or the explicit "Moon not up" state (never a
 * fabricated number when the Moon is below the horizon at that reference).
 */
function formatSeparationFigure(figure: SeparationFigure): string {
  return figure === 'moon-not-up'
    ? m.targets_moon_not_up()
    : `${Math.round(figure)}°`;
}

/** Map an AliasKind string to a human label for the badge. */
function kindLabel(kind: string): string {
  switch (kind) {
    case 'designation':
      return m.targets_alias_kind_designation();
    case 'common_name':
      return m.targets_alias_kind_name();
    case 'user':
      return m.targets_alias_kind_user();
    default:
      return kind;
  }
}

// ── Altitude curve helper ─────────────────────────────────────────────────────
//
// Real per-night altitude curve (spec 044 Track B, T012) via `planner-altitude`
// (`planner-astronomy.ts` + `planner-derive.ts`, astronomy-engine, offline).
// Replaces the prior sinusoidal placeholder curve at a fixed 52.1°N latitude.

interface AltPoint {
  /** Hours into the night (0 = night start … night end). */
  tHour: number;
  /** Altitude in degrees (-90..+90), refraction-corrected. */
  altDeg: number;
}

// ── Tonight Altitude graph (spec 044 Track B, T035 — @visx) ──────────────────
//
// Rebuilt on `@visx/scale`/`shape`/`group`/`threshold` (replacing the prior
// hand-rolled polyline): the usable-altitude shading now follows the CURVE
// itself (Threshold clips the shaded area to where the curve is actually
// above the threshold, not a static full-width band), and twilight-vs-dark
// shading marks the evening/morning twilight either side of the real dark
// window. The x/y scales are `altitude-scale.ts`, shared with the per-row
// `AltitudeSparkline`.

interface AltitudeGraphProps {
  /** Pre-sampled altitude curve (shared with the list's max-alt computation). */
  points: AltPoint[];
  /** Usable-altitude threshold (Settings → Target Planner); shades the curve above it. */
  usableAltDeg: number;
  /** The dark window's `[startHour, endHour]` on the same axis as `points`; `null` = no dark window (US4). */
  darkWindowHours: { startHour: number; endHour: number } | null;
  /**
   * Moon-excluded spans for the displayed band on the same axis as `points`
   * (iteration 2026-07-15, FR-007 overlay); empty when the Moon never
   * interferes or its geometry wasn't computed.
   */
  moonSpans?: Array<{ startHour: number; endHour: number }>;
}

const SVG_W = 400;
const SVG_H = 140;
const PAD_L = 32;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 28;
const PLOT_W = SVG_W - PAD_L - PAD_R;
const PLOT_H = SVG_H - PAD_T - PAD_B;

function AltitudeGraph({
  points,
  usableAltDeg,
  darkWindowHours,
  moonSpans = [],
}: AltitudeGraphProps) {
  // #757 defense-in-depth: the caller (TargetDetailV2) already gates this
  // component out of the render tree for the degrade states where `points`
  // is `[]` (DEGRADE_ROW — no coordinates / no site). Guard here too so a
  // future caller passing an empty curve degrades to nothing rather than
  // crashing on `points.reduce(..., points[0])` → `undefined`.
  if (points.length === 0) return null;

  const yScale = altitudeScale(PLOT_H, 0);
  const xScale = hourScale(0, PLOT_W);

  const usableYPx = yScale(usableAltDeg);

  // FR-034 (#817): with no dark window the graph must AGREE with the 0-hour
  // imaging stat — the whole plot is shaded non-dark and the above-threshold
  // fill renders grey instead of the usable green.
  const noDark = darkWindowHours === null;

  const clampHour = (h: number) => Math.min(12, Math.max(0, h));

  // Transit marker: find point closest to peak altitude.
  const peak = points.reduce(
    (best, p) => (p.altDeg > best.altDeg ? p : best),
    points[0],
  );
  const transitXPx = xScale(peak.tHour);

  // X-axis tick labels (every 2 h from 18 to 06).
  const xTicks: Array<{ tHour: number; label: string }> = [];
  for (let h = 0; h <= 12; h += 2) {
    const clock = (18 + h) % 24;
    xTicks.push({ tHour: h, label: String(clock).padStart(2, '0') });
  }

  // Y-axis tick labels.
  const yTicks = [0, 30, 60, 90];

  return (
    <div className="alm-planner__graph-wrap">
      {/* viewBox and width/height are geometry — inline SVG attributes */}
      <svg
        className="alm-planner__graph-svg"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        aria-label={m.targets_detail_alt_graph_aria()}
        role="img"
      >
        <Group left={PAD_L} top={PAD_T}>
          {/* US4/T031: twilight (not-dark) shading either side of the real
              dark window. FR-034: with NO dark window the ENTIRE plot is
              shaded non-dark (it used to be omitted, which read as an
              all-dark night and contradicted the 0-hour stat — #817). */}
          {noDark && (
            <rect
              x={0}
              y={0}
              width={PLOT_W}
              height={PLOT_H}
              className="alm-planner__graph-twilight"
            />
          )}
          {darkWindowHours && darkWindowHours.startHour > 0 && (
            <rect
              x={0}
              y={0}
              width={Math.max(0, xScale(darkWindowHours.startHour))}
              height={PLOT_H}
              className="alm-planner__graph-twilight"
            />
          )}
          {darkWindowHours && darkWindowHours.endHour < 12 && (
            <rect
              x={xScale(darkWindowHours.endHour)}
              y={0}
              width={Math.max(0, PLOT_W - xScale(darkWindowHours.endHour))}
              height={PLOT_H}
              className="alm-planner__graph-twilight"
            />
          )}

          {/* Usable-altitude shading — clipped to where the CURVE is actually
              above the threshold (T035), not a static full-width band. */}
          <Threshold<AltPoint>
            id="tonight-usable-threshold"
            data={points}
            x={(p) => xScale(p.tHour)}
            y0={() => usableYPx}
            y1={(p) => yScale(p.altDeg)}
            clipAboveTo={0}
            clipBelowTo={PLOT_H}
            // FR-034: no dark window → grey the fill; green would claim
            // usable imaging time the stats correctly report as zero.
            aboveAreaProps={
              noDark
                ? { fill: 'var(--alm-text-faint)', opacity: 0.25 }
                : { fill: 'var(--alm-ok-bg)', opacity: 0.6 }
            }
            belowAreaProps={{ fill: 'none' }}
          />

          {/* Moon-excluded spans for the displayed band (FR-007 overlay):
              bottom-anchored band so it reads as a time-range exclusion
              without hiding the curve. */}
          {moonSpans.map((s) => {
            const x0 = xScale(clampHour(s.startHour));
            const x1 = xScale(clampHour(s.endHour));
            return (
              <rect
                key={`moon-${s.startHour}`}
                x={x0}
                y={PLOT_H - 6}
                width={Math.max(1, x1 - x0)}
                height={6}
                className="alm-planner__graph-moon"
              />
            );
          })}

          {/* Usable-altitude guide line. */}
          <line
            x1={0}
            y1={usableYPx}
            x2={PLOT_W}
            y2={usableYPx}
            stroke="var(--alm-ok-border)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />

          {/* Altitude curve. */}
          <LinePath<AltPoint>
            data={points}
            x={(p) => xScale(p.tHour)}
            y={(p) => yScale(p.altDeg)}
            stroke="var(--alm-accent)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Transit vertical marker. */}
          <line
            x1={transitXPx}
            y1={0}
            x2={transitXPx}
            y2={PLOT_H}
            stroke="var(--alm-accent)"
            strokeWidth={1}
            strokeDasharray="2 2"
            opacity={0.6}
          />
          <text
            x={transitXPx + 3}
            y={9}
            className="alm-planner__graph-label-text"
          >
            {m.targets_detail_transit()}
          </text>

          {/* Y-axis */}
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={PLOT_H}
            stroke="var(--alm-border)"
            strokeWidth={1}
          />
          {/* X-axis */}
          <line
            x1={0}
            y1={PLOT_H}
            x2={PLOT_W}
            y2={PLOT_H}
            stroke="var(--alm-border)"
            strokeWidth={1}
          />

          {/* Y-axis ticks + labels */}
          {yTicks.map((alt) => (
            <g key={alt}>
              <line
                x1={-3}
                y1={yScale(alt)}
                x2={0}
                y2={yScale(alt)}
                stroke="var(--alm-border)"
                strokeWidth={1}
              />
              <text
                x={-5}
                y={yScale(alt) + 3}
                textAnchor="end"
                className="alm-planner__graph-axis-text"
              >
                {alt}°
              </text>
            </g>
          ))}

          {/* X-axis ticks + labels */}
          {xTicks.map(({ tHour, label }) => (
            <g key={tHour}>
              <line
                x1={xScale(tHour)}
                y1={PLOT_H}
                x2={xScale(tHour)}
                y2={PLOT_H + 3}
                stroke="var(--alm-border)"
                strokeWidth={1}
              />
              <text
                x={xScale(tHour)}
                y={PLOT_H + 12}
                textAnchor="middle"
                className="alm-planner__graph-axis-text"
              >
                {label}
              </text>
            </g>
          ))}
        </Group>
      </svg>
    </div>
  );
}

// ── TargetDetailV2 ────────────────────────────────────────────────────────────

export function TargetDetailV2({
  targetId,
  item = null,
  usableAltDeg = USABLE_ALT_DEG,
  night = null,
  sensorConfig = null,
}: Props) {
  const guidanceParams = useGuidanceParams();
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [aliasInput, setAliasInput] = useState('');
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [displayAliasInput, setDisplayAliasInput] = useState('');
  const [displayAliasEditing, setDisplayAliasEditing] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  // US2: linked sessions
  const [sessions, setSessions] = useState<TargetSessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  // US3: linked projects
  const [projects, setProjects] = useState<TargetProjectItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  // US4: observing notes
  const [notes, setNotes] = useState<string | null>(null);
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  // Sexagesimal RA/Dec (adopt target-match): backend-formatted, carry-safe
  // rounding (replaces the hand-rolled fmtRa/fmtDec, which could round a
  // seconds value up to an invalid ":60").
  const [astroFormat, setAstroFormat] = useState<TargetAstroFormat | null>(
    null,
  );

  const navigate = useNavigate();

  // US6/T015: real astronomy needs an active observing site; the graph/stats
  // degrade cleanly (T013) via `altitudeFor`'s needsSite flag when there isn't one.
  const site = useActiveSite();
  // US2/T024: the Planner's chosen date (defaults to "tonight", FR-008).
  const dateMs = usePlannerDateMs();

  const load = useCallback(() => {
    setLoadState({ status: 'loading' });
    commands
      .targetGet({ targetId })
      .then(unwrap)
      .then((data) => {
        setLoadState({ status: 'loaded', data: data as TargetDetailV3 });
        setDisplayAliasInput(data.displayAlias ?? '');
      })
      .catch(() => {
        setLoadState({
          status: 'error',
          message: m.targets_detail_load_error(),
        });
      });
  }, [targetId]);

  useEffect(() => {
    load();
  }, [load]);

  // US2: load linked sessions when targetId changes.
  useEffect(() => {
    setSessionsLoading(true);
    commands
      .targetSessionsList({ targetId })
      .then(unwrap)
      .then((data) => setSessions(data))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, [targetId]);

  // US3: load linked projects when targetId changes.
  useEffect(() => {
    setProjectsLoading(true);
    commands
      .targetProjectsList({ targetId })
      .then(unwrap)
      .then((data) => setProjects(data))
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, [targetId]);

  // US4: load observing notes when targetId changes.
  useEffect(() => {
    commands
      .targetNoteGet({ targetId })
      .then(unwrap)
      .then(({ notes: n }) => {
        setNotes(n ?? null);
        setNotesDraft(n ?? '');
      })
      .catch(() => {
        setNotes(null);
        setNotesDraft('');
      });
    // Reset editing state when target changes.
    setNotesEditing(false);
    setNotesSaved(false);
    setNotesError(null);
  }, [targetId]);

  // Sexagesimal RA/Dec: one batched call (N=1 here) once the detail loads.
  // No reset-to-null branch needed for the non-'loaded' states: `astroFormat`
  // is only read below after the loading/error early-returns, so a stale
  // value from a prior target is never displayed before this effect refetches.
  useEffect(() => {
    if (loadState.status !== 'loaded') return;
    const { id, raDeg, decDeg } = loadState.data;
    commands
      .targetAstroFormatBatch({ targets: [{ id, raDeg, decDeg }] })
      .then(unwrap)
      .then(({ formatted }) => setAstroFormat(formatted[0] ?? null))
      .catch(() => setAstroFormat(null));
  }, [loadState]);

  // US4: save notes handler.
  const handleNotesSave = useCallback(async () => {
    setNotesSaving(true);
    setNotesError(null);
    try {
      const { notes: saved } = unwrap(
        await commands.targetNoteUpdate({ targetId, notes: notesDraft }),
      );
      setNotes(saved ?? null);
      setNotesDraft(saved ?? '');
      setNotesEditing(false);
      setNotesSaved(true);
    } catch {
      setNotesError(m.targets_detail_notes_save_error());
    } finally {
      setNotesSaving(false);
    }
  }, [targetId, notesDraft]);

  // Add user alias.
  const handleAliasAdd = useCallback(async () => {
    const alias = aliasInput.trim();
    if (!alias) {
      setAliasError(m.targets_detail_alias_blank());
      return;
    }
    setAliasError(null);
    try {
      unwrap(await commands.targetAliasAdd({ targetId, alias }));
      setAliasInput('');
      load();
    } catch (err) {
      const e = err as ContractError;
      setAliasError(errorMessage(e, m.targets_detail_add_alias_failed()));
    }
  }, [targetId, aliasInput, load]);

  // Remove user alias by id.
  const handleAliasRemove = useCallback(
    async (aliasId: string) => {
      setActionError(null);
      try {
        unwrap(await commands.targetAliasRemove({ targetId, aliasId }));
        load();
      } catch (err) {
        const e = err as ContractError;
        setActionError(errorMessage(e, m.targets_detail_remove_alias_failed()));
      }
    },
    [targetId, load],
  );

  // Set display alias.
  const handleDisplayAliasSet = useCallback(async () => {
    setActionError(null);
    try {
      const data = unwrap(
        await commands.targetDisplayAliasSet({
          targetId,
          displayAlias: displayAliasInput.trim(),
        }),
      );
      setLoadState({ status: 'loaded', data: data as TargetDetailV3 });
      setDisplayAliasInput(data.displayAlias ?? '');
      setDisplayAliasEditing(false);
    } catch (err) {
      const e = err as ContractError;
      setActionError(
        errorMessage(e, m.targets_detail_set_display_alias_failed()),
      );
    }
  }, [targetId, displayAliasInput]);

  // Clear display alias.
  const handleDisplayAliasClear = useCallback(async () => {
    setActionError(null);
    try {
      const data = unwrap(await commands.targetDisplayAliasClear({ targetId }));
      setLoadState({ status: 'loaded', data: data as TargetDetailV3 });
      setDisplayAliasInput('');
      setDisplayAliasEditing(false);
    } catch (err) {
      const e = err as ContractError;
      setActionError(
        errorMessage(e, m.targets_detail_clear_display_alias_failed()),
      );
    }
  }, [targetId]);

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

  const raDecStr = astroFormat
    ? `${astroFormat.raSexagesimal} / ${astroFormat.decSexagesimal}`
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

  return (
    <DetailPane fill>
      {/* ── Planner header ──────────────────────────────────────────────── */}
      <div className="alm-planner__header">
        <div className="alm-planner__header-left">
          {/* Title + actions inline-left (matches Sessions); pills below. */}
          <div className="alm-planner__titlebar">
            <h2 className="alm-planner__title">
              {detail.effectiveLabel}
              {commonName && commonName !== detail.effectiveLabel && (
                <span className="alm-planner__subtitle"> — {commonName}</span>
              )}
            </h2>
            <div className="alm-planner__actions">
              {/* Primary/contextual action FIRST (Sessions convention: the
                  highlight action leads the inline-left group). */}
              <Btn
                size="sm"
                variant="primary"
                onClick={() => {
                  setNewProjectOpen(true);
                  void navigate({ to: '/projects/new' });
                }}
              >
                {m.targets_detail_new_project()}
              </Btn>
              <Btn size="sm" variant="ghost" disabled>
                {m.targets_detail_add_to_plan()}
              </Btn>
            </div>
          </div>
          <div className="alm-planner__pill-row">
            <Pill variant="neutral">
              {detail.objectType.replace(/_/g, ' ')}
            </Pill>
            {catalogPills.map((a) => (
              <Pill key={a.id} variant="ghost">
                {a.alias}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      {/* Suppress unused-state warning; newProjectOpen drives the navigate above */}
      {newProjectOpen && null}

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
                      <span className="alm-planner__link-date">{dateStr}</span>
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
                ? m.projects_detail_edit_btn()
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
              <span title={m.targets_detail_alias_kind_title({ kind: a.kind })}>
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

      {/* Sessions surface lives in the mid-page SESSIONS/PROJECTS link row
          above (single source of truth) — the duplicate bottom Sessions
          section was removed to avoid two Sessions surfaces. */}

      {/* ── Projects (spec 023 US3) ──────────────────────────────────────── */}
      <Section title={m.common_projects()} count={projects.length}>
        {projects.length === 0 ? (
          <EmptyState
            title={m.targets_detail_no_projects_linked_title()}
            desc={m.targets_detail_no_projects_linked()}
          />
        ) : (
          <ul className="alm-target-detail__project-list">
            {projects.map((p) => (
              <li key={p.id} className="alm-target-detail__project-item">
                <button
                  className="alm-target-detail__project-btn"
                  onClick={() =>
                    void navigate({
                      to: '/projects',
                      search: { selected: p.id },
                    })
                  }
                >
                  <span className="alm-target-detail__project-name">
                    {p.name}
                  </span>
                  <span className="alm-target-detail__project-lifecycle">
                    {p.lifecycle}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

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
                {m.projects_detail_edit_btn()}
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
    </DetailPane>
  );
}
