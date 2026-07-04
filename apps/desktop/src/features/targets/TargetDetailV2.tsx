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
 *   - Tonight altitude graph: approximate sinusoidal SVG curve from RA/Dec +
 *     placeholder observer latitude.
 *     // STUB: altitude ephemeris — replace with real astro calc when
 *     // location/ephemeris backend lands.
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
import { useNavigate } from '@tanstack/react-router';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { TargetDetailV3, TargetOpError } from '@/bindings/aliases';
import type { TargetListItem } from '@/bindings/index';
import type { TargetSessionItem, TargetProjectItem } from '@/bindings';
import { DetailPane, PropertyTable, type PropertyDef } from '@/components';
import { Pill, Section, EmptyState, Banner, Btn } from '@/ui';
import { m } from '@/lib/i18n';
import { altitudeFor, rowAltitudeFor, USABLE_ALT_DEG } from './planner-altitude';
import { FilterBadges } from './FilterBadges';
import { useActiveSite } from './observing-sites/site-store';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  targetId: string;
  /** The selected list row — supplies constellation/magnitude + tonight stats. */
  item?: TargetListItem | null;
  /** Usable-altitude threshold (from Settings) for img-time / visible-tonight. */
  usableAltDeg?: number;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: TargetDetailV3 };

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Format decimal RA degrees (0–360) to sexagesimal h m s string. */
function fmtRa(deg: number): string {
  if (!Number.isFinite(deg)) return '—';
  const h = deg / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${ss.toFixed(0).padStart(2, '0')}s`;
}

/** Format decimal Dec degrees to ±DD°MM′SS″ string. */
function fmtDec(deg: number): string {
  if (!Number.isFinite(deg)) return '—';
  const sign = deg < 0 ? '−' : '+';
  const abs = Math.abs(deg);
  const dd = Math.floor(abs);
  const mm = Math.floor((abs - dd) * 60);
  const ss = ((abs - dd) * 60 - mm) * 60;
  return `${sign}${String(dd).padStart(2, '0')}°${String(mm).padStart(2, '0')}′${ss.toFixed(0).padStart(2, '0')}″`;
}

/** Map TargetOpError.code to a user-readable message. */
function errorMessage(err: TargetOpError, fallback: string): string {
  switch (err.code) {
    case 'alias.blank':
      return m.targets_detail_alias_blank();
    case 'alias.not_found':
      return m.targets_detail_alias_not_found();
    case 'alias.not_removable':
      return m.targets_detail_alias_not_removable();
    case 'target.not_found':
      return m.targets_detail_target_not_found();
    case 'target.invalid_id':
      return m.targets_detail_invalid_target_id();
    case 'note.content_too_large':
      return m.err_note_content_too_large();
    default:
      return fallback;
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

// ── Tonight Altitude SVG ──────────────────────────────────────────────────────

interface AltitudeGraphProps {
  /** Pre-sampled altitude curve (shared with the list's max-alt computation). */
  points: AltPoint[];
}

const SVG_W = 400;
const SVG_H = 140;
const PAD_L = 32;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 28;
const PLOT_W = SVG_W - PAD_L - PAD_R;
const PLOT_H = SVG_H - PAD_T - PAD_B;
const ALT_MIN = -10;
const ALT_MAX = 90;

function altToY(alt: number): number {
  const frac = (alt - ALT_MIN) / (ALT_MAX - ALT_MIN);
  return PAD_T + PLOT_H - frac * PLOT_H;
}

function hourToX(tHour: number): number {
  return PAD_L + (tHour / 12) * PLOT_W;
}

function AltitudeGraph({ points }: AltitudeGraphProps) {
  // Build SVG polyline points string (dynamic geometry — inline attribute ok)
  const polylinePoints = points
    .map((p) => `${hourToX(p.tHour).toFixed(1)},${altToY(p.altDeg).toFixed(1)}`)
    .join(' ');

  // Usable-altitude band (≥30°) shading
  const y30 = altToY(30);
  const yTop = altToY(ALT_MAX);

  // Transit marker: find point closest to peak altitude
  const peak = points.reduce(
    (best, p) => (p.altDeg > best.altDeg ? p : best),
    points[0],
  );
  const transitX = hourToX(peak.tHour);
  // The curve is an approximate placeholder (see caption), so the marker is
  // labelled "transit" without a precise time to avoid contradicting the
  // identity table (which shows transit as "—" pending the ephemeris backend).

  // X-axis tick labels (every 2 h from 18 to 06)
  const xTicks: Array<{ tHour: number; label: string }> = [];
  for (let h = 0; h <= 12; h += 2) {
    const clock = (18 + h) % 24;
    xTicks.push({ tHour: h, label: String(clock).padStart(2, '0') });
  }

  // Y-axis tick labels
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
        {/* Usable altitude shaded band (≥30°) */}
        <rect
          x={PAD_L}
          y={yTop}
          width={PLOT_W}
          height={y30 - yTop}
          fill="var(--alm-ok-bg)"
          opacity="0.6"
        />

        {/* 30° usable-altitude guide line */}
        <line
          x1={PAD_L}
          y1={y30}
          x2={PAD_L + PLOT_W}
          y2={y30}
          stroke="var(--alm-ok-border)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        {/* Altitude curve */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="var(--alm-accent)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Transit vertical marker */}
        <line
          x1={transitX}
          y1={PAD_T}
          x2={transitX}
          y2={PAD_T + PLOT_H}
          stroke="var(--alm-accent)"
          strokeWidth="1"
          strokeDasharray="2 2"
          opacity="0.6"
        />
        <text
          x={transitX + 3}
          y={PAD_T + 9}
          className="alm-planner__graph-label-text"
        >
          {m.targets_detail_transit()}
        </text>

        {/* Y-axis */}
        <line
          x1={PAD_L}
          y1={PAD_T}
          x2={PAD_L}
          y2={PAD_T + PLOT_H}
          stroke="var(--alm-border)"
          strokeWidth="1"
        />
        {/* X-axis */}
        <line
          x1={PAD_L}
          y1={PAD_T + PLOT_H}
          x2={PAD_L + PLOT_W}
          y2={PAD_T + PLOT_H}
          stroke="var(--alm-border)"
          strokeWidth="1"
        />

        {/* Y-axis ticks + labels */}
        {yTicks.map((alt) => (
          <g key={alt}>
            <line
              x1={PAD_L - 3}
              y1={altToY(alt)}
              x2={PAD_L}
              y2={altToY(alt)}
              stroke="var(--alm-border)"
              strokeWidth="1"
            />
            <text
              x={PAD_L - 5}
              y={altToY(alt) + 3}
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
              x1={hourToX(tHour)}
              y1={PAD_T + PLOT_H}
              x2={hourToX(tHour)}
              y2={PAD_T + PLOT_H + 3}
              stroke="var(--alm-border)"
              strokeWidth="1"
            />
            <text
              x={hourToX(tHour)}
              y={PAD_T + PLOT_H + 12}
              textAnchor="middle"
              className="alm-planner__graph-axis-text"
            >
              {label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── TargetDetailV2 ────────────────────────────────────────────────────────────

export function TargetDetailV2({ targetId, item = null, usableAltDeg = USABLE_ALT_DEG }: Props) {
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

  const navigate = useNavigate();

  // US6/T015: real astronomy needs an active observing site; the graph/stats
  // degrade cleanly (T013) via `altitudeFor`'s needsSite flag when there isn't one.
  const site = useActiveSite();

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
        setLoadState({ status: 'error', message: m.targets_detail_load_error() });
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

  // US4: save notes handler.
  const handleNotesSave = useCallback(async () => {
    setNotesSaving(true);
    setNotesError(null);
    try {
      const { notes: saved } = unwrap(await commands.targetNoteUpdate({ targetId, notes: notesDraft }));
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
      const e = err as TargetOpError;
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
        const e = err as TargetOpError;
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
        await commands.targetDisplayAliasSet({ targetId, displayAlias: displayAliasInput.trim() }),
      );
      setLoadState({ status: 'loaded', data: data as TargetDetailV3 });
      setDisplayAliasInput(data.displayAlias ?? '');
      setDisplayAliasEditing(false);
    } catch (err) {
      const e = err as TargetOpError;
      setActionError(errorMessage(e, m.targets_detail_set_display_alias_failed()));
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
      const e = err as TargetOpError;
      setActionError(errorMessage(e, m.targets_detail_clear_display_alias_failed()));
    }
  }, [targetId]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loadState.status === 'loading') {
    return (
      <DetailPane>
        <EmptyState title={m.common_loading()} desc="" />
      </DetailPane>
    );
  }

  if (loadState.status === 'error') {
    return (
      <DetailPane>
        <EmptyState title={m.settings_advanced_log_error()} desc={loadState.message} />
      </DetailPane>
    );
  }

  const detail = loadState.data;

  // Derive catalog pills from aliases with kind='designation' (non-primary).
  const catalogPills = detail.aliases
    .filter((a) => a.kind === 'designation' && a.alias !== detail.primaryDesignation)
    .slice(0, 4);

  // Common name (first common_name alias, if any).
  const commonName = detail.aliases.find((a) => a.kind === 'common_name')?.alias ?? null;

  // Tonight planner data — shared with the list row (same rowAltitudeFor source
  // so the graph peak and the "Max alt" stat agree). Falls back to a direct
  // real computation from the detail's own RA/Dec when the list item isn't
  // available (e.g. direct navigation to a target's detail page).
  const rowAlt = item
    ? rowAltitudeFor(item, usableAltDeg, site)
    : altitudeFor({ id: detail.id, raDeg: detail.raDeg, decDeg: detail.decDeg }, usableAltDeg, site);
  const tonightPoints: AltPoint[] = rowAlt.points;

  const raDecStr =
    detail.raDeg != null && detail.decDeg != null
      ? `${fmtRa(detail.raDeg)} / ${fmtDec(detail.decDeg)}`
      : null;

  // Identity facts split across two tabular columns (left-packed).
  const identityA: PropertyDef[] = [
    { key: 'desig', label: m.targets_col_designation(), value: detail.primaryDesignation },
    { key: 'type', label: m.cmp_target_search_type_label(), value: detail.objectType.replace(/_/g, ' ') },
    { key: 'constellation', label: m.targets_prop_constellation(), value: item?.constellation ?? null },
    { key: 'radec', label: m.targets_prop_ra_dec(), value: raDecStr },
  ];
  const identityB: PropertyDef[] = [
    { key: 'magnitude', label: m.targets_prop_magnitude(), value: item?.magnitude ?? null },
    { key: 'source', label: m.projects_wizard_col_source(), value: detail.source },
    ...(detail.simbadOid != null
      ? [{ key: 'simbad', label: m.targets_prop_simbad_oid(), value: detail.simbadOid } as PropertyDef]
      : []),
  ];

  // Tonight stats (numeric) — Filters render separately (a component, not a value).
  // No astronomy is possible in the degrade states (T013): no coordinates, or
  // no active observing site (US6/T015) — show nothing rather than 0°/NaN°.
  const tonightAvailable = !rowAlt.needsCoordinates && !rowAlt.needsSite;
  const tonightStats: PropertyDef[] = tonightAvailable
    ? [
        { key: 'maxalt', label: m.targets_col_max_alt(), value: `${Math.round(rowAlt.maxAltDeg)}°` },
        { key: 'imgtime', label: m.targets_col_img_time(), value: `${rowAlt.hoursAboveUsable.toFixed(1)} h` },
        ...(rowAlt.lunarDistanceDeg != null
          ? [{ key: 'lunar', label: m.targets_col_lunar(), value: `${Math.round(rowAlt.lunarDistanceDeg)}°` } as PropertyDef]
          : []),
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
            <Pill variant="neutral">{detail.objectType.replace(/_/g, ' ')}</Pill>
            {catalogPills.map((a) => (
              <Pill key={a.id} variant="ghost">{a.alias}</Pill>
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
              ? m.targets_detail_tonight_title({ lat: Math.round(site.latitudeDeg) })
              : m.targets_detail_tonight_title_no_site()}
          </div>
          {rowAlt.needsSite ? (
            <Banner variant="info">{m.targets_planner_no_site_banner()}</Banner>
          ) : (
            <>
              <AltitudeGraph points={tonightPoints} />
              {tonightAvailable && (
                <>
                  <PropertyTable mode="view" properties={tonightStats} />
                  <div className="alm-planner__tonight-filters">
                    <span className="alm-planner__tonight-filters-label">{m.common_filters()}</span>
                    <FilterBadges recommendation={rowAlt.filters} />
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
            <span className="alm-planner__link-empty">{m.common_loading()}</span>
          ) : sessions.length === 0 ? (
            <span className="alm-planner__link-empty">
              {m.targets_detail_no_sessions()}
            </span>
          ) : (
            <ul className="alm-planner__link-list">
              {sessions.map((s) => {
                const dateStr = new Date(s.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                });
                return (
                  <li key={s.id} className="alm-planner__link-item">
                    <button
                      className="alm-planner__link-btn"
                      onClick={() =>
                        void navigate({ to: '/sessions', search: { selected: s.id } })
                      }
                    >
                      <span className="alm-planner__link-date">{dateStr}</span>
                      <span className="alm-planner__link-meta">
                        {m.targets_detail_session_frames({ count: s.frameCount })}
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
            <span className="alm-planner__link-empty">{m.common_loading()}</span>
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
                    onClick={() => void navigate({ to: '/projects', search: { selected: p.id } })}
                  >
                    <span className="alm-planner__link-name">{p.name}</span>
                    <span className="alm-planner__link-state">{p.lifecycle}</span>
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
                  aria-label={m.targets_detail_alias_remove_aria({ alias: a.alias })}
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
                    void navigate({ to: '/projects', search: { selected: p.id } })
                  }
                >
                  <span className="alm-target-detail__project-name">{p.name}</span>
                  <span className="alm-target-detail__project-lifecycle">{p.lifecycle}</span>
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
